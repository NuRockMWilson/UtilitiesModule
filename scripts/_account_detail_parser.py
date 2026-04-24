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


def _find_month_header_row(ws):
    """Locate the row whose cells contain month names (Jan/Feb/..). Returns (row_idx, [(col, month_int), ...])."""
    for r in range(6, 20):
        cols = []
        for c in range(1, min(ws.max_column + 1, 80)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_NAMES_FULL:
                cols.append((c, MONTH_NAMES_FULL[up]))
            elif up in MONTH_NAMES_SHORT:
                cols.append((c, MONTH_NAMES_SHORT[up]))
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


def _find_vendor_header(ws):
    """Grab vendor name + code from rows 1-4 of the sheet."""
    vendor_name, vendor_code = None, None
    for r in range(1, 6):
        a = ws.cell(r, 1).value
        b = ws.cell(r, 2).value
        if isinstance(a, str):
            s = a.strip()
            lo = s.lower()
            # Vendor name markers
            if ("utility" in lo or "utilities" in lo or "water" in lo
                or "county" in lo or "city of" in lo or "municipal" in lo) \
               and "500-" not in s and "year" not in lo \
               and len(s) > 6 and not re.match(r"^\d", s):
                vendor_name = s
                if isinstance(b, str) and b.strip() and len(b.strip()) < 25:
                    vendor_code = b.strip()
                break
    return vendor_name, vendor_code


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


# Sheet-specific wrappers that dial in the right column positions.
# Each targets a specific legacy workbook sheet layout.

def parse_house_meters_accounts(ws, year):
    """
    House Meters sheet — per-meter rows, one amount per month.
    GL 5112 (House) / 5116 (Clubhouse). Most workbooks put the account number
    in col A and the description/meter in col B or further columns.
    """
    # House Meters sheets vary but typically have:
    #   Col 1: Account No. or description
    #   Col 2: Meter ID
    #   Month columns starting at col 3-4
    return _scan_simple_grid(ws, year, gl_code="5112",
                             account_col=1, description_col=2, meter_col=3)


def parse_garbage_accounts(ws, year):
    """
    Garbage sheet — one row per dumpster/account, paired columns for amount and pickup date.
    Layout: [Account No. | Jan_amount | Jan_pickup | Feb_amount | Feb_pickup | ...]
    """
    return _scan_simple_grid(ws, year, gl_code="5135",
                             account_col=1, description_col=None,
                             extra_columns={"pickup": 1})


def parse_phone_cable_accounts(ws, year):
    """
    Phone & Cable sheet — header row like:
      Phone 500-601-5635 | Vendor | ACCOUNT NO. | JAN | FEB | ...
    Vendor code is col 2, Account No. col 3, month columns start col 4.
    Returns 2 tables: phone and cable. This is a best-effort single-GL pass;
    all rows are tagged with the GL code from the sheet header (phone OR cable).
    """
    # Detect whether this sheet covers Phone (5635), Cable (5140), or both
    gl_code = "5635"
    for r in range(1, 8):
        for c in range(1, 10):
            v = ws.cell(r, c).value
            if isinstance(v, str) and "5140" in v:
                gl_code = "5140"
                break

    return _scan_simple_grid(ws, year, gl_code=gl_code,
                             account_col=3, description_col=1, meter_col=2)


def parse_fedex_accounts(ws, year):
    """
    FedEx sheet — account number col 1, months col 2+.
    GL 5620.
    """
    return _scan_simple_grid(ws, year, gl_code="5620",
                             account_col=1, description_col=None)


def parse_vacant_units_accounts(ws, year):
    """
    Vacant Units sheet — per-unit rows. Layout:
      [Account No. | Unit No. | Meter No. | JAN amount | JAN amount | Deposit | Balance | ...]
    GL 5114. Each unit is its own 'account' for our purposes.
    """
    return _scan_simple_grid(ws, year, gl_code="5114",
                             account_col=1, description_col=2, meter_col=3)
