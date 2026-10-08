# Velio — group bookings with live availability and viral invites

A host creates an **Activity** with limited spots. A **booker** books their own spot plus **held spots** for friends, which forms a **Plan**. They share **vouch links** ("I stand behind this person": one per friend, single-use) or a **public link**. **Guests** claim from their phone. Everyone sees availability change live, and an activity can never be oversold.

| Folder | What | Stack |
| --- | --- | --- |
| `velio_server/` | API, live updates, hold-expiry job, metrics dashboard | NestJS 12 (ESM) · Postgres 16 · Redis 7 |
| `velio_web/` | Host + booker app | React 19 + Vite |
| `velio_flutter/` | Invited-guest app | Flutter 3.44 · Riverpod · Dio |
| `docker-compose.yml` | Runs Postgres, Redis, the API and the web app together | Docker Compose |

**Status:** all 14 planned tasks are built. 116 automated tests pass (server 10 unit + 62 database, web 13, Flutter 31), and the flows were also run in headless Chrome, on an iOS simulator, and against the Docker stack.

**More docs:**
- [`PLANS.md`](PLANS.md): the plan and what was built.
- [`TESTING.md`](TESTING.md): step-by-step demo script.
- [`OWNERSHIP.md`](OWNERSHIP.md): diagnosing and improving the invite funnel.
- `grill-me-sessions/velioapp.grill.md`: the product decisions behind it.

---

## 1. Quick start

**Prerequisites:** Docker Desktop · Flutter 3.44 with Xcode (iOS simulator) or Android Studio · `jq` (only for the demo scripts). Node 24 is only needed to run the tests or the hot-reload dev setup.

```bash
# 1–3. Database, cache, backend and web — one command
docker compose up -d --build
#   postgres :5432 (velio/velio) · redis :6379
#   server   http://localhost:3000   (runs pending migrations on start; dashboard at /dashboard)
#   web      http://localhost:5173   (host + booker app)

# 4. Mobile (guest)
cd velio_flutter
flutter pub get
flutter run                                # pick the iOS simulator; localhost works there
```

The first build takes a minute or two. Check it's up with `docker compose ps` (four services, `running`), then open http://localhost:5173.

| Task | Command |
| --- | --- |
| Rebuild after code changes | `docker compose up -d --build` |
| Follow the API logs | `docker compose logs -f server` |
| Stop (keep data) | `docker compose down` |
| Stop and wipe the database | `docker compose down -v` |

**Hot-reload development (optional).** Start only the data stores, then run the apps with npm. Don't run both setups at once, because they use the same ports.

```bash
docker compose up -d postgres redis
cd velio_server && npm install && npm run migrate && npm run start:dev   # :3000, restarts on save
cd velio_web && npm install && npm run dev                               # :5173, hot reload
```

| Running on | Command |
| --- | --- |
| iOS simulator / macOS | `flutter run` |
| Android emulator | `flutter run --dart-define=API_URL=http://10.0.2.2:3000` |
| Physical phone | `flutter run --dart-define=API_URL=http://<your-mac-lan-ip>:3000` |
| Open an invite on launch (demo) | `flutter run --dart-define=INVITE=<velio://invite/… or token>` |

**Try it:** in the web app create a user, then switch to **Host** and create an activity. Switch to **Booker** (use a private window for a second user), book with **+2 friends**, then create a vouch link and copy it. Paste the link into the phone app's home screen and claim. Watch the counts change in every window. [`TESTING.md`](TESTING.md) has the full 25-minute script.

**Tests:**

```bash
cd velio_server && npm test && npm run test:e2e   # 10 unit + 62 against a throwaway velio_test DB (needs Postgres up)
cd velio_web && npm test                          # 13
cd velio_flutter && flutter test                  # 31 (one hits the live API; skips if it's down)
cd velio_server && ./scripts/race-demo.sh         # live oversell race: 20 guests, 1 last spot
cd velio_server && node scripts/load-test.mjs     # 100 hosts, 200 bookers, 700 guests through the API; real data stays in the DB
```

Defaults suit the npm dev setup; `docker-compose.yml` sets the container values (e.g. `DATABASE_URL` points at the `postgres` service).

| Env var | Default | Used by |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://velio:velio@localhost:5432/velio` | server |
| `REDIS_URL` | `redis://localhost:6379` | server |
| `PORT` | `3000` | server |
| `VITE_API_URL` | `http://localhost:3000` | web (baked in at build time; in Docker it's the `web` build arg in `docker-compose.yml`) |
| `API_URL` / `INVITE` (`--dart-define`) | `http://localhost:3000` / — | Flutter |

---

## 2. Architecture and decisions

```
  React (host, booker)          Flutter (guest)
        │  ▲                        │  ▲
   HTTP │  │ SSE                HTTP │  │ SSE
        ▼  │                        ▼  │
   ┌───────────────── velio_server (NestJS, N instances) ─────────────────┐
   │ controllers → services ──tx──► Postgres (the only source of truth)  │
   │                    │ after commit                                    │
   │                    └─► Redis PUBLISH activity:<id> ──► every instance│
   │                                (PSUBSCRIBE)        ──► its SSE clients│
   │ expiry job (every 60s) · events table · /dashboard                    │
   └───────────────────────────────────────────────────────────────────────┘
```

**How it runs.** `docker compose up` starts four containers:

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `postgres` | `postgres:16` | 5432 | Data in the `pgdata` volume; health check `pg_isready` |
| `redis` | `redis:7` | 6379 | Pub/sub only, no data kept; health check `redis-cli ping` |
| `server` | built from `velio_server/Dockerfile` | 3000 | Two-stage build; starts only once both stores are healthy; runs pending migrations, then the API |
| `web` | built from `velio_web/Dockerfile` | 5173 → 80 | Vite production build served by nginx |

The Flutter app runs outside Docker (simulator or phone) and talks to the API on port 3000.

**Domain.**
- An `activity` has `capacity`, `spots_left` and a `version`.
- A `plan` is one booker's group, with `hold_expires_at`.
- Each `spot` is `booker`, `held`, `claimed` or `released`.
- An `invite` is `vouch` (tied to one held spot, single-use) or `public` (one per plan, reusable).
- `events` is append-only tracking; `settings` holds runtime config (`new_user_cap`).

**Key decisions** (from the product session):

| Decision | Choice | Why |
| --- | --- | --- |
| When do friends' spots leave availability? | **At booking** (held spots), released after `min(72h, time-to-activity ÷ 3)` | A vouched guest is guaranteed a spot; the window shrinks for near-term activities and always leaves ⅔ of the lead time to rebook |
| Vouch vs share | Booker picks a **vouch link per friend** or **one public link** | A shared vouch link can't say *who* was vouched for, and anyone could forward it |
| Public claims | Untied held spot → open spot | Vouches stay protected, and a booker who only shares publicly still fills their holds |
| Clients | React for hosts and bookers, Flutter for guests | Product call; guests are assumed to have the app (see risks) |
| Abuse | New-user cap of 2 held spots, editable without a deploy | Hold hoarding is the main way to hurt hosts |

### How concurrency is solved

There are no application locks and no Redis counters. The database decides.

1. **One transaction per spot change.** Booking, tying a spot to a vouch link, claiming, the released-vouch fallback and the expiry release each run inside `DbService.tx()`.
2. **The guard is a conditional decrement:**
   ```sql
   UPDATE activities SET spots_left = spots_left - $n, version = version + 1
   WHERE id = $1 AND spots_left >= $n AND starts_at > now() RETURNING spots_left, version
   ```
   Postgres takes the row lock, so concurrent requests queue on it, and each re-checks `spots_left` after the lock is released. Zero rows back means `409 {reason: 'race_lost', available}`.
3. **Backstops in the schema:** `CHECK (spots_left >= 0 AND spots_left <= capacity)`, and a unique index meaning one person can hold one spot per activity (no double-claiming via vouch + public).
4. **Held spots are rows**, locked with `FOR UPDATE` (vouch) or `FOR UPDATE SKIP LOCKED` (public: two guests racing for held spots each get a different one instead of waiting). The expiry job's `UPDATE … WHERE status = 'held'` re-checks after any lock, so a claim and a release on the same spot can't both win. The job updates activity rows in ID order so overlapping runs can't deadlock.
5. **Events are written in the same transaction** as the change they describe, so the metrics can't disagree with the data.
6. **Proof:** `test/concurrency.e2e-spec.ts` (50 claims on 1 spot → 1 winner, 49 `race_lost`; 50 bookings on 10 spots → exactly 10) and `scripts/race-demo.sh`. The dashboard's **count drift** check (`capacity − spots_left` must equal the number of non-released spots) catches any bookkeeping bug.

### How real-time events propagate

1. A transaction commits.
2. The service calls `LiveService.publish(activityId, spotsLeft, version)`, which `PUBLISH`es `{activityId, spotsLeft, version, committedAt}` on `activity:<id>`. This happens **after** commit, so clients never see a count that gets rolled back.
3. Every server instance holds one Redis `PSUBSCRIBE activity:*` connection and pushes each message into an in-process RxJS stream.
4. SSE endpoints filter that stream:
   - `GET /activities/:id/stream` (one activity): sends a **snapshot** from Postgres, then updates. It subscribes *before* reading the snapshot, so no commit can slip into the gap.
   - `GET /activities/stream` (all activities): list pages use one connection, because browsers allow only 6 per host on HTTP/1.1.
   - Both send a `ping` every 25s to keep proxies and mobile networks from closing idle connections.
5. Clients keep the **highest `version`** per activity, so duplicate or out-of-order messages are harmless.
6. **Resync:** web pages reload data when the stream reconnects or the tab regains focus. Flutter reconnects after 2s and on app resume, and each reconnect begins with a fresh snapshot.
7. **Latency is measured end to end:** clients report `availability_received`, and the server computes `latencyMs` from `committedAt`, correcting for the phone's clock drift. That's how the p95 ≤ 2s target is tracked. Locally it's about 5–75 ms.

**Why SSE and not WebSockets:** updates only flow from server to client, while writes are ordinary HTTP. SSE gets automatic reconnects from `EventSource`, works through HTTP/2 and proxies, and needs no protocol of its own.

---

## 3. Plan vs. reality

[`PLANS.md` §2](PLANS.md#2-changes-from-the-original-plan) lists every change with its reason. The significant ones:

| Planned | Built | Why |
| --- | --- | --- |
| Fastify | **NestJS 12 (ESM)** | Chosen at kickoff |
| One SSE stream per activity | **+ an all-activities stream** | Browsers allow only 6 connections per host on HTTP/1.1; list pages need one connection |
| Snapshot, then updates | **Subscribe, then snapshot** | Closes a gap where a commit could be missed |
| Claim failure `sold_out` | **`race_lost` everywhere**, plus `duplicate` and `no_held_spot` | One reason for "no spot at commit" keeps the 99.5% calculation clean |
| Flutter sends `invite_opened` | **The server records it** on `GET /invites/:token` | More reliable; clients can't forge business events (`POST /events` accepts only latency reports) |
| Read endpoints not planned | `GET /activities`, `/plans`, `/plans/:id`, `/users` | The web pages needed them |
| Flutter: 3 files with `http` | **The team's preferred mobile architecture** (view → view model → repository → Dio client), plus a paste-a-code home screen, a **My activities** tab (`GET /users/me/activities`), a top flashbar for used invites, and a `--dart-define=INVITE` launch shortcut | Team house style; the scope says guests arrive "by link **or code**" |
| Dashboard: HTML only | + JSON, a **count-drift** check, and `queries/metrics.sql` | Scriptable, and catches bookkeeping bugs the oversell check can't |
| Not planned | `scripts/race-demo.sh` | Shows zero oversell live |
| Not planned | `scripts/load-test.mjs` (1,000 users through the real API) | Real volume in the database and dashboard; checks integrity under concurrency |
| Docker only for Postgres + Redis; API and web run with npm | **`docker compose up -d --build` runs the whole stack** (npm kept for hot reload) | One command to start everything for reviewers and demos |

Nothing in the cut was dropped. All 14 planned tasks shipped.

---

## 4. Trade-offs

### What I prioritized in the 48 hours (40h build budget)

1. **Correct counts first.** Zero oversell is the one target that can't be fixed after launch, so the transactional core and its concurrency tests came before any UI.
2. **Measurability second.** Every target has an event and a query, so the product targets can be argued with data rather than guesses.
3. **Product breadth third:** the whole loop (host → booker → vouch/public → guest claim → live counts) end to end, over polishing any one screen.
4. **Tests before code throughout:** 116 automated tests in total, plus headless-browser and iOS-simulator runs.

### Shortcuts taken (on purpose)

| Shortcut | Effect | Fix |
| --- | --- | --- |
| No auth; the `X-User-Id` header is the identity | Anyone can act as anyone | Real sessions (OTP login) |
| Unverified phone/email | Vouches can be spoofed; K-factor can be inflated | Phone one-time code |
| **Dashboard and `/settings` are open** | Anyone who can reach it can change the cap | Admin auth (first thing before deploying) |
| Guests assumed to have the app | First-time guests are lost; K-factor ≈ 0 by design | Web claim page (~4h; see OWNERSHIP.md) |
| `velio://` custom scheme | Not tappable in some apps; no link preview | Universal / App Links |
| Hold warnings are only events + UI | Bookers aren't actually notified | Email / push |
| One cap for everyone | No reward for reliable bookers | Fill-rate-based cap |
| Plan membership polled every 5s | Up to 5s stale (counts themselves are live) | Push membership over SSE |
| Cancellations / capacity edits not built | Rules decided, not implemented | ~6h, rules in the session file |
| Hand-written SQL migrations, no ORM | No rollbacks | A migration tool |
| Web API URL baked in at image build time | Pointing the web app at another API means rebuilding | Serve a runtime `config.js`, or put the API behind the same origin |
| Credentials in `docker-compose.yml`, no TLS | Fine locally, not elsewhere | Secrets manager; TLS at the load balancer |
| Publish-after-commit isn't guaranteed | If the process dies between commit and publish, live clients miss one update until they resync | Transactional outbox or `LISTEN/NOTIFY` |

### Taking it to production

1. **Security:** real auth, admin-only dashboard and settings, rate limits on claim and user creation, verified identity.
2. **Delivery guarantees:** a transactional outbox (or Postgres `LISTEN/NOTIFY`) feeding Redis, so every commit is published at least once.
3. **Scale:**
   - Stateless API instances behind a load balancer with HTTP/2 (SSE needs no sticky sessions; Redis fans out).
   - Per-activity Redis subscriptions or sharded channels if traffic grows.
   - Postgres connection pooling (PgBouncer).
4. **Data:**
   - Partition `events` by month, or stream it to a warehouse (the schema is already analytics-friendly).
   - Add an `arm` property for experiments (see OWNERSHIP.md).
5. **Jobs:** the expiry job is idempotent and lock-safe, so it can run on every instance. For efficiency, add a leader lock or move it to a scheduled worker.
6. **Operations:**
   - The server and web images already exist. Push them to a registry and deploy them to an orchestrator (ECS, Cloud Run, Kubernetes) with managed Postgres and Redis.
   - Add an HTTP health endpoint for the API (Compose only checks the data stores today).
   - Structured logs, latency and error alerts (the p95 query already exists), CI that runs all three test suites and builds the images, and database backups.
7. **Product:** Universal Links with rich previews, the web claim fallback, real notifications, and cancellations.

---

## 5. Where to see the tracking

**Dashboard:** http://localhost:3000/dashboard. One tile per target, each marked on or off target, plus the editable new-user cap.

**JSON:** `curl -s localhost:3000/dashboard/metrics | jq`

**Run the queries yourself.** `velio_server/queries/metrics.sql` uses the same definitions as the dashboard, plus extra breakdowns (failures by reason, the invite funnel by type, held-spot outcomes, event volume):

```bash
docker compose exec -T postgres psql -U velio -d velio < velio_server/queries/metrics.sql
docker compose exec -T postgres psql -U velio -d velio -v since="'2026-10-08'" < velio_server/queries/metrics.sql   # a window
docker compose exec postgres psql -U velio -d velio                                                                    # ad-hoc
```

**The `events` table:** `id, name, user_id, activity_id, plan_id, props jsonb, created_at`.

| Event | Written when | Key `props` |
| --- | --- | --- |
| `activity_created` | Host creates an activity | `capacity`, `startsAt` |
| `booking_created` | Booking commits | `spotsHeld`, `holdExpiresAt` |
| `booking_failed` | Booking or claim loses / errors | `reason` (`race_lost` excluded from success %, `error`), `via: 'claim'`, `requested`, `available` |
| `invite_created` | Booker creates a link | `inviteType` (vouch / public), `inviteId` |
| `invite_opened` | Guest app loads an invite | `inviteType`, `inviteId` (deduplicated per person per link in metrics) |
| `spot_claimed` | Claim commits | `inviteType`, `inviteId`, `inviterId`, `isNewUser`, `source` (held / open) |
| `hold_warning_sent` | 50% / 90% of the window used | `pct`, `heldSpotsLeft` |
| `hold_released` | Expiry job frees unfilled holds | `spotsReleased` |
| `availability_received` | A client receives a live update | `latencyMs` (drift-corrected), `version` |

Example ad-hoc query, time from invite to claim:

```sql
SELECT c.props->>'inviteType' AS type,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY c.created_at - i.created_at) AS median_time_to_claim
FROM events c
JOIN events i ON i.name = 'invite_created' AND i.props->>'inviteId' = c.props->>'inviteId'
WHERE c.name = 'spot_claimed'
GROUP BY 1;
```
