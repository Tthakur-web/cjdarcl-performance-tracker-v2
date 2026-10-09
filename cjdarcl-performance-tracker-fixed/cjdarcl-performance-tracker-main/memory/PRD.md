# BDM Performance Tracker — PRD (v2)

## Problem
CJ DARCL's 7-8 BDMs need a mobile-first dashboard to see their own daily demand entries, existing customer forecast vs actual, new-acquisition pipeline, and chase outstanding/overdue payments. All data lives in a single Google Sheet with 4 relevant tabs.

## Data model (live Google Sheets, published as CSV)
- **Demands** (`SHEET_URL_DAILY`, gid=1550433876): fed by Google Form + ops team.
  Columns: Timestamp, Email Address, Customer Name, From/To Location, Vehicle Type, Weight In MT, Costing, Freight, Status, GM2, GM2%.
- **Active Customer** (`SHEET_URL_ACTIVE_CUSTOMER`, gid=2046569261): BDM's active customers with monthly forecast + sales-done.
  Columns: BDM Name, Name (customer), Forecasted Sales `<Month>`, `<Day> <Month>` OR Sales Done — recognized case-insensitively.
- **New Acquisition Pipeline** (`SHEET_URL_PIPELINE`, gid=891446056): prospects.
  Columns: SR NO, BDM NAME, CUSTOMER NAME, LOCATION, POTENTIAL, EXP CLOSER DATE, Business Acquired, Stage.
- **Payments** (`SHEET_URL_PAYMENTS`, gid=1731118634): outstanding & overdue per customer.

## Classification of every demand row
- If `Customer Name` matches `New Acquisition <Month>` (case-insensitive, month auto-detected from `MONTH_LABEL` env or system date) → `new_acquisition`.
- Else if `Customer Name` exists in Active Customer tab → `existing`, and the row is enriched with the customer's forecast + sales-done.
- Else → `needs_review` (data-quality nudge, surfaced in-app for ops to fix).

Manager `MANAGER_EMAILS = {"rohit1.singh@cjdarcl.com"}` sees all reps' data. Every other BDM sees only their own rows (filtered by `Email Address` from the Demands tab and by the resolved email of `BDM NAME` in other tabs).

BDM name → email mapping is built from Demands email addresses (digits stripped from the local-part). Manager Rohit is hard-mapped since he doesn't appear in Demands.

## Screens
1. **Dashboard** — Day/Month toggle, prev/next date arrows, TODAY jump. Cards for:
   - Demand Weight (MT) for selected period
   - Financials: Freight / Costing / GM2
   - Demand Classification: Existing / New Acquisition / Needs Review (tap to open Needs Review screen)
   - Monthly Target vs Achieved (target from `MONTHLY_TARGET_TOTAL=₹2Cr`; manager sees full team, rep sees proportional share)
   - 7-day trend bar chart
   - Outstanding & Overdue payments block with CHASE PAYMENTS CTA
   - Active Pipeline mini-stat
   - "Last Synced" pill in header
2. **Customers** — Active customers list (117 for manager). Search. Each card shows Forecast / Sales Done / attainment %, plus period demand activity (Weight, Freight, Costing, GM2, status breakdown, last demand date).
3. **Pipeline** — New Acquisition Demand Activity aggregate on top; stage-chip filter (All/Lead/Contacted/Demo/Negotiation/Won); grouped stage sections with real prospects; ADVANCE/BACK actions.
4. **Payments** — Outstanding + Overdue rows with REMIND toggle (preserved across syncs).
5. **Needs Review** — 40 unmatched demand rows for the current period with an ops-facing hint.
6. **Profile** — Google account details, SYNC NOW button, last-synced stats, sign-out.

## Auth
- **Real Google OAuth** via Emergent-managed auth. `POST /api/auth/google-session`. Every BDM signs in independently with their `cjdarcl.com` account.
- **Dev-login** (`POST /api/auth/dev-login`) — retained for automation/testing only; kept behind a toggle on the login screen and clearly labeled.

## Sync
- Background task on backend startup — health check unblocked; sync runs in `asyncio.create_task`.
- Pull-to-refresh on any tab AND SYNC NOW on Profile trigger `POST /api/sync`.
- `reminder_sent_at` on Payments is preserved across syncs (matched by rep + customer).

## Tech
- Backend: FastAPI + Motor/MongoDB + httpx (CSV pull). Endpoints prefixed with `/api`.
- Frontend: Expo Router (file-based). Native SafeAreaView, Reanimated, expo-web-browser.
- MongoDB indexes: users.email, users.user_id, user_sessions.session_token (TTL), daily_records (email,date + category), pipeline_deals, customers, active_customers, payments.

## Verified by testing_agent (iteration 6): 55/55 backend green, full frontend E2E green.
