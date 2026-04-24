#!/usr/bin/env python3
"""
Phone / Cable / FedEx / FIXED parser for NuRock legacy workbooks.

Extracts the "fixed-cost" categories:
  - Phone  (GL 5635) from 'Phone' or 'Phone&Cable' sheet
  - Cable  (GL 5140) from 'Phone&Cable' sheet (second grid) or the stacked "Cable" section
  - FedEx  (GL 5620) from 'FedEx' / 'Fedex' sheet
  - FIXED  miscellaneous expenses at various GL codes from 'FIXED' sheet

Output shape per property:
  {
    'property_code': '555',
    'year':          2026,
    'categories': {
      'phone':  [{'month': 1, 'amount': 1328.91}, {'month': 2, 'amount': 1328.91}, ...],
      'cable':  [{'month': 1, 'amount': 10484.57}, ...],
      'fedex':  [{'month': 1, 'amount': 740.82}, ...],
      'fixed':  [{'gl_code': '5655', 'description': 'Attorney Fees',
                  'month': 1, 'amount': 6777.50}, ...],
    }
  }
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


def find_all_grid_headers(ws):
    """Find every month-header row. Returns list of (row, month_cols)."""
    results = []
    for r in range(1, min(ws.max_row + 1, 60)):
        month_cols = []
        for c in range(1, min(ws.max_column + 1, 25)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_FULL:
                month_cols.append((c, MONTH_FULL[up]))
            elif up in MONTH_SHORT:
                month_cols.append((c, MONTH_SHORT[up]))
        if len(set(m for _, m in month_cols)) >= 3:
            results.append((r, month_cols))
    return results


def _sum_grid_months(ws, header_row, month_cols, end_row_hint=None):
    """Sum all positive numeric values under each month column between
    header_row+1 and end_row_hint (or the next Total/Adjust row).

    Skips rows whose col A starts with Total/Adjust/Credit (these mark the
    end of a grid section).
    """
    amounts = {m: Decimal(0) for _, m in month_cols}
    # Dedup to first column per month number (the primary value column)
    first_col_per_month = {}
    for col, m in month_cols:
        if m not in first_col_per_month:
            first_col_per_month[m] = col

    end_row = end_row_hint or (header_row + 30)

    for r in range(header_row + 1, min(end_row, ws.max_row + 1)):
        a = ws.cell(r, 1).value
        if isinstance(a, str):
            lo = a.strip().lower()
            if lo.startswith(("total", "adjust", "credit", "paid")):
                break

        for m, col in first_col_per_month.items():
            v = to_dec(ws.cell(r, col).value)
            if v is not None and v > 0:
                amounts[m] += v

    return [{"month": m, "amount": amt} for m, amt in sorted(amounts.items()) if amt > 0]


def parse_phone_cable(wb, property_code, year):
    """Parse 'Phone' or 'Phone&Cable' sheet. Returns { phone: [...], cable: [...] }.

    Phone & Cable sheets have two stacked grids — Phone first, then Cable.
    Each grid has its own Total row that marks the end of that section.
    """
    sheet_name = None
    for cand in ("Phone&Cable", "Phone", "Phone & Cable", "Phone and Cable"):
        if cand in wb.sheetnames:
            sheet_name = cand; break
    if not sheet_name:
        for s in wb.sheetnames:
            if "phone" in s.lower() or "cable" in s.lower():
                sheet_name = s; break
    if not sheet_name:
        return {"phone": [], "cable": []}

    ws = wb[sheet_name]
    grids = find_all_grid_headers(ws)
    if not grids:
        return {"phone": [], "cable": []}

    phone = []
    cable = []

    for i, (hr, mc) in enumerate(grids):
        # Identify grid by scanning the 3 rows above for 'Phone' or 'Cable' keywords
        kind = None
        for probe_r in range(max(1, hr - 4), hr):
            for c in range(1, 5):
                v = ws.cell(probe_r, c).value
                if isinstance(v, str):
                    lo = v.lower()
                    if "phone" in lo and "cable" not in lo: kind = kind or "phone"
                    elif "cable" in lo and "phone" not in lo: kind = kind or "cable"
        # If we can't tell by label, fall back to position: first grid = phone, second = cable
        if kind is None:
            kind = "phone" if i == 0 else "cable"

        # End of this grid is the next grid's header row (or end of sheet)
        next_hr = grids[i + 1][0] if i + 1 < len(grids) else None

        months = _sum_grid_months(ws, hr, mc, end_row_hint=next_hr)
        if kind == "phone" and not phone:
            phone = months
        elif kind == "cable" and not cable:
            cable = months

    return {"phone": phone, "cable": cable}


def parse_fedex(wb, property_code, year):
    """Parse 'FedEx' / 'Fedex' sheet. Returns list of monthly totals."""
    sheet_name = None
    for cand in ("FedEx", "Fedex", "FEDEX"):
        if cand in wb.sheetnames:
            sheet_name = cand; break
    if not sheet_name:
        for s in wb.sheetnames:
            if "fedex" in s.lower() or "fed ex" in s.lower():
                sheet_name = s; break
    if not sheet_name:
        return []

    ws = wb[sheet_name]
    grids = find_all_grid_headers(ws)
    if not grids:
        return []

    hr, mc = grids[0]
    return _sum_grid_months(ws, hr, mc)


def parse_fixed(wb, property_code, year):
    """Parse 'FIXED' sheet. Returns list of per-GL-code monthly rollups:
      [{'gl_code': '5655', 'description': 'Attorney Fees',
        'month': 1, 'amount': 6777.50}, ...]
    """
    if "FIXED" not in wb.sheetnames:
        return []
    ws = wb["FIXED"]

    grids = find_all_grid_headers(ws)
    if not grids:
        return []

    hr, mc = grids[0]

    # FIXED has col A = GL code, col B = description, col C = "Fixed Cost"
    # annotation, cols D..O = January..December, col P = Total
    first_month_col = mc[0][0]

    month_col_map = {}
    for col, m in mc:
        if m not in month_col_map:
            month_col_map[m] = col

    rows_out = []
    for r in range(hr + 1, ws.max_row + 1):
        gl_cell = ws.cell(r, 1).value
        desc_cell = ws.cell(r, 2).value

        # Stop on Total row
        desc_str = str(desc_cell).strip() if desc_cell else ""
        if desc_str.lower().startswith("total") and not gl_cell:
            # Blank GL + "TOTAL" description = the Sub-total row, keep going
            continue

        # Valid row needs a GL code (4-digit) or a description
        gl_code = None
        if gl_cell:
            s = str(gl_cell).strip()
            if re.match(r"^\d{4}(/\d{4})?$", s):
                # Handle "6020/6085" style by taking first
                gl_code = s.split("/")[0]
        if not gl_code:
            continue
        if not desc_str:
            continue

        for month, col in month_col_map.items():
            amt = to_dec(ws.cell(r, col).value)
            if amt and amt > 0:
                rows_out.append({
                    "gl_code":     gl_code,
                    "description": desc_str,
                    "month":       month,
                    "amount":      amt,
                })

    return rows_out


def parse_fixed_categories(wb, property_code, year):
    """Main entry point — parses all four categories at once.

    Returns: {
      'property_code': '555',
      'year':          2026,
      'categories': {
        'phone': [...], 'cable': [...], 'fedex': [...], 'fixed': [...]
      },
    }
    """
    pc_data = parse_phone_cable(wb, property_code, year)
    return {
        "property_code": property_code,
        "year":          year,
        "categories": {
            "phone":  pc_data["phone"],
            "cable":  pc_data["cable"],
            "fedex":  parse_fedex(wb, property_code, year),
            "fixed":  parse_fixed(wb, property_code, year),
        },
    }
