"""Regression tests for the Monthly Target fix (₹2 Cr team target)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
EXPECTED_TOTAL = float(os.environ.get("MONTHLY_TARGET_TOTAL", 20000000))

MGR_EMAIL = "rohit1.singh@cjdarcl.com"
REP_EMAILS = [
    "pawan.giri@cjdarcl.com",
    "anupam.malik@cjdarcl.com",
    "akash1.chauhan@cjdarcl.com",
    "manoj21.kumar@cjdarcl.com",
    "ajay8.kumar@cjdarcl.com",
    "vijay5.singh@cjdarcl.com",
    "pawan1.saini@cjdarcl.com",
    "kapil.chandila@cjdarcl.com",
]


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/dev-login", json={"email": email}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


def _dashboard(token):
    r = requests.get(f"{BASE_URL}/api/dashboard",
                     headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---- Manager sees full team target ----
def test_manager_monthly_target_equals_env_total():
    tok = _login(MGR_EMAIL)
    d = _dashboard(tok)
    assert d["monthly"]["target"] == EXPECTED_TOTAL, (
        f"Manager target={d['monthly']['target']} vs expected={EXPECTED_TOTAL}"
    )
    # placement remains a number, not None
    assert isinstance(d["monthly"]["placement"], (int, float))


# ---- Rep sees a proportional share > 0 and < total ----
def test_rep_monthly_target_proportional_share():
    tok = _login("pawan.giri@cjdarcl.com")
    d = _dashboard(tok)
    tgt = d["monthly"]["target"]
    assert tgt > 0, f"Rep target should be > 0, got {tgt}"
    assert tgt < EXPECTED_TOTAL, f"Rep target should be < {EXPECTED_TOTAL}, got {tgt}"


# ---- Sum of reps' targets ≈ team total (proves proportional split) ----
def test_sum_of_rep_targets_matches_team_total():
    total = 0.0
    reached = []
    for email in REP_EMAILS:
        try:
            tok = _login(email)
        except AssertionError:
            # rep may not exist in DB — skip silently
            continue
        d = _dashboard(tok)
        total += d["monthly"]["target"]
        reached.append(email)
    assert reached, "Could not login as any rep"
    # Allow ±1% tolerance for float rounding
    delta = abs(total - EXPECTED_TOTAL)
    assert delta / EXPECTED_TOTAL < 0.01, (
        f"Sum of {len(reached)} rep targets = {total} vs {EXPECTED_TOTAL} "
        f"(delta={delta}); reps={reached}"
    )


# ---- monthly.placement still aggregated (regression) ----
def test_manager_placement_unchanged_by_target_logic():
    tok = _login(MGR_EMAIL)
    d = _dashboard(tok)
    # Manager placement = sum of all reps' placement. Should be a number >=0.
    assert d["monthly"]["placement"] >= 0
    # Also present in trend
    assert len(d["trend"]) == 7
    for day in d["trend"]:
        assert "placement" in day and "demand" in day


# ---- No regression on /api/sync-status shape ----
def test_sync_status_endpoint():
    tok = _login(MGR_EMAIL)
    r = requests.get(f"{BASE_URL}/api/sync/status",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    # Some builds may not have /api/sync/status; accept 200 or 404 but flag 500
    assert r.status_code in (200, 404), r.text


# ---- No regression on /api/sync ----
def test_sync_endpoint_manager():
    tok = _login(MGR_EMAIL)
    r = requests.post(f"{BASE_URL}/api/sync",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    # Should mention counts
    assert isinstance(j, dict)
