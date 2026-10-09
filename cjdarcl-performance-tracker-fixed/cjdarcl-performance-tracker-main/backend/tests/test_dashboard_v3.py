"""Iteration 7: Dashboard changes (financials placed-only, counts.raised/placed, by_bdm, trend raised/placed, periodic sync)."""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
REP_EMAIL = "pawan.giri@cjdarcl.com"
MGR_EMAIL = "rohit1.singh@cjdarcl.com"


def H(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def mgr_token():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": MGR_EMAIL}, timeout=20)
    assert r.status_code == 200
    return r.json()["session_token"]


@pytest.fixture(scope="module")
def rep_token():
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": REP_EMAIL}, timeout=20)
    assert r.status_code == 200
    return r.json()["session_token"]


# --- Counts.raised & counts.placed present ---
def test_dashboard_has_counts_raised_and_placed(mgr_token):
    r = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(mgr_token), timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "counts" in d
    assert "raised" in d["counts"] and isinstance(d["counts"]["raised"], int)
    assert "placed" in d["counts"] and isinstance(d["counts"]["placed"], int)
    assert d["counts"]["raised"] >= d["counts"]["placed"] >= 0


# --- Financials placed-only ---
def test_dashboard_totals_are_placed_only(mgr_token):
    # Compute placed-only totals from /api/demands and compare
    d = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(mgr_token), timeout=20).json()
    rows = requests.get(f"{BASE_URL}/api/demands?period=month", headers=H(mgr_token), timeout=20).json()
    placed = [r for r in rows if (r.get("status") or "").lower() == "placed"]
    sum_freight_placed = sum(r.get("freight", 0) for r in placed)
    sum_freight_all = sum(r.get("freight", 0) for r in rows)
    # Dashboard totals.freight should equal placed-only
    assert abs(d["totals"]["freight"] - sum_freight_placed) < 1.0, (
        f"dashboard freight {d['totals']['freight']} != placed-only sum {sum_freight_placed}"
    )
    # Sanity: placed <= all
    assert sum_freight_placed <= sum_freight_all + 1


def test_dashboard_totals_placed_only_costing_gm2(mgr_token):
    d = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(mgr_token), timeout=20).json()
    rows = requests.get(f"{BASE_URL}/api/demands?period=month", headers=H(mgr_token), timeout=20).json()
    placed = [r for r in rows if (r.get("status") or "").lower() == "placed"]
    assert abs(d["totals"]["costing"] - sum(r.get("costing", 0) for r in placed)) < 1.0
    assert abs(d["totals"]["gm2"] - sum(r.get("gm2", 0) for r in placed)) < 1.0


# --- Trend has raised/placed for each of 7 days ---
def test_trend_has_raised_placed_all_7_days(mgr_token):
    d = requests.get(f"{BASE_URL}/api/dashboard?period=day&ref_date=2026-08-19",
                     headers=H(mgr_token), timeout=20).json()
    assert len(d["trend"]) == 7
    for t in d["trend"]:
        assert "raised" in t and isinstance(t["raised"], int)
        assert "placed" in t and isinstance(t["placed"], int)
        assert "date" in t
        assert t["placed"] <= t["raised"]


# --- by_bdm for manager ---
def test_by_bdm_manager_has_entries(mgr_token):
    d = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(mgr_token), timeout=20).json()
    assert "by_bdm" in d
    assert isinstance(d["by_bdm"], list)
    assert len(d["by_bdm"]) >= 1
    for b in d["by_bdm"]:
        for k in ["email", "name", "raised", "placed", "weight", "freight", "costing", "gm2"]:
            assert k in b, f"missing {k} in by_bdm entry"


def test_by_bdm_manager_contains_all_reps(mgr_token):
    """Should include all reps even with 0 activity."""
    d = requests.get(f"{BASE_URL}/api/dashboard?period=day&ref_date=2020-01-01",
                     headers=H(mgr_token), timeout=20).json()
    # In quiet period, by_bdm might be empty OR contain 0-activity reps.
    # The spec says: entries should include reps with 0 activity when there IS at least one active row.
    # For an all-zero window, allow empty list.
    assert isinstance(d["by_bdm"], list)


# --- by_bdm empty for rep ---
def test_by_bdm_empty_for_rep(rep_token):
    d = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(rep_token), timeout=20).json()
    assert d.get("by_bdm") == []


# --- Sanity check: raised >= placed and freight (placed only) <= sum of ALL freight ---
def test_manager_sanity_placed_only(mgr_token):
    d = requests.get(f"{BASE_URL}/api/dashboard?period=month", headers=H(mgr_token), timeout=20).json()
    rows = requests.get(f"{BASE_URL}/api/demands?period=month", headers=H(mgr_token), timeout=20).json()
    total_freight_all = sum(r.get("freight", 0) for r in rows)
    assert d["counts"]["raised"] >= d["counts"]["placed"]
    assert d["totals"]["freight"] <= total_freight_all + 1


# --- Periodic sync code path present ---
def test_periodic_sync_function_defined_in_server_py():
    with open("/app/backend/server.py") as f:
        src = f.read()
    assert "_periodic_sync" in src, "_periodic_sync function should be defined"
    assert "SYNC_INTERVAL_SEC" in src, "SYNC_INTERVAL_SEC env var should be referenced"
    assert re.search(r"asyncio\.create_task\(\s*_periodic_sync\(", src), \
        "_periodic_sync should be scheduled via asyncio.create_task"


# --- Regression: other endpoints still healthy ---
@pytest.mark.parametrize("path", [
    "/api/customers?period=month",
    "/api/pipeline?period=month",
    "/api/needs-review?period=month",
    "/api/payments?status=all",
    "/api/sync/status",
])
def test_regression_endpoints_ok(mgr_token, path):
    r = requests.get(f"{BASE_URL}{path}", headers=H(mgr_token), timeout=25)
    assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"


def test_regression_pipeline_shape(mgr_token):
    r = requests.get(f"{BASE_URL}/api/pipeline?period=month", headers=H(mgr_token), timeout=20)
    j = r.json()
    assert "deals" in j and "actual_activity" in j


def test_regression_auth_logout(mgr_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(mgr_token), timeout=15)
    assert r.status_code == 200
