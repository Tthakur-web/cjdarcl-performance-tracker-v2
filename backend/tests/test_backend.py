"""Backend API tests for Sales Performance Hub."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")

REP_EMAIL = "pawan.giri@cjdarcl.com"
MGR_EMAIL = "rohit1.singh@cjdarcl.com"


@pytest.fixture(scope="module")
def rep_token():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": REP_EMAIL}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["user"]["role"] == "rep"
    return j["session_token"]


@pytest.fixture(scope="module")
def mgr_token():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": MGR_EMAIL}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["user"]["role"] == "manager"
    return j["session_token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


# ---- Auth ----
def test_dev_login_rep_role():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": REP_EMAIL}, timeout=15)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "rep"
    assert "session_token" in r.json()


def test_dev_login_manager_role():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": MGR_EMAIL}, timeout=15)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "manager"


def test_auth_me_valid(rep_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(rep_token), timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == REP_EMAIL


def test_auth_me_missing_token():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401


def test_auth_me_invalid_token():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H("bad_token_xxx"), timeout=15)
    assert r.status_code == 401


# ---- Dashboard ----
def test_dashboard_rep(rep_token):
    r = requests.get(f"{BASE_URL}/api/dashboard", headers=H(rep_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ["today", "monthly", "payments", "pipeline", "trend"]:
        assert k in d
    assert len(d["trend"]) == 7


def test_dashboard_manager_greater(rep_token, mgr_token):
    rep = requests.get(f"{BASE_URL}/api/dashboard", headers=H(rep_token), timeout=15).json()
    mgr = requests.get(f"{BASE_URL}/api/dashboard", headers=H(mgr_token), timeout=15).json()
    # Manager aggregate should be >= rep for monthly target
    assert mgr["monthly"]["target"] >= rep["monthly"]["target"]


# ---- Daily records ----
def test_daily_records_rep(rep_token):
    r = requests.get(f"{BASE_URL}/api/daily-records", headers=H(rep_token), timeout=15)
    assert r.status_code == 200
    recs = r.json()
    assert isinstance(recs, list) and len(recs) > 0
    assert all(rec["salesperson_email"] == REP_EMAIL for rec in recs)


def test_daily_records_manager_more(rep_token, mgr_token):
    rep = requests.get(f"{BASE_URL}/api/daily-records", headers=H(rep_token), timeout=15).json()
    mgr = requests.get(f"{BASE_URL}/api/daily-records", headers=H(mgr_token), timeout=15).json()
    assert len(mgr) > len(rep)


# ---- Pipeline ----
def test_pipeline_manager_all(mgr_token):
    r = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
    deals = r.json()
    # Live sheet currently returns ~9 rows; assert >0 rather than a hard count.
    assert isinstance(deals, list) and len(deals) > 0


def test_pipeline_rep_subset(rep_token, mgr_token):
    all_deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    r = requests.get(f"{BASE_URL}/api/pipeline", headers=H(rep_token), timeout=15)
    assert r.status_code == 200
    deals = r.json()
    assert len(deals) <= len(all_deals)
    assert all(d["salesperson_email"] == REP_EMAIL for d in deals)


def test_pipeline_won_creates_customer(mgr_token):
    # find a non-Won deal for amit
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    target = next((d for d in deals if d["salesperson_email"] == REP_EMAIL and d["stage"] != "Won"), None)
    assert target, "No non-Won deal found for rep"

    # count customers before
    before = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    before_companies = {c["company"] for c in before}

    r = requests.patch(
        f"{BASE_URL}/api/pipeline/{target['id']}",
        headers={**H(mgr_token), "Content-Type": "application/json"},
        json={"stage": "Won"},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["stage"] == "Won"

    after = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    after_companies = {c["company"] for c in after}
    # customer should now exist (either newly added or already existed)
    assert target["company"] in after_companies


# ---- Customers ----
def test_customers_rep_rbac(rep_token):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(rep_token), timeout=15)
    assert r.status_code == 200
    assert all(c["salesperson_email"] == REP_EMAIL for c in r.json())


# ---- Payments ----
def test_payments_all_excludes_paid(mgr_token):
    r = requests.get(f"{BASE_URL}/api/payments?status=all", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
    for p in r.json():
        assert p["status"] in ("outstanding", "overdue")


def test_payments_reminder(rep_token):
    payments = requests.get(f"{BASE_URL}/api/payments?status=all", headers=H(rep_token), timeout=15).json()
    assert payments, "no payments for rep"
    pid = payments[0]["id"]
    r = requests.patch(
        f"{BASE_URL}/api/payments/{pid}/reminder", headers=H(rep_token), timeout=15
    )
    assert r.status_code == 200
    assert r.json()["reminder_sent_at"] is not None


# ---- Logout ----
def test_logout_invalidates():
    tok = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": REP_EMAIL}, timeout=15).json()["session_token"]
    r = requests.post(f"{BASE_URL}/api/auth/logout", headers=H(tok), timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=H(tok), timeout=15)
    assert r2.status_code == 401
