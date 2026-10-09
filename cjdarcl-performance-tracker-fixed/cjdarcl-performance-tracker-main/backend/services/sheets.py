"""Google Sheets CSV parser + normalizer for BDM Performance Tracker.

Three source tabs:
- Demands (Timestamp, Email Address, Customer Name, Weight In MT, Costing, Freight, GM2, Status ...)
- Active Customer (BDM Name, Name, Forecasted Sales <Month>, "<Day> <Month>" or Sales Done <Month>)
- New Acquisition Pipeline (SR NO, BDM NAME, CUSTOMER NAME, LOCATION, POTENTIAL, EXP CLOSER DATE, Business Acquired, Stage)
- Payments (BDM, customer, OS, OD, On A/c, Remarks)

Because BDMs may appear as email in the Demands tab but as first-name / uppercase-name in
the other tabs, we build a name -> email map from the Demands tab.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple

import httpx


def _num(s) -> float:
    if s is None:
        return 0.0
    s = str(s).replace(",", "").strip().rstrip("%")
    if not s or s.upper() in {"NA", "N/A", "-"}:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


async def fetch_csv(url: str, timeout: float = 20.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as http:
        r = await http.get(url)
        r.raise_for_status()
        return r.text


def build_name_email_map(daily_rows: List[Dict[str, Any]]) -> Dict[str, str]:
    m: Dict[str, str] = {}
    for r in daily_rows:
        email = (r.get("salesperson_email") or "").lower()
        if not email or "@" not in email:
            continue
        local = email.split("@")[0]
        parts = local.split(".")
        first = re.sub(r"\d+", "", parts[0]).strip().lower()
        last = re.sub(r"\d+", "", parts[1]).strip().lower() if len(parts) > 1 else ""
        if first and first not in m:
            m[first] = email
        if first and last:
            m[f"{first} {last}"] = email
            m.setdefault(last, email)
    # Manager doesn't appear in Demands.
    m.setdefault("rohit", "rohit1.singh@cjdarcl.com")
    m.setdefault("rohit singh", "rohit1.singh@cjdarcl.com")
    return m


def resolve_bdm(name: str, name_email_map: Dict[str, str]) -> str:
    if not name:
        return ""
    key = re.sub(r"\s+", " ", name.strip().lower())
    if key in name_email_map:
        return name_email_map[key]
    parts = key.split()
    if len(parts) >= 2:
        two = f"{parts[0]} {parts[1]}"
        if two in name_email_map:
            return name_email_map[two]
    if parts:
        first = parts[0]
        if first in name_email_map:
            return name_email_map[first]
    return ""


# ---------- Column-name helpers ----------

_MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


def find_col(row: Dict[str, str], *patterns: str) -> Optional[str]:
    """Case-insensitive lookup — first matching column key wins."""
    for key in row.keys():
        if not key:
            continue
        k = key.strip().lower()
        for p in patterns:
            if p.lower() in k:
                return key
    return None


def new_acquisition_pattern(month_label: str) -> re.Pattern:
    return re.compile(
        rf"^\s*new\s+acquisition\s+{re.escape(month_label.strip().lower())}\s*$",
        re.IGNORECASE,
    )


# ---------- Parsers ----------


def parse_daily(csv_text: str) -> List[Dict[str, Any]]:
    """Parse Demands tab. GM2 is now included."""
    rows: List[Dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for r in reader:
        ts = (r.get("Timestamp") or "").strip()
        d = _parse_date(ts)
        if not d:
            continue
        # Header has trailing space on "Customer Name " sometimes.
        cust_col = find_col(r, "customer name") or "Customer Name"
        rows.append(
            {
                "date": d,
                "timestamp": ts,
                "salesperson_email": (r.get("Email Address") or "").strip().lower(),
                "customer": (r.get(cust_col) or "").strip(),
                "from_location": (r.get("From Location") or "").strip(),
                "to_location": (r.get("To Location") or "").strip(),
                "vehicle_type": (r.get("Vehicle Type") or "").strip(),
                "weight": _num(r.get("Weight In MT")),
                "loading_date": (r.get("Loading Date") or "").strip(),
                "costing": _num(r.get("Costing")),
                "freight": _num(r.get("Freight")),
                "gm2": _num(r.get("GM2")),
                "gm2_pct": _num(r.get("GM2%")),
                "status": (r.get("Status") or "").strip(),
                "placed_by": (r.get("Placed By") or "").strip(),
            }
        )
    return rows


def classify_demand(
    row: Dict[str, Any],
    active_customer_names: set,
    month_label: str,
) -> str:
    """Return 'existing' | 'new_acquisition' | 'needs_review'."""
    name = (row.get("customer") or "").strip()
    if not name:
        return "needs_review"
    if new_acquisition_pattern(month_label).match(name):
        return "new_acquisition"
    if name.lower() in active_customer_names:
        return "existing"
    return "needs_review"


def parse_active_customers(
    csv_text: str, name_email_map: Dict[str, str], month_label: str = ""
) -> List[Dict[str, Any]]:
    """Parse Active Customer tab.

    Rows where Customer Name matches 'New Acquisition <Month>' are still
    returned but tagged with `is_new_acquisition_row=True` so the caller can
    surface them as New Acquisition Demand Activity (per-BDM Sales Done)
    instead of as regular active-customer rows.
    """
    rows: List[Dict[str, Any]] = []
    na_pattern = new_acquisition_pattern(month_label) if month_label else None
    reader = csv.DictReader(io.StringIO(csv_text))
    for r in reader:
        bdm = (r.get("BDM Name") or r.get("BDM NAME") or "").strip()
        cust_col = find_col(r, "customer name") or "Name"
        cust = (r.get(cust_col) or "").strip()
        if not bdm or not cust:
            continue

        forecast = 0.0
        sales_done = 0.0
        for key, val in r.items():
            if not key:
                continue
            kl = key.strip().lower()
            if "forecasted sales" in kl:
                forecast = _num(val)
            elif ("sales done" in kl) or ("achv" in kl):
                sales_done = _num(val)
            else:
                first_tok = kl.split()[0] if kl.split() else ""
                if first_tok.isdigit() and any(m in kl for m in _MONTH_NAMES):
                    sales_done = max(sales_done, _num(val))

        is_new_acq = bool(na_pattern and na_pattern.match(cust))
        rows.append(
            {
                "salesperson_email": resolve_bdm(bdm, name_email_map),
                "bdm_name": bdm,
                "customer": cust,
                "forecast": forecast,
                "sales_done": sales_done,
                "is_new_acquisition_row": is_new_acq,
            }
        )
    return rows


def parse_pipeline(
    csv_text: str, name_email_map: Dict[str, str]
) -> List[Dict[str, Any]]:
    """Parse New Acquisition Pipeline tab.

    Stage column values (from actual sheet): Contacted, Meeting Pending,
    Demo Done, Dropped, Acquired. Rows with Stage='Dropped' are skipped.

    Per spec: only count actual Business Acquired > 0 as customer revenue;
    do NOT fall back to POTENTIAL even if Stage='Acquired'.
    """
    stage_map = {
        "": "Lead",
        "lead": "Lead",
        "meeting pending": "Lead",
        "contacted": "Contacted",
        "demo done": "Demo",
        "demo": "Demo",
        "negotiation": "Negotiation",
        "acquired": "Won",
        "won": "Won",
    }
    rows: List[Dict[str, Any]] = []
    for r in csv.DictReader(io.StringIO(csv_text)):
        bdm = (r.get("BDM NAME") or r.get("BDM Name") or "").strip()
        cust_col = find_col(r, "customer name")
        co = (r.get(cust_col) if cust_col else "").strip() if cust_col else ""
        if not bdm or not co:
            continue
        raw_stage = (r.get("Stage") or "").strip().lower()
        if raw_stage == "dropped":
            continue
        stage = stage_map.get(raw_stage, "Lead")
        potential = _num(r.get("POTENTIAL"))
        business_acquired = _num(r.get("Business Acquired"))
        # Spec: only Business Acquired > 0 is a real customer conversion.
        # Do NOT force stage=Won when Business Acquired is empty.
        if business_acquired > 0 and stage != "Won":
            stage = "Won"
        needs_review = raw_stage == "acquired" and business_acquired <= 0
        rows.append(
            {
                "salesperson_email": resolve_bdm(bdm, name_email_map),
                "bdm_name": bdm,
                "company": co,
                "location": (r.get("LOCATION") or "").strip(),
                "potential": potential,
                "business_acquired": business_acquired,
                "value": business_acquired if business_acquired > 0 else potential,
                "achv": business_acquired,
                "exp_closer_date": _parse_date(r.get("EXP CLOSER DATE") or ""),
                "sheet_stage": (r.get("Stage") or "").strip(),
                "stage": stage,
                "needs_review": needs_review,
            }
        )
    return rows


def parse_payments(
    csv_text: str, name_email_map: Dict[str, str]
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for r in csv.DictReader(io.StringIO(csv_text)):
        bdm = (r.get("BDM") or "").strip()
        customer = (r.get("Days") or "").strip()
        if not bdm or not customer:
            continue
        os_ = _num(r.get("OS"))
        od = _num(r.get("OD"))
        if os_ <= 0 and od <= 0:
            continue
        rows.append(
            {
                "salesperson_email": resolve_bdm(bdm, name_email_map),
                "bdm_name": bdm,
                "customer": customer,
                "outstanding": os_,
                "overdue": od,
                "on_account": _num(r.get("On A/c")),
                "remarks": (r.get("Remarks") or "").strip(),
                "status": "overdue" if od > 0 else "outstanding",
                "amount": od if od > 0 else os_,
            }
        )
    return rows
