#!/usr/bin/env python3
"""
Per-account × per-month invoice extractor for legacy NuRock workbooks.

Unlike the previous `_water_detail_parser.py` which captured only line-item
categories (water/sewer/irrigation) rolled up per month, this extractor pulls
the FULL per-account-statement detail:

  * Every account number on a Water sheet (not just the first)
  * Monthly dollar amount per account per category (Water / Sewer / Irrigation)
  * The invoice number shown in the sheet header
  * The vendor name from the sheet header
  * Fee rows (Storm Water, Envir. Protection, etc.)

Output shape:

    {
      "vendor_name": "Town of Davie - Utilities",
      "vendor_code": "Town-D",
      "invoice_number_base": "601040826W",
      "year": 2026,
      "accounts": [
          {
              "account_number": "112674-001",
              "meter_id":       "25137589",
              "by_month": {
                  1: {"water": 1235.46, "sewer": 1450.40, "irrigation": None,
                      "total": 2685.86, "period": "11/24-12/29", "days": 35},
                  2: {"water":  733.35, "sewer":  914.27, ...},
                  ...
              }
          },
          ...
      ],
      "fees": [
          # Property-wide rows like Late Fee, Credit, etc.
          {"label": "Storm Water", "by_month": {1: 610.50, ...}},
      ]
    }

This is the shape the SQL emitter needs in order to create one utility_account
per (account_number, GL) and one invoice per (account, month). It's a strict
superset of the old parser's output, so the summary view totals remain exact —
sum of all per-account invoices for a given (property, GL, month) equals what
the old HIST-S- rows carried.
"""

import re
from decimal import Decimal
from typing import Optional


# Reuse the month mapping from the old parser for consistency
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
                "late fee", "deposit", "credit", "adjust")
STOP_LABELS = ("total", "adjust", "credit", "late fee")


def _dec(v):
    """Parse a cell value to Decimal, returning None for blanks/zeros/garbage."""
    if v is None or v == "": return None
    try:
        d = Decimal(str(v))
        return d if abs(d) > Decimal("0.001") else None
    except Exception:
        return None


def _is_label(v):
    return isinstance(v, str) and v.strip() and not re.match(r"^[\d.,\-\s]+$", v)


def _find_month_header_row(ws, start_row=2, end_row=22):
    """Locate the row whose cells contain month names. Returns (row_idx, [(col, month_int), ...]).

    Default scan range is rows 2-22 to catch both FIXED (header at r3) and
    Hse Meters (header at r16). Caller can override for specific layouts.

    If a month name appears multiple times in the same row (e.g. Vac Units
    has JANUARY|JANUARY|Deposit pattern), only the first occurrence is kept.
    """
    for r in range(start_row, end_row):
        cols = []
        seen_months = set()
        for c in range(1, min(ws.max_column + 1, 80)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            month_num = MONTH_NAMES_FULL.get(up) or MONTH_NAMES_SHORT.get(up)
            if month_num and month_num not in seen_months:
                cols.append((c, month_num))
                seen_months.add(month_num)
        if len(cols) >= 6:
            return r, cols
    return None, []


def _identify_role_columns_per_month(ws, label_row, month_cols):
    """
    Since month blocks can have different sub-columns (January has Late fee,
    March often omits it), compute role column offsets PER MONTH by reading
    the label row between month-header positions.

    Returns: { month_num: { "water": abs_col, "sewer": abs_col, ... } }
    """
    roles_by_month = {}
    for idx, (start_col, month_num) in enumerate(month_cols):
        # Block extends from this month's header col to next month's header col - 1
        next_col = month_cols[idx + 1][0] if idx + 1 < len(month_cols) else ws.max_column + 1
        month_roles = {}
        for c in range(start_col, next_col):
            v = ws.cell(label_row, c).value
            if not isinstance(v, str): continue
            low = v.strip().lower()
            if   "water"      in low and "storm" not in low: month_roles["water"]      = c
            elif "sewer"      in low:                        month_roles["sewer"]      = c
            elif "irrigation" in low:                        month_roles["irrigation"] = c
            elif low == "total":                             month_roles["total"]      = c
            elif "late"       in low:                        month_roles["late_fee"]   = c
        if month_roles:
            roles_by_month[month_num] = month_roles
    return roles_by_month


def _find_vendor_header(ws, sheet_type="water"):
    """Grab vendor name + code from rows 1-10 of the sheet.

    Each sheet type has its vendor name in a different row:
      - Water:       row 2 col 1  ('Town of Davie - Utility Payments' | 'Town-D')
      - Hse Meters:  row 7 col 1  ('FL Power Light Company' | 'FL Power')
      - Garbage:     row 3 col 1  ('Waste Management' | 'CoastalWR')
      - FedEx:       row 2 col 1  ('FedEx' | 'FedEx')
      - Phone&Cable: per-row in column 2 — no sheet-level vendor

    Different sheet types use different vendor-category vocabulary (utility,
    electric, power, waste, sanitation, etc.) so we accept any reasonably
    business-looking string sitting next to a short vendor code in col 2.
    """
    vendor_keywords = (
        "utility", "utilities", "water", "county", "city of", "municipal",
        "power", "electric", "light", "energy",        # electric utilities
        "waste", "sanitation", "recycling", "disposal", "management",  # trash
        "fedex", "ups", "shipping",                    # parcel
    )
    for r in range(1, 11):
        a = ws.cell(r, 1).value
        b = ws.cell(r, 2).value
        if not isinstance(a, str): continue
        s = a.strip()
        lo = s.lower()
        # Reject header-ish rows
        if not s or "500-" in s or "year" in lo or "invoice" in lo or "account" in lo:
            continue
        if re.match(r"^\d", s):
            continue
        # Keyword match OR "column A is long-ish business name with a short code in column B"
        if any(k in lo for k in vendor_keywords) and len(s) > 3:
            vendor_name = s
            vendor_code = b.strip() if isinstance(b, str) and b.strip() and len(b.strip()) < 25 else None
            return vendor_name, vendor_code
        # Fallback: accept any row where A is 4+ chars alpha/space and B is a short code (<=15 chars)
        if (len(s) >= 4 and re.search(r"[A-Za-z]{3,}", s)
                and isinstance(b, str) and b.strip() and 1 < len(b.strip()) <= 15
                and not re.match(r"^\d", b.strip())):
            return s, b.strip()
    return None, None


def _find_invoice_base(ws):
    """Sheet header usually has 'Invoice No. | 601040826W' on one of its first rows."""
    for r in range(6, 14):
        a = ws.cell(r, 1).value
        b = ws.cell(r, 2).value
        if isinstance(a, str) and "invoice" in a.lower() and "no" in a.lower():
            if isinstance(b, str) and b.strip():
                return b.strip()
    return None


def parse_water_accounts(ws, year: int) -> Optional[dict]:
    """
    Parse one Water sheet into a list of per-account monthly statements.
    Returns None if the sheet doesn't look like a valid Water layout.
    """
    header_row, month_cols = _find_month_header_row(ws)
    if not month_cols or len(month_cols) < 6:
        return None

    # The label row (Water / Sewer / Irrigation / Total) is header_row + 1 usually.
    # Try +1 first, then +2 if +1 doesn't yield any roles.
    label_row = header_row + 1
    roles_by_month = _identify_role_columns_per_month(ws, label_row, month_cols)
    if not roles_by_month:
        label_row = header_row + 2
        roles_by_month = _identify_role_columns_per_month(ws, label_row, month_cols)
        if not roles_by_month:
            return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    invoice_base = _find_invoice_base(ws)

    accounts = []
    fees = []
    seen_accounts = set()

    # Scan rows below label_row for account rows vs. fee rows vs. total rows
    for r in range(label_row + 1, min(label_row + 30, ws.max_row + 1)):
        col_a = ws.cell(r, 1).value
        col_b = ws.cell(r, 2).value

        # Stop at Total or Adjustment rows — everything below is aggregation/admin
        if _is_label(col_a):
            lo = col_a.strip().lower()
            if any(lo.startswith(stop) for stop in STOP_LABELS):
                break

        # Is this a fee row? (Credit, Late Fee, Storm Water if it appears on its own line, etc.)
        fee_label = None
        for cand in (col_a, col_b):
            if _is_label(cand) and any(k in cand.lower() for k in FEE_KEYWORDS):
                fee_label = cand.strip()
                break

        if fee_label:
            by_month = {}
            for month_num, month_roles in roles_by_month.items():
                # Fee amounts usually appear in the 'water' column of each month block
                for role_key in ("water", "total"):
                    col = month_roles.get(role_key)
                    if col is None: continue
                    v = _dec(ws.cell(r, col).value)
                    if v and v > 0:
                        by_month[month_num] = float(v)
                        break
            if by_month:
                fees.append({"label": fee_label, "by_month": by_month})
            continue

        # Otherwise: candidate account row. Extract account number and meter.
        account_number = None
        meter_id = None
        for cand in (col_a, col_b):
            if not isinstance(cand, str): continue
            s = cand.strip()
            if not s: continue
            # Account numbers have 4+ consecutive digits and aren't fee keywords
            if re.search(r"\d{4,}", s) and not any(k in s.lower() for k in FEE_KEYWORDS) \
               and s.lower() not in ("water", "sewer", "total", "irrigation", "description"):
                if account_number is None:
                    account_number = s
                elif meter_id is None and s != account_number:
                    meter_id = s

        if not account_number:
            continue

        # Build by_month data using the per-month role columns
        by_month = {}
        for month_num, month_roles in roles_by_month.items():
            month_data = {"water": None, "sewer": None, "irrigation": None,
                          "total": None, "late_fee": None,
                          "period": None, "days": None}
            for role, abs_col in month_roles.items():
                v = _dec(ws.cell(r, abs_col).value)
                if v is not None and v > 0:
                    month_data[role] = float(v)

            # period and days live one row above the label row (= header_row)
            # Month header cell is at start_col for each month — look +1 and +2 offset
            # (but these are not critical for the grid; best-effort extraction)
            start_col_for_month = next(
                (c for c, m in month_cols if m == month_num), None
            )
            if start_col_for_month:
                period_cell = ws.cell(header_row, start_col_for_month + 1).value \
                    if start_col_for_month + 1 <= ws.max_column else None
                days_cell = ws.cell(header_row, start_col_for_month + 2).value \
                    if start_col_for_month + 2 <= ws.max_column else None
                if period_cell:
                    month_data["period"] = str(period_cell).strip()
                if days_cell:
                    mm = re.search(r"(\d+)", str(days_cell))
                    if mm: month_data["days"] = int(mm.group(1))

            # Only include months with at least one non-zero monetary amount
            if any(month_data[k] for k in ("water", "sewer", "irrigation", "late_fee")):
                by_month[month_num] = month_data

        if not by_month:
            continue

        if account_number in seen_accounts:
            continue
        seen_accounts.add(account_number)

        accounts.append({
            "account_number": account_number,
            "meter_id":       meter_id,
            "by_month":       by_month,
        })

    if not accounts:
        return None

    return {
        "vendor_name":          vendor_name,
        "vendor_code":          vendor_code,
        "invoice_number_base":  invoice_base,
        "year":                 year,
        "accounts":             accounts,
        "fees":                 fees,
    }


# ============================================================================
# Simple grid parsers — one dollar-amount column per month.
# Shared by House Meters, Garbage, Phone&Cable, FedEx, Vacant Units.
# These sheets don't have sub-column categories per month like Water does;
# each account row has exactly one amount per month.
# ============================================================================

def _scan_simple_grid(ws, year, gl_code, *,
                      account_col=1, description_col=None, meter_col=None,
                      stop_labels=STOP_LABELS, min_account_len=4,
                      extra_columns=None):
    """
    Generic per-account monthly grid parser.

    Works on sheets where each row is one account and there's one dollar
    column per month (House Meters / Phone / Cable / FedEx / Vacant).

    Arguments:
        account_col:     1-based column where the account number lives
        description_col: 1-based column where description/vendor lives (or None)
        meter_col:       1-based column where meter id lives (or None)
        extra_columns:   dict of {label: (column_offset_from_month_col)} for
                         sideband data like pickup counts in the Garbage sheet
    """
    header_row, month_cols = _find_month_header_row(ws)
    if not month_cols or len(month_cols) < 4:
        return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    invoice_base = _find_invoice_base(ws)

    accounts = []
    seen = set()

    for r in range(header_row + 1, min(header_row + 100, ws.max_row + 1)):
        acct_cell  = ws.cell(r, account_col).value
        desc_cell  = ws.cell(r, description_col).value  if description_col else None
        meter_cell = ws.cell(r, meter_col).value         if meter_col        else None

        # Stop at total / adjust rows
        for cand in (acct_cell, desc_cell):
            if _is_label(cand):
                lo = cand.strip().lower()
                if any(lo.startswith(s) for s in stop_labels):
                    accounts_final = [a for a in accounts if a.get("account_number")]
                    if not accounts_final: return None
                    return {
                        "vendor_name": vendor_name, "vendor_code": vendor_code,
                        "invoice_number_base": invoice_base, "year": year,
                        "gl_code": gl_code, "accounts": accounts_final, "fees": []
                    }

        # Need either an account number or a description — otherwise skip
        account_number = None
        if isinstance(acct_cell, str) and acct_cell.strip():
            s = acct_cell.strip()
            if re.search(r"\d{" + str(min_account_len) + r",}", s) or re.search(r"[A-Za-z]+.*\d+", s):
                account_number = s

        description = None
        if isinstance(desc_cell, str) and desc_cell.strip():
            description = desc_cell.strip()
        elif isinstance(acct_cell, str) and acct_cell.strip() and not account_number:
            description = acct_cell.strip()

        meter_id = None
        if isinstance(meter_cell, str) and meter_cell.strip():
            meter_id = meter_cell.strip()

        # If no account_number and no description, skip
        if not account_number and not description:
            continue

        # Fake an account number if only description is present (for sheets like Phone/Cable
        # where some rows have a name but no account number)
        effective_id = account_number or f"desc:{description[:40]}"
        if effective_id in seen:
            continue

        # Collect monthly amounts
        by_month = {}
        for month_col, month_num in month_cols:
            v = _dec(ws.cell(r, month_col).value)
            if v is None or v == 0: continue
            entry = {"amount": float(v)}
            if extra_columns:
                for label, off in extra_columns.items():
                    ev = ws.cell(r, month_col + off).value
                    if ev is not None and ev != "":
                        entry[label] = ev if not isinstance(ev, str) else ev.strip()
            by_month[month_num] = entry

        if not by_month:
            continue

        seen.add(effective_id)
        accounts.append({
            "account_number": account_number,
            "description":    description,
            "meter_id":       meter_id,
            "by_month":       by_month,
        })

    if not accounts:
        return None
    return {
        "vendor_name": vendor_name, "vendor_code": vendor_code,
        "invoice_number_base": invoice_base, "year": year,
        "gl_code": gl_code, "accounts": accounts, "fees": []
    }


# Sheet-specific parsers — each understands its own layout's quirks.

def parse_house_meters_accounts(ws, year):
    """
    House Meters sheet — per-meter rows with 1-2 sub-columns per month.
    GL 5112 (House) / 5116 (Clubhouse).

    Layout:
      r10-13: header info (vendor, GL code 500-XXX-5112, invoice base)
      r16:    `Account Number | Unit No. | Meter No. | January | Deposit | January | Deposit | Feb | Mar | ...`
      r17+:   one row per meter

    The deduped month-header search returns the FIRST occurrence of each
    month, which is the correct charges column. The "Deposit-Refund"
    sub-columns are skipped automatically by the dedupe logic.
    """
    header_row, month_cols = _find_month_header_row(ws, start_row=10, end_row=22)
    if not month_cols or len(month_cols) < 6:
        return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    invoice_base = _find_invoice_base(ws)

    accounts = []
    seen = set()

    for r in range(header_row + 1, min(header_row + 100, ws.max_row + 1)):
        acct_cell  = ws.cell(r, 1).value
        unit_cell  = ws.cell(r, 2).value
        meter_cell = ws.cell(r, 3).value

        # Stop at total rows
        if _is_label(acct_cell):
            lo = acct_cell.strip().lower()
            if any(lo.startswith(s) for s in ("total", "subtotal", "grand total")):
                break

        account_number = None
        if isinstance(acct_cell, str) and acct_cell.strip():
            s = acct_cell.strip()
            if re.search(r"\d{4,}", s) and not any(k in s.lower() for k in FEE_KEYWORDS):
                account_number = s

        if not account_number:
            # Could be a section header row (e.g. "Club House") — skip silently
            continue

        if account_number in seen:
            continue

        unit_no  = unit_cell.strip()  if isinstance(unit_cell, str)  and unit_cell.strip()  else None
        meter_id = meter_cell.strip() if isinstance(meter_cell, str) and meter_cell.strip() else None

        by_month = {}
        for month_col, month_num in month_cols:
            v = _dec(ws.cell(r, month_col).value)
            if v is None or v <= 0: continue
            by_month[month_num] = {"amount": float(v)}

        if not by_month:
            continue

        seen.add(account_number)
        accounts.append({
            "account_number": account_number,
            "description":    unit_no,
            "meter_id":       meter_id,
            "by_month":       by_month,
        })

    if not accounts:
        return None
    return {
        "vendor_name":         vendor_name,
        "vendor_code":         vendor_code,
        "invoice_number_base": invoice_base,
        "year":                year,
        "gl_code":             "5112",
        "accounts":            accounts,
        "fees":                [],
    }


def parse_garbage_accounts(ws, year):
    """
    Garbage sheet — per-dumpster account, several layout variations.

    Variant 1 (Town Park, multi-pickup):
      r9-10:  account headers (e.g. "WM 15-00630-03006 _34 yd compactor")
      r12-15: per-pickup rows, amount + date string ("1/5", "1/12", etc.)

    Variant 2 (Hearthstone, single-line):
      r9:     "Republic | 3069.77 | 4 | 3069.32 | 4 | ..."
              vendor name in col 1, monthly amounts in even cols, pickup
              counts as integers in odd cols
      r10-11: account numbers listed beneath, no amounts

    The parser walks all rows, treating any row with a label in col 1 as a
    potential account header, and any row with monetary amounts in the month
    columns as data to attribute to the most recent header.
    """
    header_row, month_cols = _find_month_header_row(ws, start_row=4, end_row=15)
    if not month_cols or len(month_cols) < 6:
        return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    invoice_base = _find_invoice_base(ws)

    # Walk rows. Track current account header. A row can BOTH start a new
    # account (label in col 1) AND carry data (amounts in month cols).
    accounts_data = {}
    current_account = None
    current_description = None

    for r in range(header_row + 1, min(header_row + 50, ws.max_row + 1)):
        acct_cell = ws.cell(r, 1).value
        s = str(acct_cell).strip() if acct_cell is not None else ""
        lo = s.lower() if s else ""

        # Stop at totals / repair / adjustment sections
        if lo and any(lo.startswith(stop) for stop in ("total", "subtotal", "grand total", "summary", "repair", "adjust", "paid", "credits")):
            break

        # Is column 1 a usable label? Either:
        #   - A vendor name like "Republic" or "Costal Waste & Recycling #16"
        #   - An account number like "WM 15-00630-03006" or "3-0800-014932"
        is_label_row = bool(s) and (
            re.search(r"\d{4,}", s) or
            re.search(r"[A-Z]{2,}", s)
        )

        if is_label_row and lo not in ("january", "february", "march", "april", "may",
                                       "june", "july", "august", "september", "october",
                                       "november", "december", "account no.", "account"):
            # Use the first label encountered as the canonical account ID for the section.
            # Subsequent labels under the same vendor (like "3-0800-014932") become
            # additional account numbers, but data still attributes to the parent vendor row.
            if current_account is None or _row_has_amounts(ws, r, month_cols):
                # New section start
                # Try to extract a dumpster ID from the string
                m = re.search(r"([A-Z]{1,4}\s*\d{2,}[-\d]+)", s, re.IGNORECASE)
                acct_id = m.group(1).strip() if m else s[:60]
                current_account = acct_id
                current_description = s
                if acct_id not in accounts_data:
                    accounts_data[acct_id] = {
                        "description": s,
                        "by_month":    {},
                    }

        # Sum any monthly amounts on this row into the current account
        if current_account:
            for month_col, month_num in month_cols:
                v = _dec(ws.cell(r, month_col).value)
                if v is None or v <= 0: continue
                pickup_cell = ws.cell(r, month_col + 1).value
                pickup_label = str(pickup_cell).strip() if pickup_cell else None

                bucket = accounts_data[current_account]["by_month"].setdefault(
                    month_num, {"amount": 0.0, "pickups": 0, "pickup_labels": []}
                )
                bucket["amount"] += float(v)
                bucket["pickups"] += 1
                if pickup_label:
                    bucket["pickup_labels"].append(pickup_label)

    accounts = []
    for acct_num, data in accounts_data.items():
        if not data["by_month"]:
            continue
        for m, b in data["by_month"].items():
            b["amount"] = round(b["amount"], 2)
            if b["pickup_labels"]:
                b["pickup"] = ", ".join(b["pickup_labels"])
            del b["pickup_labels"]
        accounts.append({
            "account_number": acct_num,
            "description":    data["description"],
            "meter_id":       None,
            "by_month":       data["by_month"],
        })

    if not accounts:
        return None
    return {
        "vendor_name":         vendor_name,
        "vendor_code":         vendor_code,
        "invoice_number_base": invoice_base,
        "year":                year,
        "gl_code":             "5135",
        "accounts":            accounts,
        "fees":                [],
    }


def _row_has_amounts(ws, r, month_cols):
    """True if row r has a non-zero number in any month column."""
    for c, _ in month_cols:
        v = ws.cell(r, c).value
        if isinstance(v, (int, float)) and v > 0:
            return True
    return False


def parse_phone_cable_accounts(ws, year):
    """
    Phone & Cable sheet — per-row vendor (col 2) and account number (col 3).
    Header row typically: [GL | Vendor | ACCOUNT NO. | JAN | FEB | ...]
    Each row has its own vendor (Comcast, Level3, AT&T, etc.) — no single sheet vendor.

    Returns accounts with per-row 'vendor_name' tagged onto each account so the
    SQL emitter can use them instead of falling back to the sheet vendor.
    """
    gl_code = "5635"
    for r in range(1, 8):
        for c in range(1, 10):
            v = ws.cell(r, c).value
            if isinstance(v, str) and "5140" in v:
                gl_code = "5140"
                break

    header_row, month_cols = _find_month_header_row(ws, start_row=4, end_row=15)
    if not month_cols or len(month_cols) < 4:
        return None

    invoice_base = _find_invoice_base(ws)
    accounts = []
    seen = set()

    for r in range(header_row + 1, min(header_row + 80, ws.max_row + 1)):
        description  = ws.cell(r, 1).value
        vendor_cell  = ws.cell(r, 2).value
        acct_cell    = ws.cell(r, 3).value

        if _is_label(description) and description.strip().lower().startswith(("total", "adjust", "subtotal")):
            break

        desc = description.strip() if isinstance(description, str) and description.strip() else None
        row_vendor = vendor_cell.strip() if isinstance(vendor_cell, str) and vendor_cell.strip() else None
        acct_num = None
        if isinstance(acct_cell, str) and acct_cell.strip():
            s = acct_cell.strip()
            if re.search(r"\d{3,}", s) or re.search(r"[A-Za-z]+.*\d+", s):
                acct_num = s

        if not acct_num and not desc:
            continue

        effective_id = acct_num or f"desc:{(desc or '')[:40]}"
        if effective_id in seen:
            continue

        by_month = {}
        for month_col, month_num in month_cols:
            v = _dec(ws.cell(r, month_col).value)
            if v is None or v == 0: continue
            by_month[month_num] = {"amount": float(v)}

        if not by_month:
            continue

        seen.add(effective_id)
        accounts.append({
            "account_number": acct_num,
            "description":    desc,
            "meter_id":       None,
            "vendor_name":    row_vendor,
            "by_month":       by_month,
        })

    if not accounts:
        return None
    return {
        "vendor_name":         None,
        "vendor_code":         None,
        "invoice_number_base": invoice_base,
        "year":                year,
        "gl_code":             gl_code,
        "accounts":            accounts,
        "fees":                [],
    }


def parse_fedex_accounts(ws, year):
    """
    FedEx sheet — simple per-account grid. GL 5620.

    Layout:
      r1-4:   header (property, vendor='FedEx', GL, year)
      r6:     `Account Number | JANUARY | FEBRUARY | ... | DECEMBER | TOTAL`
      r7+:    one row per account (some rows omit the account number, continuing the previous one)
    """
    header_row, month_cols = _find_month_header_row(ws, start_row=4, end_row=15)
    if not month_cols or len(month_cols) < 6:
        return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    if not vendor_name:
        vendor_name = "FedEx"
    invoice_base = _find_invoice_base(ws)

    accounts = []
    seen = set()
    current_account = None

    for r in range(header_row + 1, min(header_row + 50, ws.max_row + 1)):
        acct_cell = ws.cell(r, 1).value

        if _is_label(acct_cell):
            lo = acct_cell.strip().lower()
            if lo.startswith(("total", "subtotal", "grand")):
                break

        # New account number in column 1?
        if isinstance(acct_cell, str) and acct_cell.strip():
            s = acct_cell.strip()
            if re.search(r"\d{3,}", s):
                current_account = s
                if current_account in seen:
                    # Same account appearing twice — keep the first
                    current_account = None
                    continue
                seen.add(current_account)
                accounts.append({
                    "account_number": current_account,
                    "description":    None,
                    "meter_id":       None,
                    "by_month":       {},
                })

        # Add monthly amounts to the current account
        if current_account:
            target = next((a for a in accounts if a["account_number"] == current_account), None)
            if not target: continue
            for month_col, month_num in month_cols:
                v = _dec(ws.cell(r, month_col).value)
                if v is None or v <= 0: continue
                # Sum if continuation row, set if first
                existing = target["by_month"].get(month_num, {}).get("amount", 0.0)
                target["by_month"][month_num] = {"amount": round(existing + float(v), 2)}

    accounts = [a for a in accounts if a["by_month"]]
    if not accounts:
        return None
    return {
        "vendor_name":         vendor_name,
        "vendor_code":         vendor_code,
        "invoice_number_base": invoice_base,
        "year":                year,
        "gl_code":             "5620",
        "accounts":            accounts,
        "fees":                [],
    }


def parse_vacant_units_accounts(ws, year):
    """
    Vacant Units sheet — per-unit rows. GL 5114.

    Layout varies wildly across properties:
      - Onion Creek:   `Account | Unit | Meter | <3 cols/month>`
      - Town Park:     `Account | Unit | Meter | <variable cols/month>`
      - Hearthstone:   `Account # | Account # | Meter # | Units # | <cols>`
                       (TWO account columns — one for the meter, one for billing)
      - Sunset Pointe: `ESI ID | Original Account | Meter | Unit | <cols>`

    To handle this we don't assume fixed column positions — we find the row
    above the first month header that contains "Unit", "Account", "Meter",
    "ESI" labels, and use whichever columns exist.

    Each unit row's monthly amount is the FIRST positive number in that
    month's column block — which is conventionally the "Charges" column,
    not the "Deposit" or "Balance Due" columns that may follow.
    """
    header_row, month_cols = _find_month_header_row(ws, start_row=4, end_row=14)
    if not month_cols or len(month_cols) < 6:
        return None

    # Find the column-label row — usually 1 row above the month-header row
    # (typical: column labels at row 7-9, months at row 8-10)
    label_row = None
    for tr in range(max(header_row - 2, 1), min(header_row + 3, ws.max_row + 1)):
        for c in range(1, min(ws.max_column + 1, 12)):
            v = ws.cell(tr, c).value
            if isinstance(v, str) and re.search(r"unit\s*(no|#)|account\s*(no|#)|esi", v.strip().lower()):
                label_row = tr
                break
        if label_row is not None:
            break
    if label_row is None:
        # Fallback: assume row above header
        label_row = header_row

    # Map labels to columns. Hearthstone has TWO "Account #" columns; we use
    # the LAST one (which is typically the billing-account column the meter
    # references, not the meter ID itself).
    col_account = None
    col_unit    = None
    col_meter   = None
    col_esi     = None
    for c in range(1, min(ws.max_column + 1, 16)):
        v = ws.cell(label_row, c).value
        if not isinstance(v, str): continue
        lo = v.strip().lower()
        if "esi" in lo and col_esi is None:
            col_esi = c
        elif ("unit no" in lo or "unit #" in lo or "units #" in lo or "units no" in lo) and col_unit is None:
            col_unit = c
        elif ("account no" in lo or "account #" in lo or "original account" in lo):
            col_account = c   # always the LAST account column found
        elif ("meter" in lo) and col_meter is None:
            col_meter = c

    # If unit column not found but we have ESI + meter, sometimes the row labels
    # are "ESI ID | Account | Meter | Unit No." — already covered. Skip if no unit.
    if col_unit is None:
        return None

    vendor_name, vendor_code = _find_vendor_header(ws)
    invoice_base = _find_invoice_base(ws)

    # Identify the "Charges" subcolumn for each month. If the label row has
    # explicit "Charges" labels under each month, use those. Otherwise, fall
    # back to the first column at the start of each month's block.
    charges_col_by_month = {}
    for idx, (start_col, month_num) in enumerate(month_cols):
        next_col = month_cols[idx + 1][0] if idx + 1 < len(month_cols) else ws.max_column + 1
        chosen = None
        for c in range(start_col, next_col):
            label = ws.cell(label_row, c).value if label_row != header_row else None
            if isinstance(label, str):
                lab = label.strip().lower()
                if "deposit" in lab or "refund" in lab or "balance" in lab or "depoist" in lab or "due" in lab:
                    continue
                if "charges" in lab:
                    chosen = c
                    break
        if chosen is None:
            chosen = start_col
        charges_col_by_month[month_num] = chosen

    units = []
    seen = set()

    for r in range(label_row + 1, min(label_row + 600, ws.max_row + 1)):
        unit_val = ws.cell(r, col_unit).value if col_unit else None

        # Stop at total/subtotal rows
        if isinstance(unit_val, str) and unit_val.strip().lower().startswith(("total", "subtotal")):
            break

        unit_str = None
        if isinstance(unit_val, str) and unit_val.strip():
            unit_str = unit_val.strip()
        elif isinstance(unit_val, (int, float)):
            unit_str = str(int(unit_val) if unit_val == int(unit_val) else unit_val)

        if not unit_str:
            continue

        # Account number from the matched column (or fall back to a property-level marker)
        account_number = None
        if col_account:
            av = ws.cell(r, col_account).value
            if isinstance(av, str) and av.strip():
                account_number = av.strip()
            elif isinstance(av, (int, float)) and av:
                account_number = str(int(av) if av == int(av) else av)

        # Build by_month
        by_month = {}
        for month_num, cc in charges_col_by_month.items():
            v = _dec(ws.cell(r, cc).value)
            if v is not None and v > 0:
                by_month[month_num] = {"amount": float(v)}

        if not by_month:
            continue

        unique_id = f"{account_number or 'NOACCT'}|{unit_str}"
        if unique_id in seen:
            continue
        seen.add(unique_id)

        meter_id = None
        if col_meter:
            mv = ws.cell(r, col_meter).value
            if isinstance(mv, str) and mv.strip():
                meter_id = mv.strip()

        esi_id = None
        if col_esi:
            ev = ws.cell(r, col_esi).value
            if isinstance(ev, str) and ev.strip():
                esi_id = ev.strip()

        units.append({
            "account_number": account_number or f"VACANT-{unit_str}",
            "description":    f"Unit {unit_str}",
            "unit_number":    unit_str,
            "meter_id":       meter_id,
            "esi_id":         esi_id,
            "by_month":       by_month,
        })

    if not units:
        return None
    return {
        "vendor_name":         vendor_name,
        "vendor_code":         vendor_code,
        "invoice_number_base": invoice_base,
        "year":                year,
        "gl_code":             "5114",
        "accounts":            units,
        "fees":                [],
    }


def parse_fixed_accounts(ws, year):
    """
    FIXED sheet — per-GL-code rows for non-utility expenses (legal, pest control,
    landscaping, etc.) that NuRock tracks alongside utilities for budgeting.

    Layout:
      r1-2:   "FIXED EXPENSES" / property name
      r3:     `GL AC# | Description | Fixed Cost | January | February | ... | December`
      r4-10:  Summary section (rolls up from other sheets — skip these)
      r11:    "TOTAL"
      r12-44: Real per-line-item rows (e.g. r13: "5345 | Advanced Fire & Safety | 1081.77 | | | 1081.77")

    We skip the summary section (rows whose GL matches one of the utility GLs
    handled by other sheets: 5112, 5114, 5120, 5125, 5135, 5140, 5635) and emit
    a synthetic utility_account per (gl, description) for everything else.

    Uses property name as the "vendor" since FIXED rows don't have one.
    """
    header_row, month_cols = _find_month_header_row(ws, start_row=2, end_row=8)
    if not month_cols or len(month_cols) < 6:
        return None

    # Property name is on r1 or r2
    property_name = None
    for r in (1, 2):
        v = ws.cell(r, 1).value
        if isinstance(v, str) and v.strip() and "FIXED" not in v.upper():
            property_name = v.strip()
            break

    # GLs we skip — these are summary rollups already handled by their dedicated sheets
    SUMMARY_GLS = {"5112", "5114", "5116", "5120", "5122", "5125", "5135", "5140", "5635", "5620"}

    accounts_by_key = {}

    for r in range(header_row + 1, min(header_row + 60, ws.max_row + 1)):
        gl_cell   = ws.cell(r, 1).value
        desc_cell = ws.cell(r, 2).value

        # Skip TOTAL rows + section breaks
        if _is_label(gl_cell):
            lo = gl_cell.strip().lower()
            if lo.startswith(("total", "subtotal", "grand")):
                continue

        # GL extraction — could be "5345" or "6020/6085" (multi-GL)
        gl_codes = []
        if gl_cell is not None:
            s = str(gl_cell).strip()
            for m in re.finditer(r"\b(\d{4})\b", s):
                gl = m.group(1)
                if gl not in gl_codes:
                    gl_codes.append(gl)

        if not gl_codes:
            continue

        # Skip rows that re-aggregate utility GLs already covered elsewhere
        if all(gl in SUMMARY_GLS for gl in gl_codes):
            continue

        description = None
        if isinstance(desc_cell, str) and desc_cell.strip():
            description = desc_cell.strip()
        if not description:
            continue

        # Build by_month — sum across all GLs on this row (most rows are single-GL)
        by_month = {}
        for month_col, month_num in month_cols:
            v = _dec(ws.cell(r, month_col).value)
            if v is None or v <= 0: continue
            by_month[month_num] = {"amount": float(v)}

        if not by_month:
            continue

        # Emit one synthetic account per GL — divide amount by number of GLs if multi
        amount_share = 1.0 / len(gl_codes)
        for gl in gl_codes:
            key = f"{gl}|{description[:60]}"
            if key in accounts_by_key:
                # Same description+gl on a later row — sum into the existing entry
                existing = accounts_by_key[key]
                for m, b in by_month.items():
                    cur = existing["by_month"].get(m, {"amount": 0.0})
                    existing["by_month"][m] = {
                        "amount": round(cur["amount"] + b["amount"] * amount_share, 2),
                    }
            else:
                accounts_by_key[key] = {
                    "account_number": f"FIXED-{gl}-{re.sub(r'[^A-Z0-9]', '', description.upper())[:20]}",
                    "description":    description,
                    "meter_id":       None,
                    "gl_code":        gl,
                    # Each row's description doubles as the vendor name —
                    # FIXED rows are essentially "vendor: cost".
                    "vendor_name":    description,
                    "by_month":       {
                        m: {"amount": round(b["amount"] * amount_share, 2)}
                        for m, b in by_month.items()
                    },
                }

    accounts = list(accounts_by_key.values())
    if not accounts:
        return None
    return {
        "vendor_name":         property_name or "Fixed expenses",
        "vendor_code":         None,
        "invoice_number_base": None,
        "year":                year,
        "gl_code":             None,  # accounts carry per-row gl_code
        "accounts":            accounts,
        "fees":                [],
    }
