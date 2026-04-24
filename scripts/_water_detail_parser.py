#!/usr/bin/env python3
"""
Water-sheet detail parser for NuRock legacy workbooks.

Output: list of per-month, per-line-item records suitable for the
invoice_line_items table. A single monthly bill typically yields 3-5 line items:
  - Water      (consumption, GL 5120)
  - Sewer      (consumption, GL 5125)
  - Irrigation (consumption, GL 5122)
  - Storm Water (flat fee, GL 5120)
  - Envir. Protection Fee (flat fee, GL 5120)
  plus optional Late Fee, Deposit, Franchise Fee, OGI Fee.
"""
import re
from decimal import Decimal

MONTH_NAMES_FULL = {
    "JANUARY": 1, "FEBRUARY": 2, "FEBUARY": 2, "MARCH": 3, "APRIL": 4,
    "MAY": 5, "JUNE": 6, "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9,
    "OCTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12,
}
MONTH_NAMES_SHORT = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "SEPT": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
FEE_KEYWORDS = ("storm", "envir", "environmental", "franchise", "ogi",
                "late fee", "deposit", "credit")


def to_dec(v):
    if v is None or v == "": return None
    try:
        d = Decimal(str(v))
        return d if abs(d) > Decimal("0.001") else None
    except Exception:
        return None


def classify_fee(label):
    lo = label.lower().strip()
    if "storm"     in lo: return ("5120", "storm_water",    False)
    if "envir"     in lo: return ("5120", "environmental",  False)
    if "franchise" in lo: return ("5120", "franchise_fee",  False)
    if "ogi"       in lo: return ("5120", "ogi_fee",        False)
    if "late"      in lo: return ("5120", "late_fee",       False)
    if "deposit"   in lo: return ("5120", "deposit",        False)
    if "credit"    in lo: return ("5120", "credit",         False)
    return ("5120", "other_fee", False)


def find_month_header_row(ws):
    for r in range(8, 20):
        month_cols = []
        for c in range(1, min(ws.max_column + 1, 70)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_NAMES_FULL:
                month_cols.append((c, MONTH_NAMES_FULL[up]))
            elif up in MONTH_NAMES_SHORT:
                month_cols.append((c, MONTH_NAMES_SHORT[up]))
        if len(month_cols) < 2: continue
        cleaned = [month_cols[0]]
        for col, m in month_cols[1:]:
            prev = cleaned[-1][1]
            if m == prev + 1 or (prev == 12 and m == 1):
                cleaned.append((col, m))
        if len(cleaned) >= 2:
            stride = cleaned[1][0] - cleaned[0][0]
            months = [m for _, m in cleaned]
            return (r, cleaned[0][0], stride, months)
    return (None, None, None, None)


def identify_roles(ws, label_row, first_col, stride):
    roles = {}
    for offset in range(stride):
        label = ws.cell(label_row, first_col + offset).value
        if not isinstance(label, str): continue
        lo = label.lower().strip()
        if   "water" in lo and "storm" not in lo and "water"      not in roles: roles["water"]      = offset
        elif "sewer" in lo                          and "sewer"      not in roles: roles["sewer"]      = offset
        elif "irrig" in lo                          and "irrigation" not in roles: roles["irrigation"] = offset
        elif "total" in lo                          and "total"      not in roles: roles["total"]      = offset
    return roles


def _is_label(v):
    """True if v is a text string that looks like a description, not a number."""
    return isinstance(v, str) and v.strip() and not re.match(r"^\d+(\.\d+)?$", v.strip())


def parse_water_detail(wb, property_code, year):
    # Locate water sheet
    sheet_name = None
    for cand in ("Water", "Water-Sewer", "Water & Sewer"):
        if cand in wb.sheetnames:
            sheet_name = cand; break
    if not sheet_name:
        for s in wb.sheetnames:
            if "water" in s.lower() and "usage" not in s.lower():
                sheet_name = s; break
    if not sheet_name: return None
    ws = wb[sheet_name]

    header_row, first_col, stride, months = find_month_header_row(ws)
    if not header_row: return None

    label_row = header_row + 1
    roles = identify_roles(ws, label_row, first_col, stride)
    if not roles:
        label_row = header_row + 2
        roles = identify_roles(ws, label_row, first_col, stride)
    if not roles: return None

    # Vendor from top of sheet
    vendor_name = None
    for r in range(1, 6):
        v = ws.cell(r, 1).value
        if isinstance(v, str):
            s = v.strip()
            if ("water" in s.lower() or "utility" in s.lower() or "county" in s.lower()
                or "city of" in s.lower()) and "500-" not in s and "year" not in s.lower() \
               and len(s) > 6 and not re.match(r"^\d", s):
                vendor_name = s; break

    line_items = []
    account_number = None

    for r in range(label_row + 1, label_row + 16):
        col_a = ws.cell(r, 1).value
        col_b = ws.cell(r, 2).value

        # Stop at Total row or skip completely blank rows
        if _is_label(col_a) and col_a.strip().lower().startswith("total"):
            break

        # Check whether row has any data at all
        has_any_data = False
        for m_idx in range(len(months)):
            block = first_col + m_idx * stride
            for off in roles.values():
                if to_dec(ws.cell(r, block + off).value) is not None:
                    has_any_data = True; break
            if has_any_data: break
        if not has_any_data and not (_is_label(col_a) or _is_label(col_b)):
            continue

        # Fee row detection
        fee_label = None
        for cand in (col_a, col_b):
            if _is_label(cand):
                s = cand.strip()
                if any(k in s.lower() for k in FEE_KEYWORDS):
                    fee_label = s
                    break

        # Account number detection (first row encountered with an account-like string)
        if account_number is None:
            for cand in (col_a, col_b):
                if isinstance(cand, str):
                    s = cand.strip()
                    if (re.search(r"\d{4,}", s) and
                            not any(k in s.lower() for k in FEE_KEYWORDS) and
                            s.lower() not in ("water", "sewer", "total", "irrigation", "description") and
                            not re.match(r"^[0-9,.]+$", s)):     # not just a dollar amount
                        account_number = s; break

        # Meter identifier (for multi-meter rows — used in description)
        meter_id = None
        for cand in (col_a, col_b):
            if isinstance(cand, str):
                s = cand.strip()
                # An account/meter id is either:
                #   - 5+ digits without decimal point (pure numeric ID like 3066884300), or
                #   - has both digits and non-digit chars (like 1252091-89696)
                has_decimal = "." in s
                has_nondigit = bool(re.search(r"[^\d]", s))
                long_digits = bool(re.search(r"\d{5,}", s))
                if long_digits and not has_decimal and (has_nondigit or len(re.sub(r"\D", "", s)) >= 5):
                    meter_id = s; break

        # Emit line items per month
        for m_idx, month in enumerate(months):
            block = first_col + m_idx * stride
            period_cell = ws.cell(header_row, block + 1).value
            days_cell   = ws.cell(header_row, block + 2).value
            days = None
            if days_cell:
                mm = re.search(r"(\d+)", str(days_cell))
                if mm: days = int(mm.group(1))

            if fee_label:
                # Single line — find amount in any role column
                amount = None
                for rkey in ("water", "sewer", "irrigation"):
                    off = roles.get(rkey)
                    if off is None: continue
                    v = to_dec(ws.cell(r, block + off).value)
                    if v is not None and v > 0:
                        amount = v; break
                if amount:
                    gl, category, is_cons = classify_fee(fee_label)
                    line_items.append({
                        "month": month, "year": year, "days": days,
                        "service_period": str(period_cell).strip() if period_cell else None,
                        "description": fee_label,
                        "amount": amount,
                        "category": category,
                        "gl_code": gl,
                        "is_consumption_based": is_cons,
                    })
            else:
                # Primary / meter row — emit water, sewer, irrigation separately
                role_defs = [
                    ("water",      "Water",      "5120", "water",      True),
                    ("sewer",      "Sewer",      "5125", "sewer",      True),
                    ("irrigation", "Irrigation", "5122", "irrigation", True),
                ]
                for rkey, base_desc, gl, cat, is_cons in role_defs:
                    off = roles.get(rkey)
                    if off is None: continue
                    amount = to_dec(ws.cell(r, block + off).value)
                    if amount is None or amount <= 0: continue

                    desc = base_desc
                    if meter_id and meter_id != account_number:
                        desc = f"{base_desc} — Meter {meter_id}"
                    elif meter_id and account_number and meter_id == account_number:
                        pass  # primary account, use base description

                    line_items.append({
                        "month": month, "year": year, "days": days,
                        "service_period": str(period_cell).strip() if period_cell else None,
                        "description": desc,
                        "amount": amount,
                        "category": cat,
                        "gl_code": gl,
                        "is_consumption_based": is_cons,
                    })

    return {
        "vendor_name":    vendor_name,
        "account_number": account_number,
        "line_items":     line_items,
    }
