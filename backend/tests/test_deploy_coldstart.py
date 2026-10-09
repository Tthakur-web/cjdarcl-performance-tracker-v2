"""Deployment cold-start regression test.

Verifies the fix for 'mongo_data_migrate ... StartToClose timeout':
1. Empty the sheet-backed collections.
2. Restart backend via supervisorctl.
3. GET /api/ must respond in < 1s (health check).
4. POST /api/auth/dev-login must respond in < 2s (auth immediately available).
5. Background sync must populate collections within ~20s.
"""
import os
import subprocess
import time

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001"
).rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

REP_EMAIL = "pawan.giri@cjdarcl.com"
SHEET_COLLECTIONS = [
    "daily_records",
    "pipeline_deals",
    "customers",
    "payments",
    "monthly_targets",
]


def _wait_ready(timeout=15):
    """Wait until /api/ answers 200."""
    start = time.time()
    last_err = None
    while time.time() - start < timeout:
        try:
            r = requests.get(f"{BASE_URL}/api/", timeout=2)
            if r.status_code == 200:
                return time.time() - start
        except Exception as e:
            last_err = e
        time.sleep(0.2)
    raise RuntimeError(f"Backend not ready in {timeout}s: {last_err}")


@pytest.fixture(scope="module")
def mongo_db():
    return MongoClient(MONGO_URL)[DB_NAME]


def test_cold_start_fast_after_wipe(mongo_db):
    """The deployment fix: wipe collections, restart, health must be fast."""
    # 1. Wipe sheet-backed collections
    for c in SHEET_COLLECTIONS:
        mongo_db[c].delete_many({})
    for c in SHEET_COLLECTIONS:
        assert mongo_db[c].count_documents({}) == 0, f"{c} not empty"

    # 2. Restart backend
    subprocess.run(
        ["sudo", "supervisorctl", "restart", "backend"],
        check=True, capture_output=True, timeout=30,
    )

    # 3. Wait until first 200 (measures cold-start-to-serving time)
    ready_in = _wait_ready(timeout=15)
    print(f"Backend ready in {ready_in:.2f}s")
    # Give a generous 10s ceiling because restart itself takes some time;
    # what matters is that /api/ itself responds quickly *once up*.
    assert ready_in < 10, f"Backend took {ready_in:.2f}s to become ready"

    # 4. Health endpoint must respond fast
    t0 = time.time()
    r = requests.get(f"{BASE_URL}/api/", timeout=5)
    health_t = time.time() - t0
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    print(f"/api/ latency: {health_t*1000:.0f}ms")
    assert health_t < 1.0, f"/api/ took {health_t:.2f}s (>1s)"

    # 5. dev-login must respond fast even while background sync is running
    t0 = time.time()
    r = requests.post(
        f"{BASE_URL}/api/auth/dev-login",
        json={"email": REP_EMAIL},
        timeout=5,
    )
    login_t = time.time() - t0
    assert r.status_code == 200, r.text
    assert "session_token" in r.json()
    print(f"dev-login latency: {login_t*1000:.0f}ms")
    assert login_t < 2.0, f"dev-login took {login_t:.2f}s (>2s)"


def test_background_sync_populates_collections(mongo_db):
    """After startup, background sync should populate collections within ~20s."""
    deadline = time.time() + 25
    counts = {}
    while time.time() < deadline:
        counts = {c: mongo_db[c].count_documents({}) for c in SHEET_COLLECTIONS}
        if all(counts[c] > 0 for c in ["daily_records", "pipeline_deals", "customers", "payments"]):
            break
        time.sleep(1)
    print("Post-sync counts:", counts)
    assert counts["daily_records"] > 0, f"daily_records not populated: {counts}"
    assert counts["pipeline_deals"] > 0, f"pipeline_deals not populated: {counts}"
    assert counts["customers"] > 0, f"customers not populated: {counts}"
    assert counts["payments"] > 0, f"payments not populated: {counts}"


def test_manual_sync_endpoint():
    """POST /api/sync returns stats when authenticated."""
    tok = requests.post(
        f"{BASE_URL}/api/auth/dev-login", json={"email": REP_EMAIL}, timeout=10
    ).json()["session_token"]
    r = requests.post(
        f"{BASE_URL}/api/sync",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True
    for k in ["daily_records", "pipeline_deals", "customers", "payments"]:
        assert k in j and j[k] > 0, f"missing/empty {k} in sync response: {j}"


def test_manual_sync_requires_auth():
    r = requests.post(f"{BASE_URL}/api/sync", timeout=10)
    assert r.status_code == 401
