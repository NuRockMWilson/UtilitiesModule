#!/usr/bin/env python3
"""
House Meters parser for NuRock legacy workbooks.

Reads the "House Meters" / "Hse Meters" / "Hse Mtr" / "House" sheet of a
per-property workbook and returns per-meter monthly detail.

Output shape per property:
  {
    'vendor_name':     'Georgia Power',
    'meters': [
      {
        'meter_id':    '2906725',
        'account_number': '10681-91016',
        'esi_id':      '1044372000829232',       # Texas properties only
        'description': 'HSE 2000',
        'category':    'house' | 'clubhouse' | 'pool' | 'trash' | 'lighting' | 'other',
        'gl_code':     '5112',
        'monthly_amounts': { 1: 101.98, 2: 89.33, ... },
      }, ...
    ],
  }

Handles variations across the 18 property files:
  • sheet names: 'House Meters', 'Hse Meters', 'House Meter', 'Hse Mtr', 'House'
  • column layouts: single-col months (stride 1), double-col months (stride 2)
  • metadata rows above grid: vary between row 6-15 depending on sheet
"""
import re
from decimal import Decimal

MONTH_FULL = {
    "JANUARY": 1, "FEBRUARY": 2, "FEBUARY": 2, "MARCH": 3, "APRIL": 4,
    "MAY": 5, "JUNE": 6, "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9,
    "OCTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12,
}
MONTH_SHORT = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "SEPT": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# Meter description → category classifier
CATEGORY_MAP = [
    ("club house",        "clubhouse"),
    ("clubhouse",         "clubhouse"),
    ("pool",              "pool"),
    ("trash compactor",   "trash"),
    ("trash",             "trash"),
    ("compactor",         "trash"),
    ("unregulated",       "lighting"),
    ("lighting",          "lighting"),
    ("light",             "lighting"),
    ("irrigation",        "irrigation"),
    ("laundry",           "laundry"),
    ("gate",              "gate"),
    ("sign",              "sign"),
    ("leasing",           "leasing"),
    ("office",            "leasing"),
    ("hse",               "house"),
    ("house",             "house"),
]


def to_dec(v):
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
        return d if abs(d) > Decimal("0.001") else None
    except Exception:
        return None


def classify_meter(description):
    if not description:
        return "other"
    lo = description.lower().strip()
    for key, cat in CATEGORY_MAP:
        if key in lo:
            return cat
    return "other"


def find_house_meters_sheet(wb):
    for cand in ("House Meters", "Hse Meters", "House Meter", "Hse Mtr", "House"):
        if cand in wb.sheetnames:
            return cand
    for s in wb.sheetnames:
        lo = s.lower().strip()
        if "house" in lo or "hse" in lo:
            return s
    return None


def find_all_month_header_rows(ws):
    """Find every month-header row in the sheet (some sheets have multiple grids).

    Returns a list of (header_row, month_cols_list) tuples. A row qualifies if it
    contains at least 3 distinct month names. Skips rows whose first-column
    label indicates a previous grid's total — those are not header rows.
    """
    results = []
    for r in range(1, min(ws.max_row + 1, 80)):
        month_cols = []
        for c in range(1, min(ws.max_column + 1, 40)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_FULL:
                month_cols.append((c, MONTH_FULL[up]))
            elif up in MONTH_SHORT:
                month_cols.append((c, MONTH_SHORT[up]))
        distinct_months = len(set(m for _, m in month_cols))
        if distinct_months >= 3:
            results.append((r, month_cols))
    return results


def find_month_header_row(ws):
    """Back-compat wrapper — returns the FIRST month header row."""
    all_rows = find_all_month_header_rows(ws)
    if all_rows:
        return all_rows[0]
    return (None, None)


def identify_description_col(ws, header_row, first_month_col):
    """Scan the header row to the LEFT of the first month column for a
    description-like header. Priority order, since some sheets have both:
      1. 'Description' (Hearthstone, Crystal Lakes)
      2. 'Unit No.' / 'Unit' (Sunset Pointe, Onion Creek)
      3. 'Meter ID' (EC Tyler)
    """
    # First pass: Description or Unit
    for c in range(first_month_col - 1, 0, -1):
        v = ws.cell(header_row, c).value
        if isinstance(v, str):
            lo = v.lower().strip()
            if "description" in lo or lo.startswith("unit"):
                return c
    # Second pass: any meter/ID column
    for c in range(first_month_col - 1, 0, -1):
        v = ws.cell(header_row, c).value
        if isinstance(v, str):
            lo = v.lower().strip()
            if "meter" in lo:
                return c
    # Default: column immediately left of first month
    return first_month_col - 1


def identify_account_and_meter_cols(ws, header_row, desc_col):
    """Find account number and meter id columns to the left of description.
    Returns (account_col, meter_col, esi_col) — any may be None.
    """
    account_col = meter_col = esi_col = None
    for c in range(1, desc_col):
        v = ws.cell(header_row, c).value
        if not isinstance(v, str): continue
        lo = v.lower().strip()
        if "esi" in lo:
            esi_col = c
        elif ("account" in lo and account_col is None) or ("acct" in lo and account_col is None):
            account_col = c
        elif "meter" in lo and meter_col is None:
            meter_col = c
    return account_col, meter_col, esi_col


def _parse_meter_grid(ws, header_row, month_cols):
    """Parse one meter grid starting at header_row. Returns list of meter dicts.

    Walks rows below the header until hitting a Total/Adjust row or running
    out of rows.
    """
    first_month_col = month_cols[0][0]

    # Consolidate duplicate month columns
    month_to_cols = {}
    for col, m in month_cols:
        month_to_cols.setdefault(m, []).append(col)

    desc_col = identify_description_col(ws, header_row, first_month_col)
    account_col, meter_col, esi_col = identify_account_and_meter_cols(ws, header_row, desc_col)

    meters = []
    seen_blank_streak = 0
    for data_row in range(header_row + 1, ws.max_row + 1):
        desc_val  = ws.cell(data_row, desc_col).value
        acct_val  = ws.cell(data_row, account_col).value if account_col else None
        meter_val = ws.cell(data_row, meter_col).value   if meter_col   else None
        esi_val   = ws.cell(data_row, esi_col).value     if esi_col     else None

        def to_str(v):
            if v is None: return None
            s = str(v).strip()
            return s if s else None

        desc_str = to_str(desc_val) or ""
        identifier = desc_str or to_str(meter_val) or to_str(acct_val) or to_str(esi_val) or ""

        lo_id = identifier.lower() if identifier else ""
        if lo_id.startswith("total") or lo_id.startswith("adjust"):
            break
        for col_idx in (1, 2):
            probe = ws.cell(data_row, col_idx).value
            if isinstance(probe, str) and probe.strip().lower().startswith(("total", "adjust")):
                lo_id = "total"
                break
        if lo_id == "total":
            break

        monthly = {}
        for m, cols in sorted(month_to_cols.items()):
            month_total = Decimal(0)
            for c in cols:
                v = to_dec(ws.cell(data_row, c).value)
                if v is not None:
                    month_total += v
            if month_total > 0:
                monthly[m] = month_total

        if not monthly and not identifier:
            seen_blank_streak += 1
            if seen_blank_streak > 5:
                break
            continue
        seen_blank_streak = 0

        if not monthly:
            continue

        meters.append({
            "account_number":  to_str(acct_val),
            "meter_id":        to_str(meter_val),
            "esi_id":          to_str(esi_val),
            "description":     desc_str or identifier,
            "category":        classify_meter(desc_str or identifier),
            "gl_code":         "5116" if classify_meter(desc_str or identifier) == "clubhouse" else "5112",
            "monthly_amounts": monthly,
        })
    return meters


def parse_house_meters(wb, property_code, year):
    """Returns dict with vendor_name and per-meter monthly detail, or None.

    Handles sheets with multiple meter grids (e.g. Vista Grand, Beverly Park)
    by scanning for every month-header row and parsing each grid separately.
    """
    sheet_name = find_house_meters_sheet(wb)
    if not sheet_name:
        return None
    ws = wb[sheet_name]

    all_grids = find_all_month_header_rows(ws)
    if not all_grids:
        return None

    all_meters = []
    seen = set()
    for header_row, month_cols in all_grids:
        grid_meters = _parse_meter_grid(ws, header_row, month_cols)
        for m in grid_meters:
            # De-dupe on (account, meter, description) — if the same meter
            # appears in two grids, keep the one with more monthly data.
            key = (m.get("account_number"), m.get("meter_id"), m["description"])
            if key in seen:
                # Replace if new has more months
                existing_idx = next((i for i, em in enumerate(all_meters)
                                     if (em.get("account_number"), em.get("meter_id"), em["description"]) == key), None)
                if existing_idx is not None and len(m["monthly_amounts"]) > len(all_meters[existing_idx]["monthly_amounts"]):
                    all_meters[existing_idx] = m
                continue
            seen.add(key)
            all_meters.append(m)

    # Find vendor name — conventionally in row 3 or 4 col A.
    # Skip the property-name row (typically row 1 or 2) by matching known
    # vendor keywords. If nothing found by keyword, fall back to "first
    # non-property-looking row".
    vendor_name = None
    VENDOR_KEYWORDS = ("power", "energy", "electric", "gas", "utility",
                       "constellation", "txu", "georgia power", "tnmp",
                       "entergy", "duke", "dominion", "xcel", "ameren",
                       "comed", "eversource", "con ed", "pg&e", "sdge", "ppl",
                       "fpl", "fort wayne light", "reliant", "green mountain")
    for r in range(1, 10):
        a = ws.cell(r, 1).value
        if not isinstance(a, str): continue
        s = a.strip()
        if len(s) < 3: continue
        lo = s.lower()
        if any(kw in lo for kw in VENDOR_KEYWORDS):
            vendor_name = s
            break
    # Fallback: last non-header string in rows 1-8, skipping the property name
    if not vendor_name:
        for r in range(3, 9):
            a = ws.cell(r, 1).value
            if not isinstance(a, str): continue
            s = a.strip()
            lo = s.lower()
            if 3 < len(s) < 40 and "year" not in lo and "meter" not in lo \
                    and "hse" not in lo and "500-" not in s \
                    and "invoice" not in lo and "account" not in lo \
                    and not re.match(r"^\d", s):
                vendor_name = s
                break

    return {
        "property_code": property_code,
        "vendor_name":   vendor_name,
        "year":          year,
        "meters":        all_meters,
    }
