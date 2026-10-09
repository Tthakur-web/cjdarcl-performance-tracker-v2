"""Regression tests for the Pipeline/Customer swap fix.

Bug: Pipeline tab was showing acquired customers and Customers tab was showing
pipeline entries. Fix rewired SHEET_URL_PIPELINE to gid=891446056 (real pipeline
with a Stage column) and SHEET_URL_ACHIEVEMENT to gid=2046569261 (monthly
achievement dashboard). parse_pipeline now maps Stage->app taxonomy
(Lead/Contacted/Demo/Negotiation/Won) and skips 'Dropped' rows; customers are
derived from stage='Won' pipeline rows.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")

MGR_EMAIL = "rohit1.singh@cjdarcl.com"
REP_EMAIL = "pawan.giri@cjdarcl.com"

VALID_STAGES = {"Lead", "Contacted", "Demo", "Negotiation", "Won"}

# Companies known to belong to the *pipeline* (unacquired prospects)
EXPECTED_PIPELINE_COMPANIES = {
    "SANMISH ENERGIES",
    "Sigma Sealing",
    "MBM INDIA",
    "Rittal",
}

# Companies known to be *acquired customers* (won deals)
EXPECTED_CUSTOMER_COMPANIES = {
    "Rishab Global",
    "GRANDLY WIRES",
    "Etibahn",
    "A2K INFRA",
}


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": email}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def mgr_token():
    return _login(MGR_EMAIL)


@pytest.fixture(scope="module")
def rep_token():
    return _login(REP_EMAIL)


@pytest.fixture(scope="module")
def _sync(mgr_token):
    # Force fresh sync so tests use current sheet mapping.
    r = requests.post(f"{BASE_URL}/api/sync", headers=H(mgr_token), timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


# =========================================================
# Pipeline tests
# =========================================================
def test_pipeline_contains_real_prospects(mgr_token, _sync):
    r = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
    deals = r.json()
    assert len(deals) > 0
    companies = " | ".join(d["company"] for d in deals)
    for needle in EXPECTED_PIPELINE_COMPANIES:
        assert needle.lower() in companies.lower(), (
            f"Expected pipeline prospect '{needle}' not found in /api/pipeline"
        )


def test_pipeline_does_not_leak_acquired_customers(mgr_token, _sync):
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    companies = " | ".join(d["company"] for d in deals).lower()
    for bad in EXPECTED_CUSTOMER_COMPANIES:
        assert bad.lower() not in companies, (
            f"Acquired customer '{bad}' leaked into /api/pipeline"
        )


def test_pipeline_stages_taxonomy_only(mgr_token, _sync):
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    stages = {d["stage"] for d in deals}
    assert stages.issubset(VALID_STAGES), f"Unknown stages: {stages - VALID_STAGES}"
    # By definition /api/pipeline excludes Won (Won-> customers). Also 'Dropped'
    # rows must have been filtered out in the parser.
    assert "Dropped" not in stages
    # We expect at least Lead + Demo present given the current sheet content.
    assert "Lead" in stages
    assert "Demo" in stages


def test_pipeline_deal_count_matches_sync_stats(mgr_token, _sync):
    """Pipeline endpoint count should match sync log pipeline_deals count."""
    status = requests.get(f"{BASE_URL}/api/sync/status", headers=H(mgr_token), timeout=15).json()
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    assert len(deals) == status["pipeline_deals"], (
        f"pipeline endpoint={len(deals)} vs sync stats={status['pipeline_deals']}"
    )


# =========================================================
# Customer tests
# =========================================================
def test_customers_contains_only_acquired(mgr_token, _sync):
    r = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
    customers = r.json()
    assert len(customers) > 0
    companies_str = " | ".join(c["company"] for c in customers).lower()
    for needle in EXPECTED_CUSTOMER_COMPANIES:
        assert needle.lower() in companies_str, (
            f"Expected acquired customer '{needle}' not found in /api/customers"
        )


def test_customers_do_not_include_pipeline_prospects(mgr_token, _sync):
    customers = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    companies_str = " | ".join(c["company"] for c in customers).lower()
    for bad in EXPECTED_PIPELINE_COMPANIES:
        assert bad.lower() not in companies_str, (
            f"Pipeline prospect '{bad}' leaked into /api/customers"
        )


def test_customers_all_have_positive_revenue(mgr_token, _sync):
    customers = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    for c in customers:
        assert c["revenue"] > 0, f"Customer {c['company']} has revenue={c['revenue']}"


def test_customer_count_matches_sync_stats(mgr_token, _sync):
    status = requests.get(f"{BASE_URL}/api/sync/status", headers=H(mgr_token), timeout=15).json()
    customers = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    assert len(customers) == status["customers"], (
        f"customers endpoint={len(customers)} vs sync stats={status['customers']}"
    )


# =========================================================
# Cross-endpoint invariants
# =========================================================
def test_no_company_in_both_pipeline_and_customers(mgr_token, _sync):
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    customers = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    p_set = {d["company"].strip().lower() for d in deals}
    c_set = {c["company"].strip().lower() for c in customers}
    overlap = p_set & c_set
    assert not overlap, f"Companies present in BOTH /api/pipeline and /api/customers: {overlap}"


# =========================================================
# Monthly Target regression (from iteration 4)
# =========================================================
def test_manager_monthly_target_still_2cr(mgr_token, _sync):
    r = requests.get(f"{BASE_URL}/api/dashboard", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
    assert r.json()["monthly"]["target"] == 20000000


def test_all_reps_monthly_target_sum_still_2cr(_sync):
    rep_emails = [
        "pawan.giri@cjdarcl.com",
        "anupam.malik@cjdarcl.com",
        "akash1.chauhan@cjdarcl.com",
        "manoj21.kumar@cjdarcl.com",
        "ajay8.kumar@cjdarcl.com",
        "vijay5.singh@cjdarcl.com",
        "pawan1.saini@cjdarcl.com",
        "kapil.chandila@cjdarcl.com",
    ]
    total = 0.0
    for e in rep_emails:
        tok = _login(e)
        d = requests.get(f"{BASE_URL}/api/dashboard", headers=H(tok), timeout=15).json()
        total += d["monthly"]["target"]
    assert abs(total - 20000000) < 1.0, f"Σ reps' target = {total}, expected 20000000"


# =========================================================
# RBAC regression
# =========================================================
def test_rep_pipeline_only_own_rows(rep_token, _sync):
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(rep_token), timeout=15).json()
    assert all(d["salesperson_email"] == REP_EMAIL for d in deals)


def test_rep_customers_only_own_rows(rep_token, _sync):
    customers = requests.get(f"{BASE_URL}/api/customers", headers=H(rep_token), timeout=15).json()
    assert all(c["salesperson_email"] == REP_EMAIL for c in customers)


# =========================================================
# PATCH → creates customer flow (regression from bug fix)
# =========================================================
def test_patch_pipeline_to_won_creates_customer(mgr_token, _sync):
    deals = requests.get(f"{BASE_URL}/api/pipeline", headers=H(mgr_token), timeout=15).json()
    # Pick a non-Won deal
    target = next((d for d in deals if d["stage"] != "Won"), None)
    assert target is not None, "No non-Won deal available"

    before = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    before_companies = {c["company"] for c in before}

    r = requests.patch(
        f"{BASE_URL}/api/pipeline/{target['id']}",
        headers={**H(mgr_token), "Content-Type": "application/json"},
        json={"stage": "Won"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "Won"

    after = requests.get(f"{BASE_URL}/api/customers", headers=H(mgr_token), timeout=15).json()
    after_companies = {c["company"] for c in after}
    assert target["company"] in after_companies, (
        f"Company {target['company']} not created in customers after PATCH stage=Won"
    )
    # If it wasn't there before, len must have grown.
    if target["company"] not in before_companies:
        assert len(after) == len(before) + 1


# =========================================================
# Sync stats sanity
# =========================================================
def test_sync_status_has_all_counters(mgr_token, _sync):
    status = requests.get(f"{BASE_URL}/api/sync/status", headers=H(mgr_token), timeout=15).json()
    for k in ("daily_records", "pipeline_deals", "customers", "payments", "targets", "synced_at"):
        assert k in status, f"sync/status missing '{k}'"
    assert status["pipeline_deals"] > 0
    assert status["customers"] > 0
    assert status["targets"] > 0
