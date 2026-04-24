#!/usr/bin/env python3
"""
Vacant Units parser for NuRock legacy workbooks.

Reads the "Vacant Units" / "Vac Units" / "Vacant" / "Vacant Unit" sheet and
returns per-unit, per-month vacancy charges.

Output shape per property:
  {
    'property_code': '555',
    'year':          2026,
    'units': [
      {
        'unit_number':     '116-Model',
        'building_number': '3820' | None,
        'meter_id':        '104996252LG' | None,
        'esi_id':          '1044372000990824' | None,
        'account_number':  '990-8485-99-9' | None,
        'monthly_amounts': { 1: 53.91, 2: 65.46, 3: 26.59, ... },
      }, ...
    ],
  }

Structurally identical to House Meters parsing: month-header row, unit rows
below. Reuses the same grid detection helpers from _house_meters_parser.
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


def to_dec(v):
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
        return d if abs(d) > Decimal("0.001") else None
    except Exception:
        return None


def find_vacant_sheet(wb):
    for cand in ("Vacant Units", "Vac Units", "Vacant Unit", "Vacant"):
        if cand in wb.sheetnames:
            return cand
    for s in wb.sheetnames:
        if "vac" in s.lower():
            return s
    return None


def find_month_header_row(ws):
    """Scan rows 1–25 for a row containing 3+ distinct month names."""
    for r in range(1, 26):
        month_cols = []
        for c in range(1, min(ws.max_column + 1, 50)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_FULL:
                month_cols.append((c, MONTH_FULL[up]))
            elif up in MONTH_SHORT:
                month_cols.append((c, MONTH_SHORT[up]))
        distinct = len(set(m for _, m in month_cols))
        if distinct >= 3:
            return (r, month_cols)
    return (None, None)


def identify_columns(ws, header_row, first_month_col):
    """Find unit / meter / account / esi / building columns to the LEFT
    of the first month column. Returns dict of semantic → column.

    Scans both `header_row` and `header_row + 1` (some sheets have month
    names on one row and identifier column labels on the next).

    For duplicate labels (e.g. 'APT #' appears twice), prefers the column
    closest to the first month — that's the one with actual unit numbers.
    """
    cols = {}
    for row_offset in (0, 1):
        r = header_row + row_offset
        for c in range(1, first_month_col):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            lo = v.lower().strip()
            if "esi" in lo:
                cols["esi"] = c                                           # single-match fine
            elif "unit" in lo:
                # Prefer rightmost (closest to month columns) match for unit
                cols["unit"] = c
            elif "apt" in lo:
                cols["unit"] = c
            elif "meter" in lo and "meter" not in cols:
                cols["meter"] = c
            elif ("account" in lo or "acct" in lo) and "account" not in cols:
                cols["account"] = c
            elif "building" in lo and "building" not in cols:
                cols["building"] = c
            elif "address" in lo and "address" not in cols:
                cols["address"] = c
    return cols


def parse_vacant_units(wb, property_code, year):
    """Returns dict with per-unit monthly charges, or None if no sheet/data."""
    sheet_name = find_vacant_sheet(wb)
    if not sheet_name:
        return None
    ws = wb[sheet_name]

    header_row, month_cols = find_month_header_row(ws)
    if not header_row:
        return None

    first_month_col = month_cols[0][0]
    month_to_cols = {}
    for col, m in month_cols:
        month_to_cols.setdefault(m, []).append(col)

    cols = identify_columns(ws, header_row, first_month_col)
    if "unit" not in cols:
        # No Unit column — can't tie charges to specific units. Bail.
        return None

    units = []
    seen_blank_streak = 0
    for data_row in range(header_row + 1, ws.max_row + 1):
        def cell(label):
            c = cols.get(label)
            return ws.cell(data_row, c).value if c else None

        def to_str(v):
            if v is None: return None
            s = str(v).strip()
            return s if s else None

        unit_val     = cell("unit")
        meter_val    = cell("meter")
        account_val  = cell("account")
        esi_val      = cell("esi")
        building_val = cell("building")

        unit_str = to_str(unit_val) or ""

        # Skip sub-header rows like "BLDG. 1", "Totals", "Adjust - AP"
        lo = unit_str.lower() if unit_str else ""
        if lo.startswith(("total", "adjust", "bldg", "building")):
            # Sub-header, not a terminator — keep scanning
            if lo.startswith(("total", "adjust")):
                # Actually stop at totals/adjusts
                break
            continue

        # Also check first column for terminators
        for col_idx in (1,):
            probe = ws.cell(data_row, col_idx).value
            if isinstance(probe, str):
                probe_lo = probe.strip().lower()
                if probe_lo.startswith(("total", "adjust")):
                    lo = "total"
                    break
        if lo == "total":
            break

        # Extract monthly amounts
        monthly = {}
        for m, c_list in sorted(month_to_cols.items()):
            total = Decimal(0)
            for c in c_list:
                v = to_dec(ws.cell(data_row, c).value)
                if v is not None:
                    total += v
            if total > 0:
                monthly[m] = total

        if not monthly and not unit_str:
            seen_blank_streak += 1
            if seen_blank_streak > 8:
                break
            continue
        seen_blank_streak = 0

        # Skip units with no monthly data — they were never vacant that year
        if not monthly:
            continue
        if not unit_str:
            continue

        units.append({
            "unit_number":     unit_str,
            "building_number": to_str(building_val),
            "meter_id":        to_str(meter_val),
            "esi_id":          to_str(esi_val),
            "account_number":  to_str(account_val),
            "monthly_amounts": monthly,
        })

    return {
        "property_code": property_code,
        "year":          year,
        "units":         units,
    }
