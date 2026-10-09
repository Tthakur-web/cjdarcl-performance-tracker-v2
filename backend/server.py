from fastapi import FastAPI, APIRouter, Request, HTTPException, Depends, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional, Literal, Dict
import uuid
from datetime import datetime, timezone, timedelta, date
import httpx
import asyncio
import re

from services import sheets as sheets_svc

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

MANAGER_EMAILS = {"rohit1.singh@cjdarcl.com","tripti.thakur@cjdarcl.com"}
EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def current_month_label() -> str:
    """Return canonical month name, honoring MONTH_LABEL env override."""
    override = os.environ.get("MONTH_LABEL")
    if override:
        return override.strip()
    return date.today().strftime("%B")


# =========================================================
# Models
# =========================================================
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: Literal["manager", "rep"] = "rep"


# =========================================================
# Auth helpers
# =========================================================
class GoogleSessionRequest(BaseModel):
    session_id: str


def _to_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def get_current_user(request: Request) -> User:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = _to_aware(session.get("expires_at"))
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


def visible_emails_for(user: User) -> Optional[List[str]]:
    if user.role == "manager":
        return None
    return [user.email]


def _apply_scope(user: User) -> dict:
    emails = visible_emails_for(user)
    return {} if emails is None else {"salesperson_email": {"$in": emails}}


# =========================================================
# Auth Endpoints
# =========================================================
@api_router.post("/auth/google-session")
async def google_session(payload: GoogleSessionRequest):
    if not payload.session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(
            EMERGENT_SESSION_DATA_URL,
            headers={"X-Session-ID": payload.session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")

    data = resp.json()
    email = (data.get("email") or "").lower()
    name = data.get("name") or (email.split("@")[0] if email else "User")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not (email and session_token):
        raise HTTPException(status_code=502, detail="Malformed session data")

    role = "manager" if email in {m.lower() for m in MANAGER_EMAILS} else "rep"
    now = datetime.now(timezone.utc)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "role": role}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "role": role,
                "created_at": now,
            }
        )

    await db.user_sessions.update_one(
        {"session_token": session_token},
        {
            "$set": {
                "session_token": session_token,
                "user_id": user_id,
                "created_at": now,
                "expires_at": now + timedelta(days=7),
            }
        },
        upsert=True,
    )
    return {
        "session_token": session_token,
        "user": {
            "user_id": user_id, "email": email, "name": name,
            "picture": picture, "role": role,
        },
    }


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return user.dict()


@api_router.post("/auth/logout")
async def logout(request: Request, user: User = Depends(get_current_user)):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:].strip()
    await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


class DevLoginRequest(BaseModel):
    email: str
    name: Optional[str] = None


@api_router.post("/auth/dev-login")
async def dev_login(payload: DevLoginRequest):
    email = payload.email.lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    name = payload.name or " ".join(
        p.capitalize()
        for p in email.split("@")[0].replace(".", " ").split()
        if p and not p.isdigit()
    )
    role = "manager" if email in {m.lower() for m in MANAGER_EMAILS} else "rep"
    now = datetime.now(timezone.utc)
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id}, {"$set": {"name": name, "role": role}}
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id, "email": email, "name": name,
                "picture": None, "role": role, "created_at": now,
            }
        )
    session_token = f"dev_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one(
        {
            "session_token": session_token, "user_id": user_id,
            "created_at": now, "expires_at": now + timedelta(days=7),
        }
    )
    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": None, "role": role},
    }


# =========================================================
# Sheet URLs & Sync
# =========================================================
SHEET_URLS = {
    "daily": os.environ.get("SHEET_URL_DAILY", ""),
    "pipeline": os.environ.get("SHEET_URL_PIPELINE", ""),
    "active_customer": os.environ.get("SHEET_URL_ACTIVE_CUSTOMER", ""),
    "payments": os.environ.get("SHEET_URL_PAYMENTS", ""),
}


async def sync_from_sheets() -> dict:
    if not all(SHEET_URLS.values()):
        raise RuntimeError("SHEET_URL_* env vars are not fully configured")
    logger.info("Sheet sync starting...")

    csvs = {}
    for k, url in SHEET_URLS.items():
        csvs[k] = await sheets_svc.fetch_csv(url)

    daily_raw = sheets_svc.parse_daily(csvs["daily"])
    name_map = sheets_svc.build_name_email_map(daily_raw)

    pipeline_rows = sheets_svc.parse_pipeline(csvs["pipeline"], name_map)
    month_label = current_month_label()
    active_customers = sheets_svc.parse_active_customers(
        csvs["active_customer"], name_map, month_label
    )
    payments_rows = sheets_svc.parse_payments(csvs["payments"], name_map)

    # Split active_customers: real customers vs. "New Acquisition <Month>" activity rows.
    new_acq_activity = [r for r in active_customers if r.get("is_new_acquisition_row")]
    real_active_customers = [r for r in active_customers if not r.get("is_new_acquisition_row")]

    # Classification set (case-insensitive) — real active customer names.
    active_cust_names = {r["customer"].strip().lower() for r in real_active_customers if r.get("customer")}

    # Classify each demand row.
    classified = []
    for r in daily_raw:
        cat = sheets_svc.classify_demand(r, active_cust_names, month_label)
        classified.append({**r, "category": cat})

    # Customers: every pipeline row whose stage is Won (Acquired), regardless of
    # Business Acquired amount — per user spec "keep them in won".
    customers_rows = [r for r in pipeline_rows if r["stage"] == "Won"]
    open_pipeline_rows = [r for r in pipeline_rows if r["stage"] != "Won"]
    pipeline_needs_review = [r for r in pipeline_rows if r.get("needs_review")]

    now = datetime.now(timezone.utc)

    # Preserve reminder_sent_at
    reminder_flags = {}
    async for p in db.payments.find({"reminder_sent_at": {"$ne": None}}, {"_id": 0}):
        reminder_flags[(p.get("salesperson_email"), p.get("customer"))] = p.get("reminder_sent_at")

    # Wipe
    for col in [
        "daily_records", "pipeline_deals", "customers",
        "payments", "monthly_targets", "active_customers",
        "new_acq_activity",
    ]:
        await db[col].delete_many({})

    # Insert daily_records (row-level, one per demand)
    if classified:
        await db.daily_records.insert_many(
            [
                {
                    "id": f"dr_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "date": r["date"],
                    "customer": r["customer"],
                    "category": r["category"],
                    "weight": r["weight"],
                    "costing": r["costing"],
                    "freight": r["freight"],
                    "gm2": r["gm2"],
                    "gm2_pct": r.get("gm2_pct", 0),
                    "status": r["status"],
                    "from_location": r["from_location"],
                    "to_location": r["to_location"],
                    "vehicle_type": r["vehicle_type"],
                    "placed_by": r["placed_by"],
                }
                for r in classified
                if r["salesperson_email"]
            ]
        )

    # Active customers (only real ones, excluding "New Acquisition <Month>" activity rows)
    if real_active_customers:
        await db.active_customers.insert_many(
            [
                {
                    "id": f"ac_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "bdm_name": r["bdm_name"],
                    "customer": r["customer"],
                    "forecast": r["forecast"],
                    "sales_done": r["sales_done"],
                }
                for r in real_active_customers
                if r["salesperson_email"]
            ]
        )

    # New-acquisition activity rows (per-BDM Sales Done for "New Acquisition <Month>")
    if new_acq_activity:
        await db.new_acq_activity.insert_many(
            [
                {
                    "id": f"na_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "bdm_name": r["bdm_name"],
                    "customer": r["customer"],
                    "forecast": r["forecast"],
                    "sales_done": r["sales_done"],
                    "month_label": month_label,
                }
                for r in new_acq_activity
                if r["salesperson_email"]
            ]
        )

    # Pipeline (open only)
    if open_pipeline_rows:
        await db.pipeline_deals.insert_many(
            [
                {
                    "id": f"deal_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "company": r["company"],
                    "contact": r["bdm_name"],
                    "value": float(r["value"]),
                    "achv": float(r["achv"]),
                    "stage": r["stage"],
                    "sheet_stage": r.get("sheet_stage") or r["stage"],
                    "location": r.get("location"),
                    "exp_closer_date": r.get("exp_closer_date"),
                    "next_step": None,
                    "updated_at": now,
                }
                for r in open_pipeline_rows
                if r["salesperson_email"]
            ]
        )

    # Customers (all Won-stage pipeline rows — per spec "keep them in won"
    # even if Business Acquired is empty; revenue = business_acquired || 0)
    if customers_rows:
        await db.customers.insert_many(
            [
                {
                    "id": f"cust_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "company": r["company"],
                    "industry": r["location"] or None,
                    "revenue": float(r["business_acquired"]),
                    "potential": float(r["potential"]),
                    "business_acquired": float(r["business_acquired"]),
                    "needs_review": r.get("needs_review", False),
                    "acquired_at": (
                        datetime.fromisoformat(r["exp_closer_date"]).replace(tzinfo=timezone.utc)
                        if r["exp_closer_date"] else now
                    ),
                }
                for r in customers_rows
                if r["salesperson_email"]
            ]
        )

    # Payments
    if payments_rows:
        docs = []
        for r in payments_rows:
            key = (r["salesperson_email"], r["customer"])
            docs.append(
                {
                    "id": f"pay_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": r["salesperson_email"],
                    "customer": r["customer"],
                    "invoice_no": r["bdm_name"],
                    "amount": float(r["amount"]),
                    "outstanding": float(r["outstanding"]),
                    "overdue": float(r["overdue"]),
                    "on_account": float(r["on_account"]),
                    "remarks": r["remarks"],
                    "due_date": date.today().isoformat(),
                    "status": r["status"],
                    "reminder_sent_at": reminder_flags.get(key),
                }
            )
        await db.payments.insert_many(docs)

    # Monthly targets — derived from real active customers forecast (excluding
    # "New Acquisition <Month>" activity rows)
    per_rep_target: dict = {}
    for r in real_active_customers:
        if not r["salesperson_email"]:
            continue
        per_rep_target[r["salesperson_email"]] = per_rep_target.get(r["salesperson_email"], 0.0) + r["forecast"]
    if per_rep_target:
        await db.monthly_targets.insert_many(
            [{"salesperson_email": e, "target": v} for e, v in per_rep_target.items()]
        )

    # Ensure user records for discovered emails
    discovered_emails = set()
    for r in classified + real_active_customers + new_acq_activity + open_pipeline_rows + customers_rows + payments_rows:
        e = r.get("salesperson_email")
        if e:
            discovered_emails.add(e)
    for e in discovered_emails:
        if not e:
            continue
        exists = await db.users.find_one({"email": e}, {"_id": 0})
        if not exists:
            local = e.split("@")[0]
            display = " ".join(
                p.capitalize()
                for p in local.replace(".", " ").split()
                if p and not p.isdigit()
            ) or local
            role = "manager" if e.lower() in {m.lower() for m in MANAGER_EMAILS} else "rep"
            await db.users.insert_one(
                {
                    "user_id": f"user_{uuid.uuid4().hex[:12]}",
                    "email": e, "name": display, "picture": None,
                    "role": role, "created_at": now,
                }
            )

    stats = {
        "daily_records": len(classified),
        "pipeline_deals": len(open_pipeline_rows),
        "customers": len(customers_rows),
        "active_customers": len(real_active_customers),
        "new_acq_activity": len(new_acq_activity),
        "payments": len(payments_rows),
        "targets": len(per_rep_target),
        "pipeline_needs_review": len(pipeline_needs_review),
        "month_label": month_label,
        "synced_at": now.isoformat(),
    }
    await db.sync_log.insert_one({**stats, "created_at": now})
    logger.info(f"Sheet sync complete: {stats}")
    return stats


@api_router.post("/sync")
async def sync_endpoint(user: User = Depends(get_current_user)):
    try:
        stats = await sync_from_sheets()
        return {"ok": True, **stats}
    except Exception as e:
        logger.exception("sync failed")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/sync/status")
async def sync_status(user: User = Depends(get_current_user)):
    last = await db.sync_log.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
    return last or {"synced_at": None}


# =========================================================
# Date-range helpers
# =========================================================
def _period_range(period: str, ref_date: str) -> tuple:
    """Return (start_iso, end_iso, month_start_iso).

    period='day' → (ref_date, ref_date)
    period='month' → (month_start, ref_date)  # MTD ending at ref_date
    """
    try:
        d = datetime.strptime(ref_date, "%Y-%m-%d").date()
    except Exception:
        d = date.today()
    if period == "day":
        return (d.isoformat(), d.isoformat(), d.replace(day=1).isoformat())
    return (d.replace(day=1).isoformat(), d.isoformat(), d.replace(day=1).isoformat())


# =========================================================
# Dashboard
# =========================================================
@api_router.get("/dashboard")
async def dashboard(
    period: str = Query("month", pattern="^(day|month)$"),
    ref_date: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    q = _apply_scope(user)
    ref = ref_date or date.today().isoformat()
    start, end, month_start = _period_range(period, ref)

    # Selected period demand rows
    demand_q = {**q, "date": {"$gte": start, "$lte": end}}
    demand_rows = await db.daily_records.find(demand_q, {"_id": 0}).to_list(5000)

    # Placed = Status == "Placed" (case-insensitive)
    placed_rows = [r for r in demand_rows if (r.get("status") or "").lower() == "placed"]

    # Financials are computed ONLY from placed rows (per spec)
    total_freight = sum(r.get("freight", 0) for r in placed_rows)
    total_costing = sum(r.get("costing", 0) for r in placed_rows)
    total_gm2 = sum(r.get("gm2", 0) for r in placed_rows)
    total_placement = total_freight  # Placement value = Freight of placed rows
    total_weight = sum(r.get("weight", 0) for r in demand_rows)  # All raised

    count_raised = len(demand_rows)
    count_placed = len(placed_rows)
    count_existing = sum(1 for r in demand_rows if r.get("category") == "existing")
    count_new_acq = sum(1 for r in demand_rows if r.get("category") == "new_acquisition")
    count_needs_review = sum(1 for r in demand_rows if r.get("category") == "needs_review")

    # Per-BDM breakdown (manager only)
    by_bdm: List[dict] = []
    if user.role == "manager":
        bdm_agg: Dict[str, dict] = {}
        for r in demand_rows:
            e = r.get("salesperson_email")
            if not e:
                continue
            b = bdm_agg.setdefault(
                e,
                {"email": e, "raised": 0, "placed": 0, "weight": 0.0,
                 "freight": 0.0, "costing": 0.0, "gm2": 0.0},
            )
            b["raised"] += 1
            b["weight"] += r.get("weight", 0)
            if (r.get("status") or "").lower() == "placed":
                b["placed"] += 1
                b["freight"] += r.get("freight", 0)
                b["costing"] += r.get("costing", 0)
                b["gm2"] += r.get("gm2", 0)
        if bdm_agg:
            emails = list(bdm_agg.keys())
            all_users = await db.users.find(
                {"email": {"$in": emails}}, {"_id": 0}
            ).to_list(50)
            name_lookup = {u["email"]: u["name"] for u in all_users}
            for e, b in bdm_agg.items():
                by_bdm.append({**b, "name": name_lookup.get(e, e.split("@")[0])})
            # Ensure all reps appear even with 0 activity
            all_reps = await db.users.find(
                {"role": "rep"}, {"_id": 0}
            ).to_list(50)
            existing_emails = {b["email"] for b in by_bdm}
            for u in all_reps:
                if u["email"] not in existing_emails:
                    by_bdm.append({
                        "email": u["email"], "name": u["name"],
                        "raised": 0, "placed": 0, "weight": 0.0,
                        "freight": 0.0, "costing": 0.0, "gm2": 0.0,
                    })
            by_bdm.sort(key=lambda x: (x["placed"], x["freight"]), reverse=True)

    # Monthly target
    team_target = float(os.environ.get("MONTHLY_TARGET_TOTAL", 20000000))
    if user.role == "manager":
        monthly_target = team_target
    else:
        manager_lower = {m.lower() for m in MANAGER_EMAILS}
        all_targets = await db.monthly_targets.find({}, {"_id": 0}).to_list(1000)
        rep_targets = [
            t for t in all_targets
            if (t.get("salesperson_email") or "").lower() not in manager_lower
        ]
        total_forecast = sum(t.get("target", 0) for t in rep_targets)
        emails = visible_emails_for(user) or []
        my_forecast = sum(
            t.get("target", 0) for t in rep_targets
            if t.get("salesperson_email") in emails
        )
        if total_forecast > 0:
            monthly_target = team_target * (my_forecast / total_forecast)
        else:
            rep_count = await db.users.count_documents({"role": "rep"})
            monthly_target = team_target / max(rep_count, 1)

    # MTD placement (independent of selected period)
    mtd_rows = await db.daily_records.find(
        {**q, "date": {"$gte": month_start, "$lte": date.today().isoformat()}},
        {"_id": 0},
    ).to_list(5000)
    mtd_placement = sum(
        r.get("freight", 0) for r in mtd_rows
        if (r.get("status") or "").lower() == "placed"
    )

    pay_rows = await db.payments.find(
        {**q, "status": {"$in": ["outstanding", "overdue"]}}, {"_id": 0}
    ).to_list(2000)
    outstanding_total = sum(p.get("outstanding", 0) for p in pay_rows)
    overdue_total = sum(p.get("overdue", 0) for p in pay_rows)

    pipe = await db.pipeline_deals.find({**q, "stage": {"$ne": "Won"}}, {"_id": 0}).to_list(2000)

    # 7-day trend — count of demands raised/placed per day
    ref_d = date.fromisoformat(ref) if ref else date.today()
    trend = []
    for i in range(6, -1, -1):
        ds = (ref_d - timedelta(days=i)).isoformat()
        day_all = await db.daily_records.find({**q, "date": ds}, {"_id": 0}).to_list(500)
        day_placed = [r for r in day_all if (r.get("status") or "").lower() == "placed"]
        trend.append(
            {
                "date": ds,
                "raised": len(day_all),
                "placed": len(day_placed),
                # Kept for backward-compat
                "demand": sum(r.get("costing", 0) for r in day_placed),
                "placement": sum(r.get("freight", 0) for r in day_placed),
            }
        )

    return {
        "period": period,
        "ref_date": ref,
        "start": start,
        "end": end,
        "month_label": current_month_label(),
        "totals": {
            "weight_mt": total_weight,
            "costing": total_costing,
            "freight": total_freight,
            "gm2": total_gm2,
        },
        "counts": {
            "raised": count_raised,
            "placed": count_placed,
            "existing": count_existing,
            "new_acquisition": count_new_acq,
            "needs_review": count_needs_review,
        },
        "by_bdm": by_bdm,
        "today": {"demand": total_costing, "placement": total_placement},
        "monthly": {"target": monthly_target, "placement": mtd_placement},
        "payments": {"outstanding": outstanding_total, "overdue": overdue_total},
        "pipeline": {
            "count": len(pipe),
            "value": sum(d.get("value", 0) for d in pipe),
        },
        "trend": trend,
    }


# =========================================================
# Demands
# =========================================================
@api_router.get("/demands")
async def get_demands(
    period: str = Query("month", pattern="^(day|month)$"),
    ref_date: Optional[str] = None,
    category: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    q = _apply_scope(user)
    ref = ref_date or date.today().isoformat()
    start, end, _ = _period_range(period, ref)
    q["date"] = {"$gte": start, "$lte": end}
    if category and category != "all":
        q["category"] = category
    rows = await db.daily_records.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return rows


# =========================================================
# Existing Customers view
# =========================================================
@api_router.get("/customers")
async def get_customers(
    period: str = Query("month", pattern="^(day|month)$"),
    ref_date: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Return the BDM's active customers (from Active Customer sheet) enriched
    with demand-activity aggregates for the selected period."""
    q = _apply_scope(user)
    ref = ref_date or date.today().isoformat()
    start, end, _ = _period_range(period, ref)

    active = await db.active_customers.find(q, {"_id": 0}).to_list(2000)

    # Aggregate demand activity per customer for period
    demand_q = {**q, "date": {"$gte": start, "$lte": end}, "category": "existing"}
    demand_rows = await db.daily_records.find(demand_q, {"_id": 0}).to_list(5000)
    per_cust: dict = {}
    for r in demand_rows:
        k = r["customer"].lower()
        b = per_cust.setdefault(
            k,
            {
                "weight": 0.0, "costing": 0.0, "freight": 0.0,
                "gm2": 0.0, "count": 0, "statuses": {}, "last_date": "",
            },
        )
        b["weight"] += r.get("weight", 0)
        b["costing"] += r.get("costing", 0)
        b["freight"] += r.get("freight", 0)
        b["gm2"] += r.get("gm2", 0)
        b["count"] += 1
        s = (r.get("status") or "").strip() or "Unknown"
        b["statuses"][s] = b["statuses"].get(s, 0) + 1
        if r["date"] > b["last_date"]:
            b["last_date"] = r["date"]

    out = []
    for c in active:
        agg = per_cust.get(c["customer"].lower(), {})
        out.append(
            {
                **c,
                "weight": agg.get("weight", 0),
                "costing": agg.get("costing", 0),
                "freight": agg.get("freight", 0),
                "gm2": agg.get("gm2", 0),
                "demand_count": agg.get("count", 0),
                "statuses": agg.get("statuses", {}),
                "last_demand_date": agg.get("last_date", ""),
            }
        )
    # Sort: most recent demand activity first, then by forecast desc
    out.sort(
        key=lambda x: (x.get("last_demand_date") or "", x.get("forecast", 0)),
        reverse=True,
    )
    return out


# =========================================================
# Needs Review
# =========================================================
@api_router.get("/needs-review")
async def get_needs_review(
    period: str = Query("month", pattern="^(day|month)$"),
    ref_date: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    q = _apply_scope(user)
    ref = ref_date or date.today().isoformat()
    start, end, _ = _period_range(period, ref)
    q["date"] = {"$gte": start, "$lte": end}
    q["category"] = "needs_review"
    rows = await db.daily_records.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return rows


# =========================================================
# Pipeline
# =========================================================
@api_router.get("/pipeline")
async def get_pipeline(
    period: str = Query("month", pattern="^(day|month)$"),
    ref_date: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Return active pipeline + New Acquisition Demand Activity.

    Per spec: New Acquisition Demand Activity is sourced from the Active Customer
    sheet — rows where Customer Name == "New Acquisition <Month>" — and reports
    each BDM's Sales Done on that placeholder. Manager sees the sum across all
    BDMs and a per-BDM breakdown.
    """
    q = _apply_scope(user)
    deals = await db.pipeline_deals.find(q, {"_id": 0}).sort("updated_at", -1).to_list(2000)

    na_rows = await db.new_acq_activity.find(q, {"_id": 0}).to_list(500)
    total_forecast = sum(r.get("forecast", 0) for r in na_rows)
    total_sales_done = sum(r.get("sales_done", 0) for r in na_rows)

    per_bdm = []
    if user.role == "manager":
        for r in sorted(na_rows, key=lambda x: x.get("sales_done", 0), reverse=True):
            per_bdm.append({
                "email": r["salesperson_email"],
                "bdm_name": r["bdm_name"],
                "forecast": r["forecast"],
                "sales_done": r["sales_done"],
            })

    actual_activity = {
        "count": len(na_rows),
        "forecast": total_forecast,
        "sales_done": total_sales_done,
        "attainment_pct": (total_sales_done / total_forecast * 100) if total_forecast > 0 else 0,
        "month_label": na_rows[0].get("month_label") if na_rows else current_month_label(),
        "per_bdm": per_bdm,
    }
    return {"deals": deals, "actual_activity": actual_activity}


class PipelineStageUpdate(BaseModel):
    stage: Literal["Lead", "Contacted", "Demo", "Negotiation", "Won"]


@api_router.patch("/pipeline/{deal_id}")
async def update_pipeline_stage(
    deal_id: str, payload: PipelineStageUpdate, user: User = Depends(get_current_user)
):
    deal = await db.pipeline_deals.find_one({"id": deal_id}, {"_id": 0})
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    if user.role != "manager" and deal["salesperson_email"] != user.email:
        raise HTTPException(status_code=403, detail="Not allowed")
    now = datetime.now(timezone.utc)
    await db.pipeline_deals.update_one(
        {"id": deal_id}, {"$set": {"stage": payload.stage, "updated_at": now}}
    )
    if payload.stage == "Won":
        exists = await db.customers.find_one(
            {"company": deal["company"], "salesperson_email": deal["salesperson_email"]}
        )
        if not exists:
            await db.customers.insert_one(
                {
                    "id": f"cust_{uuid.uuid4().hex[:10]}",
                    "salesperson_email": deal["salesperson_email"],
                    "company": deal["company"], "industry": deal.get("location"),
                    "revenue": deal.get("value", 0), "potential": deal.get("value", 0),
                    "business_acquired": deal.get("value", 0), "acquired_at": now,
                }
            )
    return await db.pipeline_deals.find_one({"id": deal_id}, {"_id": 0})


# =========================================================
# Payments
# =========================================================
@api_router.get("/payments")
async def get_payments(
    status: Optional[str] = None, user: User = Depends(get_current_user)
):
    q = _apply_scope(user)
    if status and status != "all":
        q["status"] = status
    else:
        q["status"] = {"$in": ["outstanding", "overdue"]}
    return await db.payments.find(q, {"_id": 0}).sort("due_date", 1).to_list(2000)


@api_router.patch("/payments/{payment_id}/reminder")
async def mark_reminder(payment_id: str, user: User = Depends(get_current_user)):
    payment = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if user.role != "manager" and payment["salesperson_email"] != user.email:
        raise HTTPException(status_code=403, detail="Not allowed")
    now = datetime.now(timezone.utc)
    await db.payments.update_one(
        {"id": payment_id}, {"$set": {"reminder_sent_at": now}}
    )
    return await db.payments.find_one({"id": payment_id}, {"_id": 0})


# =========================================================
# Health
# =========================================================
@api_router.get("/")
async def root():
    return {"message": "BDM Performance Tracker API", "status": "ok"}


# @app.on_event("startup")
# async def on_startup():
#     await db.users.create_index("email", unique=True)
#     await db.users.create_index("user_id", unique=True)
#     await db.user_sessions.create_index("session_token", unique=True)
#     await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
#     await db.daily_records.create_index([("salesperson_email", 1), ("date", -1)])
#     await db.daily_records.create_index("category")
#     await db.pipeline_deals.create_index("salesperson_email")
#     await db.customers.create_index("salesperson_email")
#     await db.active_customers.create_index("salesperson_email")
#     await db.payments.create_index([("salesperson_email", 1), ("status", 1)])

#     if all(SHEET_URLS.values()):
#         async def _bg_sync():
#             try:
#                 existing = await db.daily_records.count_documents({})
#                 if existing == 0:
#                     await sync_from_sheets()
#             except Exception as e:
#                 logger.warning(f"Background startup sheet sync failed: {e}")
#         asyncio.create_task(_bg_sync())

#         async def _periodic_sync():
#             """Auto-refresh from Google Sheets every SYNC_INTERVAL_SEC (default 180s)."""
#             interval = int(os.environ.get("SYNC_INTERVAL_SEC", 180))
#             while True:
#                 try:
#                     await asyncio.sleep(interval)
#                     await sync_from_sheets()
#                 except Exception as e:
#                     logger.warning(f"Periodic sheet sync failed: {e}")
#         asyncio.create_task(_periodic_sync())

@app.on_event("startup")
async def on_startup():
    try:
        await db.command("ping")

        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.daily_records.create_index([("salesperson_email", 1), ("date", -1)])
        await db.daily_records.create_index("category")
        await db.pipeline_deals.create_index("salesperson_email")
        await db.customers.create_index("salesperson_email")
        await db.active_customers.create_index("salesperson_email")
        await db.payments.create_index([("salesperson_email", 1), ("status", 1)])

    except Exception as e:
        logger.warning(f"MongoDB startup/index setup failed: {e}")
        return

    if all(SHEET_URLS.values()):
        async def _bg_sync():
            try:
                existing = await db.daily_records.count_documents({})
                if existing == 0:
                    await sync_from_sheets()
            except Exception as e:
                logger.warning(f"Background startup sheet sync failed: {e}")

        asyncio.create_task(_bg_sync())

        async def _periodic_sync():
            """Auto-refresh from Google Sheets every SYNC_INTERVAL_SEC (default 180s)."""
            interval = int(os.environ.get("SYNC_INTERVAL_SEC", 180))
            while True:
                try:
                    await asyncio.sleep(interval)
                    await sync_from_sheets()
                except Exception as e:
                    logger.warning(f"Periodic sheet sync failed: {e}")

        asyncio.create_task(_periodic_sync())

        
@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
