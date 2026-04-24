#!/usr/bin/env python3
"""
Garbage / Trash parser for NuRock legacy workbooks.

Reads the 'Garbage' / 'Gas-Trash' sheet and returns monthly trash charges
alongside pickup counts, enabling count-normalized variance analysis
("cost per pickup went from $150 to $195" rather than just "total spiked").

Output shape per property:
  {
    'property_code': '555',
    'year':          2026,
    'vendor_name':   'Republic Services',
    'account_number':'3-0794-7078469',
    'months': [
      { 'month': 1, 'amount': 2383.72, 'pickups': 3 },
      { 'month': 2, 'amount': 3831.42, 'pickups': 5 },
      ...
    ],
  }

Walton Reserve (509) combines Gas + Trash in one sheet; this parser finds
and extracts only the TRASH grid. Gas is parsed separately in Priority 5.
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

# The "pickup count" column header can be any of these
PICKUP_LABELS = ("pickup", "pick up", "pickups", "date")


def to_dec(v):
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
        return d if abs(d) > Decimal("0.001") else None
    except Exception:
        return None


def find_garbage_sheet(wb):
    for cand in ("Garbage", "Trash", "Gas-Trash"):
        if cand in wb.sheetnames:
            return cand
    for s in wb.sheetnames:
        lo = s.lower()
        if "garbage" in lo or "trash" in lo:
            return s
    return None


def find_trash_grid(ws):
    """Find the TRASH month-header row in the sheet.

    For sheets with both Gas and Trash (Walton Reserve), pick the grid whose
    surrounding rows reference trash / republic / waste. For single-purpose
    sheets, returns the first grid found.
    """
    grids = []
    for r in range(1, min(ws.max_row + 1, 40)):
        month_cols = []
        for c in range(1, min(ws.max_column + 1, 40)):
            v = ws.cell(r, c).value
            if not isinstance(v, str): continue
            up = v.strip().upper()
            if up in MONTH_FULL:
                month_cols.append((c, MONTH_FULL[up]))
            elif up in MONTH_SHORT:
                month_cols.append((c, MONTH_SHORT[up]))
        if len(set(m for _, m in month_cols)) >= 3:
            grids.append((r, month_cols))

    if not grids:
        return None, None

    # If there's just one grid, return it
    if len(grids) == 1:
        return grids[0]

    # Otherwise find the one that looks like Trash — scan the 3 rows above
    # each grid for trash/waste/republic keywords.
    best = None
    best_score = -1
    for hr, mc in grids:
        score = 0
        for r_probe in range(max(1, hr - 5), hr):
            for c in range(1, 5):
                v = ws.cell(r_probe, c).value
                if isinstance(v, str):
                    lo = v.lower()
                    if "trash" in lo or "garbage" in lo:
                        score += 3
                    if "republic" in lo or "waste" in lo or "wm " in lo:
                        score += 2
                    if "gas" in lo and "logs" not in lo:
                        score -= 2
                    if "500-" in v and "-5135" in v:
                        score += 5
                    if "500-" in v and "-5130" in v:  # Gas GL — penalize
                        score -= 5
        if score > best_score:
            best_score = score
            best = (hr, mc)
    return best or grids[0]


def parse_garbage(wb, property_code, year):
    """Returns dict with monthly trash data, or None if no sheet/data."""
    sheet_name = find_garbage_sheet(wb)
    if not sheet_name:
        return None
    ws = wb[sheet_name]

    header_row, month_cols = find_trash_grid(ws)
    if not header_row:
        return None

    # Identify which column under each month holds the PICKUP count.
    # Typical layout: month col = amount, next col = pickup count.
    # So we look at header_row for each month_col, then check header_row at col+1
    # for a "pickup"/"date"/"pickups" label.
    # Organize month_cols by (month_num -> amount_col).
    # Some sheets have the pickup col adjacent; others don't have pickup at all.
    amount_col_by_month = {}
    for col, m in month_cols:
        # Keep the first occurrence per month (the amount column, not pickup)
        if m not in amount_col_by_month:
            amount_col_by_month[m] = col

    # Detect pickup column positions by scanning header_row to the right of each month
    pickup_col_by_month = {}
    for month, amt_col in amount_col_by_month.items():
        for offset in (1, 2):
            probe = ws.cell(header_row, amt_col + offset).value
            if isinstance(probe, str):
                lo = probe.lower().strip()
                if any(lbl in lo for lbl in PICKUP_LABELS):
                    pickup_col_by_month[month] = amt_col + offset
                    break

    # Find vendor — scan rows 1-5 for known trash vendor keywords
    VENDOR_KEYWORDS = ("republic", "waste management", "wm ", "waste pro", "waste connections",
                       "coastal waste", "casella", "advanced disposal", "progressive waste",
                       "allied waste")
    vendor_name = None
    for r in range(1, 6):
        v = ws.cell(r, 1).value
        if isinstance(v, str):
            lo = v.lower()
            if any(kw in lo for kw in VENDOR_KEYWORDS):
                vendor_name = v.strip()
                break

    # Account number — first cell in col A below header that looks like an account number
    # Walk data rows looking for pattern like "3-0794-7078469", "15-00630-03", etc.
    account_number = None
    for r in range(header_row + 1, min(header_row + 8, ws.max_row + 1)):
        for c in (1, 2):
            v = ws.cell(r, c).value
            if isinstance(v, str):
                s = v.strip()
                if re.match(r"^\d[\d\-\. ]{5,}", s) and "-" in s:
                    account_number = s
                    break
        if account_number: break

    # Walk data rows and sum amount + pickup counts per month.
    # Each month can have multiple sub-rows (Town Park has 4 weekly pickups per month),
    # so we aggregate.
    monthly_amounts = {m: Decimal(0) for m in amount_col_by_month}
    monthly_pickups = {m: 0 for m in pickup_col_by_month}

    for r in range(header_row + 1, min(header_row + 20, ws.max_row + 1)):
        a = ws.cell(r, 1).value
        if isinstance(a, str):
            lo = a.strip().lower()
            if lo.startswith(("total", "adjust", "credit", "repair")):
                break

        for month, amt_col in amount_col_by_month.items():
            amt = to_dec(ws.cell(r, amt_col).value)
            if amt is not None:
                monthly_amounts[month] += amt

        for month, p_col in pickup_col_by_month.items():
            v = ws.cell(r, p_col).value
            if isinstance(v, (int, float)) and v > 0 and v < 50:
                monthly_pickups[month] += int(v)
            elif isinstance(v, str):
                s = v.strip()
                # Pure digit string — pickup count stored as text (e.g. 555 Sunset Pointe)
                if re.match(r"^\d{1,2}$", s):
                    monthly_pickups[month] += int(s)
                # Date-range string like "3/3-3/25" — counts as one pickup event
                elif re.search(r"\d+/\d+", s):
                    monthly_pickups[month] = monthly_pickups.get(month, 0) + 1

    # Build months list, keeping only those with positive amounts
    months = []
    for m in sorted(amount_col_by_month):
        amt = monthly_amounts[m]
        if amt > 0:
            months.append({
                "month":   m,
                "amount":  amt,
                "pickups": monthly_pickups.get(m) or None,
            })

    if not months:
        return None

    return {
        "property_code":  property_code,
        "year":           year,
        "vendor_name":    vendor_name,
        "account_number": account_number,
        "months":         months,
    }
