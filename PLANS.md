# Velio Group Bookings — Implementation Plan (as built)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` for any follow-up work in [Next steps](#11-next-steps). Expand a next step into step-level TDD tasks in `docs/superpowers/plans/` before starting it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group bookings with held spots, vouch and public invites, zero oversell, live availability, and in-house metrics, in a 40-hour budget.

**Architecture:** One NestJS server is the only writer to Postgres, and every change to a spot count runs in a single transaction. After the commit, the server publishes the new count to Redis. Every server instance relays it to its clients over Server-Sent Events. React serves hosts and bookers; Flutter serves invited guests. Events are written to Postgres in the same transaction as the change they describe, and a dashboard page rendered by the server reads them.

**Tech Stack:**
- **Server:** Node 24, NestJS 12 (ESM), Drizzle ORM over `pg`, `ioredis`, `@nestjs/schedule`, Vitest + Supertest.
- **Infrastructure:** Postgres 16 and Redis 7 via Docker Compose.
- **Web:** React 19 + Vite 8, Vitest.
- **Mobile:** Flutter 3.44 with `hooks_riverpod`, `flutter_hooks`, `dio`, `fpdart`, `app_links`, `shared_preferences`.

**Spec:** the product grill session (decisions and risks; kept locally and excluded from git) · `Questions.MD` (27-question Q&A log, kept locally and excluded from git).

**Companion docs:** [`README.md`](README.md) (run it, architecture, trade-offs, tracking) · [`OWNERSHIP.md`](OWNERSHIP.md) (invite-funnel diagnosis and improvements).



Builds and linters are clean. See [Verification](#9-verification) for what has and hasn't been checked by eye.

---

## Global Constraints

Every task follows these rules. The code enforces each one, and a test checks it.

1. **Postgres is the only source of truth for spot counts.** Redis only broadcasts; it never decides whether a claim succeeds.
2. **One transaction per spot change.** This covers: booking (the booker's spot plus held spots), tying a spot to a vouch link, claiming, the released-vouch fallback, and releasing expired holds. Whoever loses a race gets `409 {reason: 'race_lost'}`.
3. **The oversell guard lives in the database:** `CHECK (spots_left >= 0 AND spots_left <= capacity)` plus a conditional decrement (`… WHERE spots_left >= $n`).
4. **Publish only after commit**, with payload `{activityId, spotsLeft, version, committedAt}`. Clients drop any message whose `version` is ≤ the one they have.
5. **Hold window** = `min(72h, (activityTime − bookingTime) / 3)`, in whole minutes (seconds ignored). Unfilled held spots go back to the open pool when it ends.
6. **Cap:** held spots per booking ≤ `settings.new_user_cap`, which defaults to `2` and does **not** count the booker's own spot. It's read from Postgres on every booking.
7. **Vouch link:** one per invitee, single-use, tied to one held spot. **Public link:** one per plan, reusable.
8. **Where a claimed spot comes from.** Public claim: an untied held spot, then an open spot. Vouch whose spot was released: an open spot, still credited as a vouch, otherwise `race_lost`. Everyone who claims joins the booker's plan.
9. **One spot per person per activity**, enforced by a unique index. A second claim gets `409 {reason: 'duplicate'}`.
10. **Identity:** name, phone and email. Phone and email are **each unique on their own**, and neither is verified. Emails are lowercased, and `+` aliases are rejected. The `X-User-Id` header acts as the role toggle; there is no auth.
11. **Live updates use SSE**, not WebSockets. Serve over HTTP/2 in any deployed environment.
12. **Every event carries** `user_id`, `activity_id`, `plan_id` (where relevant), and a server `created_at`. Invite and claim events also carry `inviteType`, `inviteId`, `inviterId` and `isNewUser`.

---

## Scope questions and three plans

Before building, I worked through 27 scope questions (logged in `Questions.MD`). The scope was silent on several of them, so I answered those with an assumption. These five assumptions shaped the build most:

| # | Scope question | My assumption | What it costs if I'm wrong |
| --- | --- | --- | --- |
| 1 | When do a booker's friends' spots leave availability? (Q1) | The scope didn't say, so I assumed the booker reserves their friends' spots **at booking time**, on an activity with a fixed capacity set by the host. | Activities can look full while friends haven't claimed. The hold window and the cap limit this. |
| 2 | How long are unclaimed spots held? (Q4–Q6) | I assumed the **host fixes the activity date**, so the window can come from the time left: it became `min(72h, remaining ÷ 3)`. | If hosts can reschedule, every open hold window needs recalculating. |
| 3 | What's the minimum identity for a first-time guest? (Q11–Q13) | I assumed **phone + email**, each unique, with `+` aliases blocked, is enough to treat every sign-up as a unique person. **No verification.** | Anyone can type someone else's number, so vouches can be spoofed and K-factor inflated. |
| 4 | What happens when a guest without the app taps an invite? (Q19–Q20) | I assumed **everyone who gets an invite already has the app installed**. | The highest risk: first-time guests are lost, so K-factor stays near zero. |
| 5 | What counts as an invite, and as a plan that happened? (Q21–Q22) | I assumed bookers **create** vouch and public links **on demand** (nothing auto-generated), and that a plan **happens** when its date passes with the booker plus ≥ 1 guest still holding spots (no check-in). | "Created" isn't "sent", and without check-in I can't know who actually turned up. |

Each set of answers leads to a different product. I sketched three plans:

**Plan A: Reserve up front** *(the one I built).* Friends' spots are held at booking for `min(72h, remaining ÷ 3)`. Each friend gets a single-use vouch link tied to one held spot; the public link takes untied held spots first, then open ones. Identity is phone + email, unverified. Guests claim in the Flutter app; hosts and bookers use React. Tracking is in-house. **Gains:** a vouched friend is guaranteed a seat, and zero oversell is proven. **Costs:** first-time guests without the app are invisible, and holds can make activities look full for hosts. About 40h.

**Plan B: Growth first.** This flips assumptions 1, 3 and 4. Nothing is held: a spot is only taken when a guest claims, and the vouch link just carries attribution. Guests claim on a React web page that opens straight from the link, with a nudge to install afterwards. A phone one-time code at claim makes every new user real. Flutter becomes the booker app (native contacts for picking who to vouch for, push notifications). **Gains:** K-factor becomes measurable and can grow, and hosts never see phantom-full activities. **Costs:** an invited friend can find the activity sold out, the one-time code adds a step to the claim, and SMS costs money. About 45h plus an SMS provider.

**Plan C: Lean web-only.** One React app for hosts, bookers and guests; no Flutter. Holds apply to vouch links only, with a fixed 24-hour window; public claims use only the open pool. Identity is phone only, unverified. Links are created automatically at booking, so the invite metric becomes "shared" (tracked with the Web Share API) instead of "created". Events go to a third-party analytics tool. **Gains:** fastest to ship, no install, one codebase. **Costs:** it drops the mobile app I wanted for guests, has no native push, gives a fixed window that's too long for same-day activities, and leaves the data with a vendor. About 25h.

**Why I chose Plan A.** Zero oversell is the one target I can't fix after launch, and Plan A protects it along with the vouch promise ("I stand behind this person, and there's a seat for them"). It also keeps the React + Flutter split I wanted. Its weak spot is assumption 4. That's why my first next step borrows from Plan B: a web claim page for guests without the app ([Next steps](#11-next-steps)).

---

## 1. Targets → evidence

| Goal | Target | How it's measured | Proven by |
| --- | --- | --- | --- |
| Never oversell | 0 oversold | Activities whose non-released spots exceed capacity, plus a **count-drift** check (`capacity − spots_left` must equal the number of non-released spots) | DB constraint · `concurrency.e2e-spec.ts` · dashboard tile |
| Booking success | ≥ 99.5% | (`booking_created` + `spot_claimed`) ÷ (those + `booking_failed` with reason `error` or `timeout`); `race_lost` is excluded | `dashboard.e2e-spec.ts` |
| Live availability | p95 ≤ 2s | p95 of `availability_received.props.latencyMs`, corrected for client clock drift | `live.e2e-spec.ts`, Flutter `live_backend_test.dart`, headless-Chrome run (75 ms) |
| Bookers invite | ≥ 30% | bookers with ≥1 `invite_created` ÷ bookers | `dashboard.e2e-spec.ts` |
| Invites convert | ≥ 25% | `spot_claimed` ÷ unique `invite_opened` (per person per link), **split by vouch and public** | `dashboard.e2e-spec.ts` |
| K-factor | tracked | new users whose first action was claiming through an invite ÷ bookers, split by vouch and public | `dashboard.e2e-spec.ts` |
| Plans that happen | tracked | past plans with the booker plus ≥1 claimed guest | `dashboard.e2e-spec.ts` |

All of these are on `GET /dashboard` (HTML) and `GET /dashboard/metrics` (JSON).

---

## 2. Changes from the original plan

| Area | Originally planned | As built | Why |
| --- | --- | --- | --- |
| Tracking helper | `track/track.service.ts` | Plain `track(client, name, ids, props)` in `track/track.ts` | A function is enough; taking the transaction client keeps events atomic with the change they record |
| Users / activities | Controller + service each | Controllers only | Thin CRUD; no logic for a service layer to hold |
| `POST /users` body | `{phone, email}` | `{name, phone, email}` | The guest form and plan member list need a name |
| Schema | `hold_expires_at` on each spot | `plans.hold_expires_at` + `plans.warned_pct`; `spots.activity_id`; unique index `one_spot_per_user_per_activity` | The hold belongs to the plan; the index blocks duplicate claims (vouch + public) at the database |
| Hold window | decimal hours | Whole minutes, then hours | "Seconds don't matter" becomes exact, with no float drift |
| Claim failure reasons | `race_lost` · `sold_out` · `used` | `race_lost` · `used` · `duplicate`; invite creation adds `no_held_spot` | One "no spot at commit" reason for bookings and claims keeps the 99.5% calculation simple |
| Expired but unreleased hold | not specified | Still claimable until the expiry job runs | Same count as release + reclaim, done in one step (code comment in `invites.service.ts`) |
| `invite_opened` | Sent by Flutter through `POST /events` | Recorded by the server on **`GET /invites/:token`** (new endpoint) using the optional `X-User-Id` | More reliable; the guest app already loads the invite from there |
| `POST /events` | Any client event | Only `availability_received`; the server computes `latencyMs` with clock-drift correction | Clients can't forge business events; phone clocks drift |
| Live streams | `GET /activities/:id/stream` | **+ `GET /activities/stream`** (all activities, one connection) | Browsers allow only 6 connections per host on HTTP/1.1, so a list page can't open one per activity |
| Stream ordering | Snapshot, then updates | Subscribe to updates **before** reading the snapshot | Otherwise a commit landing in between would be missed |
| Read endpoints | — | **+ `GET /activities`, `GET /plans`, `GET /plans/:id`, `GET /users`, `GET /users/me/activities`** | Needed by the React list, plan and identity-picker pages, and the guest app's "My activities" tab |
| Guest app navigation (mobile) | One claim screen | **Two bottom tabs: "Invite" (Got an invite?) and "My activities"** (every activity the guest booked or claimed, with date and time, split into Upcoming and Past, "With <booker>" or "You booked this"). It loads on launch, when the tab is opened, after a claim, and on pull-to-refresh. A used invite always switches back to the Invite tab for the flashbar | My call (2026-10-08): guests need to see what they've signed up for and when |
| Web live hook | `useAvailability(activityId)` | `useLiveCounts(userId)` → `{counts, seed, resyncKey}`; pages reload when `resyncKey` changes (reconnect or tab focus) | One connection per page; reloading on resync covers sleep and dropped connections |
| Web routing / identity | — | Hash routing (3 routes); identity picker + "New user" stored in `localStorage` | No router library needed; simple role toggle per the brief |
| Plan membership | live | Polled every 5s | Only spot counts are pushed live; membership changes rarely |
| Flutter structure | `api.dart`, `availability_stream.dart`, `claim_screen.dart` | Preferred mobile architecture: views → `ClaimVM` → `InviteRepository` → `InviteClient` (Dio) + services | My preferred mobile architecture (views → view models → repositories → clients) |
| Flutter HTTP | `http` | `dio` (Dio delivers `Uint8List` streams, so the SSE parser `cast`s the bytes) | Required by the architecture; regression test in `sse_test.dart` |
| Flutter extras | — | Home screen for pasting a link or code; `StorageService` remembers the user ID; SSE reconnect after 2s | The scope says guests arrive "through a link **or code**"; returning guests skip identity entry |
| Invalid-invite errors (mobile) | Shown on the claim screen | **Checked on the "Got an invite?" page first** (`InviteEntryVM`). A used vouch link or unknown invite shows a **flashbar that drops in from the top, stays 2 seconds and slides back up** (no tap needed), and the claim page never opens. A vouch used up while the guest fills the form sends them back there with the same flashbar. Pasted codes, tapped links and the launch link all go through this check | My call (2026-10-08): the claim page is only for claiming and its confirmation. The invite is fetched once and handed to the claim page, so `invite_opened` still counts once |
| Design language (web + mobile) | Material defaults on mobile (seeded palette, app bars, chips) | **One design language, with the web as the reference.** `velio_theme.dart` mirrors the CSS tokens (light and dark) and builds the Material theme: flat bordered cards (12px), 8px controls, semibold buttons, outlined inputs, the uppercase VOUCH badge, "N of M left" with amber/red tones, warm notices, the short date format (`formatWhen`) and an active-pill tab bar. **No app bars**: each screen starts with a page header (title, plus "← Back" on the claim page) like the web's `h1` | My call (2026-10-08): both apps should feel like one product |
| Loading states (web + mobile) | Text ("Loading…") or a bare spinner | **Skeletons shaped like the content** for first loads (web lists and plan page; mobile "My activities"). They stay invisible for 150ms so fast loads don't flash, pulse gently, and stay still under reduced motion. **Every action button has a working state**: it keeps its colour, shows a spinner and says what's happening ("Booking…", "Creating link…", "Checking invite…", "Claiming your spot…"). Form fields lock while a claim or invite check is in flight; the claim result fades in. Web: `Skeleton.tsx` + CSS; mobile: `lib/widgets/{skeleton,busy_button}.dart` | My call (2026-10-08). It also fixed real bugs: list pages showed "No upcoming activities" while loading, and a double-click on "Create vouch link" could create two links and spend two held spots |
| Vouch link disabled (web) | — | The plan page says why "Create vouch link" is unavailable (no held spots, hold ended, every held spot already vouched) | It was silently greyed out for a plan booked with +0 friends |
| Dashboard | HTML + `POST /settings` | + `GET /dashboard/metrics` (JSON) and the count-drift check; database test files run **one at a time** | JSON for scripting; drift catches count bugs the oversell check can't; serial runs allow exact metric assertions |
| Queries | Inside the dashboard code only | + `velio_server/queries/metrics.sql` (same definitions, runnable in `psql`, optional `since` filter) | Reviewers can run the queries directly; checked to match `/dashboard/metrics` exactly |
| Demo tooling | — | `velio_server/scripts/race-demo.sh` (N guests race for the last spot); `scripts/load-test.mjs` (1,000 users end to end through the API); Flutter `--dart-define=INVITE=<link or token>` opens an invite on launch | Shows zero oversell live; skips the iOS "Open in Velio?" prompt during demos |
| Data access | Raw SQL through `pg` | **Drizzle ORM** (2026-10-08). Typed schema in `src/db/schema.ts`; every query goes through the typed builder, including the conditional decrement (`gte(spotsLeft, n)`), `FOR UPDATE` / `SKIP LOCKED` (`.for('update', { skipLocked: true })`) and `ON CONFLICT`. Metrics keep Postgres `FILTER` / `percentile_cont` as `sql` fragments over typed columns. SQL migrations stay the source of truth for CHECKs and partial unique indexes, and `schema-drift.e2e-spec.ts` fails if a column disagrees. **Gotcha:** Drizzle drops table names from columns in SELECT/RETURNING lists, so correlated subqueries there must be nested builders, not hand-written `sql` strings (the tests caught two) | My call: typed queries instead of SQL strings. Re-ran the 1,000-user load test: ~1,390 req/s, 0 oversold, 0 drift |
| Plan file | `Plans.MD` | **`PLANS.md`** | Matches the name the exercise brief uses |
| Running the stack | Docker for Postgres + Redis; server and web via npm | **`docker compose up -d --build` runs everything**: `velio_server/Dockerfile` (two-stage build, migrations run on start) and `velio_web/Dockerfile` (Vite build served by nginx); health checks hold the server until Postgres and Redis are ready. npm is still available for hot reload | One command to start the whole app for reviewers and demos |

---

## 3. API reference

All endpoints are in `velio_server/src`. `🔑` means the endpoint requires an `X-User-Id` header.

| Method & path | 🔑 | Returns | Errors |
| --- | --- | --- | --- |
| `POST /users {name, phone, email}` | | `201 {id}` new · `200 {id}` existing (phone or email matched) | 400 invalid / `+` alias |
| `GET /users` | | `[{id, name}]` (no contact details) | |
| `POST /activities {title, startsAt, capacity}` | 🔑 | `201 Activity` | 400 past date / capacity < 1 · 400 unknown user |
| `GET /activities` | | upcoming `Activity[]` | |
| `GET /activities/:id/availability` | | `{spotsLeft, version}` | 404 |
| `POST /bookings {activityId, heldSpots}` | 🔑 | `201 {planId, holdExpiresAt, spotsLeft, version}` | 422 `{cap}` · 409 `{reason:'race_lost', available}` · 409 `duplicate` · 400 started |
| `GET /plans` | 🔑 | the caller's plans | |
| `GET /users/me/activities` | 🔑 | `[{planId, role:'booker'\|'guest', bookerName, activity}]` for every spot the caller holds, soonest first | 401 without `X-User-Id` |
| `GET /plans/:id` | 🔑 booker | plan, activity, hold times, `heldSpotsLeft`, members, invites | 403 · 404 |
| `POST /plans/:id/invites {type, label?}` | 🔑 booker | `201 {inviteId, type, token, label, url}` (public: `200` if it already exists) | 409 `no_held_spot` · 403 |
| `GET /invites/:token` | optional | invite + activity + inviter name; records `invite_opened` | 404 |
| `POST /invites/:token/claim` | 🔑 | `201 {spotId, planId, activityId, source:'held'\|'open', spotsLeft, version}` | 409 `race_lost` / `used` / `duplicate` · 400 own invite / started |
| `GET /activities/:id/stream` | | SSE: snapshot + updates, ping every 25s | 404 |
| `GET /activities/stream` | | SSE: updates for every activity | |
| `POST /events {name:'availability_received', activityId, props}` | optional | `{ok:true}` | 400 other event names |
| `GET /dashboard` · `GET /dashboard/metrics` | | HTML · `Metrics` JSON | |
| `POST /settings` (form: `new_user_cap`) | | `303 → /dashboard` | 400 if not 0–50 |

---

## 4. File structure

```
velio_project/
├── docker-compose.yml                     postgres:16 + redis:7
├── velio_server/                          NestJS 12 (ESM)
│   ├── migrations/001_init.sql            all tables, constraints, indexes, settings seed
│   ├── src/
│   │   ├── main.ts                        bootstrap + CORS
│   │   ├── app.module.ts                  wires every controller/service, ScheduleModule, PgErrorFilter
│   │   ├── db/{db.module,db.service,migrate}.ts   Drizzle client (orm), tx(fn), migration runner (npm run migrate)
│   │   ├── db/schema.ts                    Drizzle tables mirroring migrations/*.sql (drift test keeps them in step)
│   │   ├── common/http.ts                 @UserId(), requireString/Int/Id, PgErrorFilter (23503→400, 23505→409)
│   │   ├── track/track.ts                 track(client, name, ids, props)
│   │   ├── settings.ts                    readSetting<T>(client, key)
│   │   ├── hold-window.ts                 holdWindowHours(), holdExpiresAt()
│   │   ├── users/users.controller.ts
│   │   ├── activities/activities.controller.ts     + toActivity() mapper
│   │   ├── bookings/{bookings.controller,bookings.service}.ts
│   │   ├── plans/plans.controller.ts
│   │   ├── invites/{invites.controller,invites.service}.ts
│   │   ├── expiry/expiry.service.ts       @Interval(60s): releaseExpiredHolds(), sendHoldWarnings()
│   │   ├── live/{live.service,live.controller}.ts  Redis pub/sub, SSE streams, POST /events
│   │   └── dashboard/{metrics,dashboard.controller}.ts
│   └── test/                              *.spec.ts = unit · *.e2e-spec.ts = against velio_test DB
├── velio_web/src/                         React 19 + Vite
│   ├── App.tsx                            hash routes: #/host · #/book · #/plan/:id
│   ├── api.ts                             api<T>(), ApiError, shared types
│   ├── live.ts                            applyUpdate(), currentSpotsLeft(), useLiveCounts()
│   ├── time.ts                            formatCountdown(), holdProgress(), formatWhen(), useNow()
│   ├── Identity.tsx · useIdentity.ts      identity picker / localStorage
│   ├── HostPage.tsx · BookerPage.tsx · PlanPage.tsx · SpotsLeft.tsx
│   └── logic.test.ts
└── velio_flutter/lib/                     preferred mobile architecture
    ├── main.dart                          ProviderScope, theme, deep-link listener
    ├── core/api/{urls.dart, models/{invite_models,my_activity_model}.dart, clients/{invite_client,activity_client}.dart}
    ├── core/repositories/{invite_repo,activity_repo,request_failure}.dart   Either<RequestFailure, T> via attempt()
    ├── core/view_models/{invite_entry_vm,claim_vm,my_activities_vm}.dart   InviteEntryVM (checks invite, flashbar) → ClaimVM; MyActivitiesVM
    ├── core/services/{navigation_service,storage_service}.dart
    ├── core/providers.dart                inviteRepo, activityRepo, storageService, navigationService (+ selected tab), inviteEntryVM, myActivitiesVM, claimVM
    ├── core/constants/velio_theme.dart    VelioTokens (mirrors web CSS tokens) + velioTheme()
    ├── widgets/{surfaces,busy_button,skeleton}.dart   PageHeader, Panel, VelioBadge, Notice; BusyButton; Skeleton
    ├── utils/{sse,invite_token,format_when}.dart      sseData(), inviteToken(), formatWhen()
    └── views/{controller/controller_screen.dart (tabs), home/home_screen.dart, home/widget/flash_bar.dart, my_activities/my_activities_screen.dart, claim/claim_screen.dart, claim/widget/*}
```

---

## 5. Tasks (as built)

Each task lists the files it owns, what it gives later tasks, and the test that proves it's done. Estimates are the original budget.

### M1 — Backend core (est. 14h)

#### Task 1: Infra + schema (3.5h)
**Files:** `docker-compose.yml`, `migrations/001_init.sql`, `src/db/*` · **Test:** `test/schema.e2e-spec.ts`
**Produces:** `DbService.tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>`; `migrate(url?)`; tables `users, activities, plans, spots, invites, settings, events`.
- [x] `CHECK (spots_left >= 0 AND spots_left <= capacity)`, `activities.version`
- [x] `spots.status ∈ booker|held|claimed|released`; `one_spot_per_user_per_activity`; `one_public_invite_per_plan`
- [x] `users.phone UNIQUE`, `users.email UNIQUE`; `settings.new_user_cap = 2`
- [x] **Done:** a negative or over-capacity count is rejected; `tx()` rolls back on throw. Tests run against a recreated `velio_test` database.

#### Task 2: Users, activities, tracking (1.5h)
**Files:** `src/users/*`, `src/activities/*`, `src/track/track.ts`, `src/common/http.ts` · **Test:** `test/users-activities.e2e-spec.ts`
**Produces:** `POST /users`, `GET /users`, `POST /activities`, `GET /activities`, `GET /activities/:id/availability`, `toActivity(row)`, `track()`, `@UserId()`, `PgErrorFilter`.
- [x] **Done:** the same phone with a new email → same `id` (200); `+` aliases → 400; an unknown `X-User-Id` → 400, not 500.

#### Task 3: Hold window (0.5h)
**Files:** `src/hold-window.ts` · **Test:** `test/hold-window.spec.ts`
**Produces:** `holdWindowHours(activityAt: Date, bookedAt: Date): number`, `holdExpiresAt(activityAt, bookedAt): Date`.
- [x] **Done:** 6h out → 2 · 24h → 8 · 71h → 23.67 · 216h → 72 · 300h → 72 · 30 min → 0.17 · seconds ignored · already started → 0.

#### Task 4: Bookings (2.5h)
**Files:** `src/bookings/*`, `src/settings.ts` · **Test:** `test/bookings.e2e-spec.ts`
**Consumes:** `tx`, `holdExpiresAt`, `readSetting`, `track` · **Produces:** `BookingsService.book(bookerId, activityId, heldSpots)`.
- [x] **Done:** over the cap → 422 `{cap}`; 1 left and 3 requested → 409 `{race_lost, available: 1}` with nothing changed; changing the cap in `settings` takes effect on the next booking; `booking_created` and `booking_failed` events are written.

#### Task 5: Invites + claims (4h)
**Files:** `src/invites/*` · **Test:** `test/invites.e2e-spec.ts`
**Produces:** `InvitesService.create / open / claim`; `UNBOUND_HELD_SPOT` query (`FOR UPDATE SKIP LOCKED`).
- [x] **Done:** each vouch link ties its own held spot; one public link per plan; the vouch path; the public path (untied held spot → open spot); released vouch → open spot with vouch credit; released vouch with no spots → `race_lost`; `used`; `duplicate`; can't claim your own invite; `isNewUser` correct.

#### Task 6: Expiry job + concurrency proof (2h)
**Files:** `src/expiry/expiry.service.ts` · **Tests:** `test/expiry.e2e-spec.ts`, `test/concurrency.e2e-spec.ts`
**Produces:** `releaseExpiredHolds(now?) → activityIds[]`, `sendHoldWarnings(now?)`, run every 60s; activity rows are locked in ID order so overlapping runs can't deadlock.
- [x] **Done:** 50 parallel claims on 1 spot → exactly 1 winner and 49 `race_lost`; 50 bookings on 10 spots → exactly 10; release is idempotent and leaves claimed spots alone; warnings fire once at 50% and once at 90%.

### M2 — Live availability (est. 4h)

#### Task 7: Publish + SSE (4h)
**Files:** `src/live/*`, plus publish calls in `bookings.service.ts`, `invites.service.ts` and `expiry.service.ts` · **Test:** `test/live.e2e-spec.ts`
**Produces:** `LiveService.publish(activityId, spotsLeft, version)`, `.updatesFor(id)`, `.allUpdates()`; `GET /activities/:id/stream`, `GET /activities/stream`; `POST /events`.
- [x] **Done:** snapshot, then an update in under 2s; a booking on instance A reaches a client on instance B through Redis; open-spot claims and expiry releases publish; held-spot claims don't (the count didn't change); latency is corrected for a client clock that's a minute fast.

### M3 — React web: host + booker (est. 9h)

#### Task 8: Shell, identity, live counts (1.5h) — *includes added server reads*
**Files:** `App.tsx`, `api.ts`, `live.ts`, `time.ts`, `Identity.tsx`, `useIdentity.ts`; server `src/plans/plans.controller.ts` · **Tests:** `src/logic.test.ts`, `test/plans.e2e-spec.ts`
**Produces:** `useLiveCounts(userId) → {counts, seed, resyncKey}`, `applyUpdate(counts, update)`, `currentSpotsLeft(activity, counts)`; `GET /plans`, `GET /plans/:id`.
- [x] **Done:** stale and duplicate versions are dropped; plan detail is visible only to its booker.

#### Task 9: Host page (2h)
- [x] Create an activity; list your activities with live "N of M left".

#### Task 10: Booker page (2.5h)
- [x] Book with 0–5 friends; 422 → explains the cap; 409 `race_lost` → "Only N left. Book N?" (never books fewer without asking) or "Just sold out"; 409 duplicate → "already booked"; your plans list.

#### Task 11: Plan page (3h)
- [x] Hold countdown with a progress bar; 50%/90% warning banners; members with vouch badges; labelled vouch links and the public link with Copy.
- [x] **Done (headless Chrome):** a booking showed up in another tab after 75 ms; the countdown read `8h 38m` for an activity 26h away; a vouched guest appeared via polling; the partial-booking prompt works; no horizontal scroll at 375px; no console errors.

### M4 — Flutter: guest claim (est. 6h)

#### Task 12: Deep link + claim screen (4h)
**Files:** `lib/main.dart`, `core/**`, `views/**`, `utils/invite_token.dart`; iOS `Info.plist` (`CFBundleURLTypes` velio, `NSAllowsLocalNetworking`), Android manifests (`velio://invite` intent filter, `INTERNET`, cleartext in debug only), macOS `network.client` entitlement · **Tests:** `deep_link_test.dart`, `invite_entry_vm_test.dart`, `home_screen_test.dart`, `claim_vm_test.dart`, `claim_screen_test.dart`
**Produces:** `InviteEntryVM.open(token) / bounce(message) / dismissFlash()` (the invite page; `FlashBar` dismisses itself after 2s); `ClaimVM.start(token, invite) / claim(name, phone, email) / resume()`, `ClaimStatus {loading, ready, claiming, claimed, soldOut}`.
- [x] **Done:** "X vouched for you" vs "X invited you"; form validation; claimed, sold-out, duplicate and released-vouch-fallback messages; the identity is created once and reused.
- [x] **Added 2026-10-08:** a "My activities" tab (`GET /users/me/activities`), checked on the iOS simulator with real data. Tests: `users-activities.e2e-spec.ts`, `my_activities_test.dart`, `live_backend_test.dart`.
- [x] **Changed 2026-10-08:** used vouch links and unknown invites show a flashbar on the "Got an invite?" page instead of the claim page, including a vouch used up mid-claim (checked on the iOS simulator).

#### Task 13: Live count in Flutter (2h)
**Files:** `lib/utils/sse.dart`, `InviteClient.availability()` · **Tests:** `sse_test.dart`, `live_backend_test.dart`
- [x] SSE parser handles split chunks, pings, CRLF and `Uint8List` input; the view model keeps only newer versions, reconnects after 2s, resyncs when the app resumes, and reports latency.
- [x] **Done:** against the real server, another booking reached the guest's screen in under 2s, and the claim succeeded from the held spot.

### M5 — Tracking dashboard (est. 4h)

#### Task 14: Dashboard + settings (4h)
**Files:** `src/dashboard/*` · **Test:** `test/dashboard.e2e-spec.ts`
**Produces:** `computeMetrics(db, since?) → Metrics`; `GET /dashboard`, `GET /dashboard/metrics`, `POST /settings`.
- [x] **Done:** a known scenario gives exact numbers (success 100%, p95 1905 ms over 20 samples, invite rate 50%, claim rate vouch 100% / public 50%, K-factor 1.0 = 0.5 + 0.5, plans that happened 1 of 2, oversold 0, drift 0); the cap form saves and redirects; light and dark mode render, with no overflow at 390px.

### Buffer (est. 3h) — used for
Debugging three real defects that tests caught: Dio's `Uint8List` stream, test migrations hitting the dev database, and the snapshot/subscribe gap. Also the iOS and macOS builds, the headless-Chrome runs, and this document.

---

## 6. ⚠️ Stubbed (minimal version in this build)

| Item | In this build | Why stubbed | Full version |
| --- | --- | --- | --- |
| 50/90% hold warnings | `hold_warning_sent` event + countdown banners; **no email** | An email provider takes setup time; the event already proves the timing | Email now; push once bookers have a native app |
| Seat cap | One editable `new_user_cap` for everyone | Fill-rate formula and restore rule are undefined | Per-user cap from fill history |
| Identity | Unverified; phone and email each unique | Verification deferred by product decision | Phone one-time code; Gmail-dot and E.164 cleanup |
| Deep links | `velio://` custom scheme | Universal / App Links need a hosted domain and signed association files | Universal Links + App Links |
| Plan membership | Polled every 5s | Only counts need to be live | Push membership over the plan's stream |
| Dashboard access | **No auth** (code comment in `dashboard.controller.ts`) | Auth is out of scope | Admin auth before deploying anywhere |

## 7. ❌ Not in the cut

| Item | Reason (concise) |
| --- | --- |
| Guest without the app installed | Assumed out (invitees have the app). **High risk:** K-factor stays ≈ 0 under this assumption. Cheapest fix: a React claim page (~4h). |
| Cancellations (guest, booker, cascade to the plan) | Rules are decided, but the cascading spot returns, solo-booking survival and the "plan cancelled" page add ~6h the budget didn't have. |
| Host capacity change | Depends on cancellation and bumping rules; it's blocked by design, so users lose nothing yet. |
| Fill-rate-based cap | Formula and "consistently filled" restore rule are undefined; can't be built without guessing. |
| Waitlist | New feature; no data yet showing sold-out invites cause real drop-off. |
| Email / push delivery | Needs a provider; iOS web push only works for sites added to the Home Screen. |
| OTP verification + normalisation | Product decision deferred; an extra step hurts the 25% claim target. |
| Multi-instance load testing | Redis fan-out is proven across two instances; no traffic to justify more. |
| Payments, full auth, trust scores, host verification | Out of scope in the brief. |

---

## 8. Build order (followed)

1. Tasks 1–6: backend and concurrency proof. *Nothing else matters if zero oversell isn't proven.*
2. Task 7: live availability.
3. Tasks 8–11: React, plus the added read endpoints.
4. Tasks 12–13: Flutter.
5. Task 14: dashboard.

The fallback cut order (dashboard settings form → plan-page polish → Flutter SSE → polling) was never needed.

---

## 9. Verification

| Check | Result |
| --- | --- |
| `velio_server`: `npm test` · `npm run test:e2e` | 10 · 62 passing (repeated runs, no flakes); build and lint clean |
| `velio_web`: `npm test` · `npm run build` · `npm run lint` | 9 passing; clean |
| `velio_flutter`: `flutter analyze` · `flutter test` | No issues; 34 passing, including the real-server test (which also checks that reopening a used vouch link is stopped on the invite page and that the claim shows in "My activities") |
| Platform builds | `flutter build macos --debug` ✅ · `flutter build ios --debug --no-codesign` ✅ |
| Docker stack | `docker compose up -d --build`: all four services healthy; a fresh database is migrated on start; the race demo and the headless-Chrome flow pass against the containers |
| Real server smoke test | `curl -N` stream showed the snapshot and then the post-commit update |
| Browser | Headless Chrome via `playwright-core` (the Claude in Chrome extension wasn't connected): every web flow in Tasks 9–11, light and dark dashboard screenshots |
| iOS simulator (iPhone 16 Pro) | ✅ The vouch invite opened ("Booky vouched for you"); the count went from 3 to 1 live when someone booked through the API; `velio://` links trigger the system "Open in Velio?" prompt as expected |
| Race demo | `scripts/race-demo.sh`: 20 guests → 1 winner / 19 `race_lost`; 50 guests → 1 / 49 |
| Load test (2026-10-08) | `scripts/load-test.mjs`, 100 hosts / 200 bookers / 700 guests, 50 in flight, Docker stack on a laptop: 8,072 requests in 5.9 s (~1,360 req/s); p95 bookings 531 ms, claims 139 ms, live delivery 865 ms; 198 plans, 420 claims (108 vouch, 312 public), 223 public `race_lost` once 40 of 100 activities sold out; **0 oversold, 0 count drift**, and the Postgres row counts match the script's |
| **Not yet verified** | The Flutter UI on a physical device (the wireless iPad needs signing); tapping the claim form on the simulator (covered by widget tests and the live-API test instead) |

---

## 10. Open risks

1. **Guests without the app — HIGH.** K-factor, the core metric, stays near zero if every guest already has the app. See Next step 1.
2. **Dashboard has no auth — HIGH if deployed.** Anyone who can reach it can read metrics and change the cap.
3. **Unverified identity — MEDIUM.** Vouches can be spoofed, and new identities can inflate K-factor and dodge the cap.
4. **Flutter UI on a physical device — LOW.** It renders and updates live on the iOS simulator; only a real-device run is left.
5. **Assumption to confirm:** the new-user cap of 2 excludes the booker's own seat.
6. **Short hold windows:** a booking made 30 minutes before the activity gets a 10-minute window, so the 50% warning comes 5 minutes in.

## 11. Next steps

In priority order. Expand each into a step-level plan before starting.

- [ ] **Web claim fallback (~4h):** a `velio_web` route `#/invite/:token` using the existing `GET /invites/:token` and claim endpoints, linked from the app-store fallback. Fixes risk 1.
- [x] ~~Run the Flutter app on a simulator~~ (done 2026-10-08). Remaining: one physical-device run with `--dart-define=API_URL=http://<lan-ip>:3000`.
- [ ] **Dashboard auth (~1h):** a shared-secret header or basic auth on `/dashboard`, `/dashboard/metrics` and `/settings`. Fixes risk 2.
- [ ] **Confirm the cap assumption** (risk 5); one migration if it changes.
- [ ] **Cancellations (~6h):** the rules are already decided in the session file.

---

## Running locally

```bash
docker compose up -d --build                                             # Postgres, Redis, API :3000 (migrates on start), web :5173
cd velio_flutter && flutter run                                          # guest app (simulator: localhost works)
#   hot-reload dev instead: docker compose up -d postgres redis, then npm run start:dev / npm run dev
#   physical device:  flutter run --dart-define=API_URL=http://<your-lan-ip>:3000
#   Android emulator: flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

- **Dashboard:** http://localhost:3000/dashboard (metrics + the new-user cap). JSON at `/dashboard/metrics`.
- **Open an invite on a device:** `xcrun simctl openurl booted "velio://invite/<token>"` (iOS) or `adb shell am start -d "velio://invite/<token>"` (Android), or paste the link or code on the app's home screen.

| Where | Command | Notes |
| --- | --- | --- |
| `velio_server` | `npm test` · `npm run test:e2e` | e2e needs Docker; recreates a throwaway `velio_test` database; files run one at a time |
| `velio_web` | `npm test` | pure logic (version merge, countdown, progress) |
| `velio_flutter` | `flutter test` | `live_backend_test.dart` runs against a local server and skips itself if none is running |
