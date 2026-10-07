# Velio Group Bookings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to carry out this plan one task at a time. Before starting a milestone, expand it into step-level TDD tasks in `docs/superpowers/plans/`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group bookings with held spots, vouch and public invites, zero oversell, live availability, and in-house metrics, in 40 hours.

**Architecture:** One TypeScript server is the only writer to Postgres. Every change to spot counts runs in a single transaction. After it commits, the server publishes to Redis, and Server-Sent Events push the update to clients. React serves hosts and bookers; Flutter serves invited guests. Events are written to Postgres and read by a dashboard page that the server renders.

**Tech Stack:** Node 24 + TypeScript, NestJS 11 (`@nestjs/schedule` for the expiry interval, `@Sse` for streams), `pg`, `ioredis`, Vitest · Postgres 16 + Redis 7 via Docker Compose · React + Vite · Flutter (`app_links`, `http`).

**Spec:** `grill-me-sessions/velioapp.grill.md` (decisions) · `Questions.MD` (27-question Q&A log).

## Global Constraints

- Postgres is the **only** source of truth for spot counts. Redis never decides whether a claim succeeds.
- Every change to spot counts (book, tie a spot to a vouch, claim, released-vouch fallback, expiry release) runs in **one Postgres transaction**. Whoever loses a race gets `409 race_lost`.
- Publish to Redis **only after commit**, with payload `{activityId, spotsLeft, version, committedAt}`. Clients drop any message with `version ≤ current`.
- Hold window = `min(72, (activityTime − bookingTime) / 3)` **hours**, in decimal hours, ignoring seconds.
- Held spots per booking ≤ `settings.new_user_cap` (default `2`, **not** counting the booker's own spot). It's read from Postgres on every booking.
- Vouch URL: **one per invitee, single-use, tied to one held spot.** Public URL: **one per booking, reusable.**
- Public claim order: **untied held spot → open spot.** Released-vouch claim: **open spot, keeping the vouch attribution → otherwise "sold out".**
- Everyone who claims joins the booker's Plan.
- Identity: phone + email, **unique per field**, unverified. Email is lowercased, and `+` aliases are rejected.
- Live updates use **SSE**, not WebSockets. Serve over HTTP/2 in any deployed environment.
- Every event carries `user_id`, `activity_id`, `plan_id` (where relevant), and `created_at` set by the server.

---

## Targets → evidence

| Goal | Target | Proven by |
| --- | --- | --- |
| Never oversell | 0 oversold | `CHECK (spots_left >= 0)` + the concurrency test (Task 6) + the dashboard counter |
| Booking success | 99.5% | `booking_failed.reason`: `race_lost` is excluded; `error`/`timeout` count as failures |
| Live availability | p95 ≤ 2s | p95 of `availability_received.latency_ms` |
| Bookers invite | 30% | bookers with ≥1 `invite_created` ÷ bookers |
| Invites convert | 25% | `spot_claimed` ÷ unique `invite_opened`, split by vouch and public |

---

## File Structure

```
velio_project/
├── docker-compose.yml                 # postgres:16, redis:7
├── velio_server/                      # NestJS API + SSE + expiry job + dashboard
│   ├── migrations/001_init.sql        # all tables, constraints, settings seed
│   ├── src/
│   │   ├── main.ts                    # bootstrap, CORS for velio_web
│   │   ├── app.module.ts              # imports feature modules, ScheduleModule
│   │   ├── db/db.service.ts           # pg Pool + tx(fn) helper (global module)
│   │   ├── track/track.service.ts     # track(client, event, props) — writes events row
│   │   ├── live/                      # live.service.ts publishAvailability(); live.controller.ts @Sse stream
│   │   ├── hold-window.ts             # holdWindowHours(activityAt, bookedAt) — pure function
│   │   ├── users/                     # users.controller.ts POST /users, users.service.ts
│   │   ├── activities/                # POST /activities, GET /activities/:id/availability
│   │   ├── bookings/                  # POST /bookings
│   │   ├── invites/                   # POST /plans/:id/invites, POST /invites/:token/claim
│   │   ├── expiry/expiry.service.ts   # @Interval(60_000) releaseExpiredHolds(), warnings
│   │   └── dashboard/                 # GET /dashboard (HTML), POST /settings
│   └── test/                          # vitest, runs against docker Postgres
│       ├── hold-window.spec.ts
│       ├── bookings.e2e-spec.ts
│       ├── invites.e2e-spec.ts
│       ├── expiry.e2e-spec.ts
│       └── concurrency.e2e-spec.ts
├── velio_web/                         # React (Vite): host + booker
│   └── src/{App.tsx, api.ts, useAvailability.ts, HostPage.tsx, BookerPage.tsx, PlanPage.tsx}
└── velio_flutter/                     # existing scaffold: guest claim
    └── lib/{main.dart, api.dart, availability_stream.dart, claim_screen.dart}
```

---

## ✅ In the cut — 37h + 3h buffer

### M1 — Backend core (14h)

#### Task 1: Infra + schema (3.5h)
**Files:** create `docker-compose.yml`, `velio_server/migrations/001_init.sql`, `src/db/db.service.ts`, `src/app.module.ts`
**Status:** ✅ `velio_server` (NestJS) and `velio_web` (Vite React TS) scaffolded, `docker-compose.yml` added — both build.
**Produces:** `tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>`; tables `users, activities, plans, spots, invites, settings, events`.
- [ ] `activities.spots_left INT CHECK (spots_left >= 0)`, `version BIGINT`
- [ ] `spots(status: 'booker'|'held'|'claimed'|'released', invite_id NULL, hold_expires_at)`
- [ ] `invites(type: 'vouch'|'public', token UNIQUE, plan_id, spot_id NULL, used_at)`; a partial unique index ensures one public invite per plan
- [ ] `users(phone UNIQUE, email UNIQUE)`; `settings(key PK, value)` seeded with `new_user_cap = 2`
- [ ] **Done when:** `docker compose up -d && npm run migrate` succeeds, and inserting `spots_left = -1` fails.

#### Task 2: Users + activities (1.5h)
**Files:** `src/users/*`, `src/activities/*`, `src/track/track.service.ts`, `test/bookings.e2e-spec.ts`
**Produces:** `POST /users {phone,email} → {id}` (returns the existing user if either field matches); `POST /activities {title, startsAt, capacity}`; `GET /activities/:id/availability → {spotsLeft, version}`; `track(c, name, props)`.
- [ ] Identity: an `X-User-Id` header acts as the role toggle; there's no auth
- [ ] **Done when:** a second `POST /users` with the same phone and a new email returns the same `id`.

#### Task 3: Hold window (0.5h)
**Files:** `src/hold-window.ts`, `test/hold-window.spec.ts`
**Produces:** `holdWindowHours(activityAt: Date, bookedAt: Date): number`
- [ ] **Done when:** these tests pass — 6h out → `2`; 24h out → `8`; 71h out → `23.67`; 300h out → `72`.

#### Task 4: Bookings (2.5h)
**Files:** `src/bookings/*`, `test/bookings.e2e-spec.ts`
**Consumes:** `tx`, `holdWindowHours`, `track` · **Produces:** `POST /bookings {activityId, heldSpots} → 201 {planId, holdExpiresAt} | 409 {available} | 422 {cap}`
- [ ] `UPDATE activities SET spots_left = spots_left - $n, version = version + 1 WHERE id = $1 AND spots_left >= $n RETURNING *`
- [ ] **Done when:** `heldSpots > cap` → 422; with 3 left and 4 requested → `409 {available: 3}`; on success it emits `booking_created`.

#### Task 5: Invites + claims (4h)
**Files:** `src/invites/*`, `test/invites.e2e-spec.ts`
**Produces:** `POST /plans/:id/invites {type}` → `{token, url}`; `POST /invites/:token/claim` → `201 {spotId} | 409 {reason: 'race_lost'|'sold_out'|'used'}`
- [ ] A vouch invite ties one untied held spot using `FOR UPDATE SKIP LOCKED`. If none are left → 409.
- [ ] Public claim: untied held spot → open spot. Released vouch: open spot, keeping `invite_type = 'vouch'`.
- [ ] **Done when:** all three claim paths and the "vouch already used" case are tested; each emits `spot_claimed` with `invite_type, invite_id, inviter_id, is_new_user`.

#### Task 6: Expiry job + concurrency proof (2h)
**Files:** `src/expiry/expiry.service.ts`, `test/expiry.e2e-spec.ts`, `test/concurrency.e2e-spec.ts`
**Produces:** `releaseExpiredHolds(now: Date)`, run every 60s via `@Interval(60_000)`.
- [ ] Releases held spots past `hold_expires_at` back to `spots_left`, and emits `hold_released`
- [ ] Emits `hold_warning_sent {pct: 50|90}` once per plan at each threshold
- [ ] **Done when:** 50 parallel claims on 1 remaining spot → exactly 1 success, 49 `race_lost`, and `spots_left = 0`.

### M2 — Live availability (4h)

#### Task 7: Publish + SSE (4h)
**Files:** `src/live/*`, modify `bookings.service.ts`, `invites.service.ts`, `expiry.service.ts`
**Produces:** `publishAvailability(activityId)` (called after commit); `GET /activities/:id/stream` (SSE); `POST /events` for client-side events.
- [ ] One Redis subscriber per server process, which passes updates on to the SSE connections for that activity
- [ ] **Done when:** two `curl -N` streams both receive the update after one booking; `availability_received` events are stored.

### M3 — React web: host + booker (9h)

#### Task 8: Shell + live hook (1.5h)
**Files:** `velio_web/src/App.tsx`, `api.ts`, `useAvailability.ts`
**Produces:** `useAvailability(activityId) → {spotsLeft, version}`: takes a snapshot, then reads from an `EventSource`, drops stale versions, and reports latency.
- [ ] **Done when:** the count updates in two tabs without a refresh.

#### Task 9: Host page (2h) — create an activity; list activities with live spots left.
#### Task 10: Booker page (2.5h) — book with a held-spot count; handle the `409 {available}` "book N?" prompt and the `422` cap error.
#### Task 11: Plan page (3h) — hold countdown, member list, create labelled vouch URLs and the public URL, copy to clipboard.
- [ ] **Done when:** the countdown matches the server's `holdExpiresAt`, and every created URL can be claimed.

### M4 — Flutter: guest claim (6h)

#### Task 12: Deep link + claim screen (4h)
**Files:** `velio_flutter/lib/main.dart`, `api.dart`, `claim_screen.dart`; iOS `Info.plist` and Android `AndroidManifest.xml` URL scheme
- [ ] `velio://invite/<token>` opens the claim screen and sends `invite_opened`
- [ ] Form: name, phone, email → claim → success / "sold out" / released-vouch fallback

#### Task 13: Live count in Flutter (2h)
**Files:** `lib/availability_stream.dart`
- [ ] Streaming `http` SSE parser; snapshot on `AppLifecycleState.resumed`; reports `availability_received`
- [ ] **Done when:** the count is correct after the app spends 1 minute in the background while another booking happens.

### M5 — Tracking dashboard (4h)

#### Task 14: Dashboard + settings (4h)
**Files:** `src/dashboard/*`
**Produces:** `GET /dashboard` (an HTML page with SQL-calculated metrics); `POST /settings {new_user_cap}`
- [ ] Metrics: oversell count, booking success %, p95 latency, invite rate, claim rate (vouch / public), K-factor (vouch / public), plans that happened
- [ ] **Done when:** changing `new_user_cap` on the dashboard changes the next booking's limit with no restart.

### Buffer (3h)
Device deep-link setup, integration fixes, and the end-to-end demo: host creates → booker books 1 + 2 held → vouches one friend and shares the public URL → two guests claim at the same time → the dashboard reflects every step.

---

## ⚠️ Stubbed

| Item | In this build | Why stubbed |
| --- | --- | --- |
| 50/90% hold warnings | Event + countdown UI; no email | An email provider takes setup time; the event already proves the timing is right. |
| Seat cap | One editable `new_user_cap` for everyone | Fill-rate formula and restore rule aren't defined. |
| Identity | Unverified, unique per field | Verification deferred by product decision. |
| Deep links | `velio://` custom scheme | Universal / App Links need a hosted domain and signed association files. |

## ❌ Not in the cut

| Item | Reason (concise) |
| --- | --- |
| Guest without the app installed | Assumed out: invitees have the app. **High risk:** K-factor ≈ 0 under this assumption. Cheapest fix later is a React claim page (~4h). |
| Cancellations (guest, booker, cascade to the Plan) | Rules are decided, but the cascading spot returns, solo-booking survival, and the "plan cancelled" page add ~6h that the budget doesn't have. |
| Host capacity change | Depends on cancellation and bumping logic; blocking is the decided behaviour, so there's no user-facing loss yet. |
| Fill-rate-based cap | Formula and "consistently filled" restore rule are still undefined; it can't be built without guessing. |
| Waitlist | A new feature; there's no data yet that sold-out invites are a real drop-off. |
| Email / push delivery | Needs a provider; iOS web push only works for sites added to the Home Screen, so bookers can't be reached reliably anyway. |
| OTP verification + normalisation (Gmail dots, E.164) | Product decision deferred; adds a step that hurts the 25% claim target. |
| Multi-instance scale testing | The Redis fan-out already supports it; there's no traffic to justify it. |
| Payments, full auth, trust scores, host verification | Out of scope in the brief. |

---

## Build order

1. **Tasks 1–6** — backend + concurrency proof. Nothing else matters if zero oversell isn't proven.
2. **Task 7** — live availability.
3. **Tasks 8–11** — React.
4. **Tasks 12–13** — Flutter.
5. **Task 14** — dashboard.
6. Buffer — the demo.

**If behind schedule, cut in this order:** Task 14 settings form (use SQL instead) → Task 11 polish → Task 13 SSE (fall back to polling every 2s).

## Open risks

1. **Guests without the app — HIGH.** See "Not in the cut".
2. **Unverified identity — MEDIUM.** Vouches can be spoofed; new identities can inflate K-factor and dodge the cap.
3. **40h across three codebases — MEDIUM.** Mitigated by the cut order above.
4. **Assumed:** the new-user cap of 2 excludes the booker's own seat. **Confirm.**
5. **Short hold windows:** a booking made 30 minutes before the activity gets a 10-minute window, so warnings land too late to help.
