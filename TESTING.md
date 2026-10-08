# Testing & demo script

A step-by-step walkthrough of every feature that's built, written to be followed live while presenting. Allow about **25 minutes** for the full run; sections 3–6 are the core story if you have 10.

Each step says **what to do** and **what you should see**. If you don't see it, check [Troubleshooting](#troubleshooting).

---

## 0. Set up (before the audience arrives, ~5 min)

**Prerequisites:** Docker Desktop, Node 24, Flutter 3.44 + Xcode (for the iOS simulator), `jq`.

```bash
# Fresh, empty database (skip `down -v` to keep existing data)
docker compose down -v && docker compose up -d

cd velio_server && npm install && npm run migrate && npm run start:dev   # terminal 1 — API on :3000
cd velio_web && npm install && npm run dev                               # terminal 2 — web on :5173
open -a Simulator                                                        # boot an iPhone simulator
cd velio_flutter && flutter run                                          # terminal 3 — guest app
```

**Windows to arrange on screen:**

| Window | URL / app | Acts as |
| --- | --- | --- |
| A — normal browser window | http://localhost:5173/#/host | **Hana** (host), later **Bo** (booker) |
| B — **private/incognito** window | http://localhost:5173/#/book | **Wes** (a second booker / watcher) |
| C — iPhone simulator | Velio app | invited guests |
| D — browser tab | http://localhost:3000/dashboard | metrics |

> Windows A and B **must** be different browser profiles (normal + private). Tabs in the same profile share the logged-in user.

---

## 1. Identity (role toggle — auth is out of scope)

1. In window A click **New user** → name `Hana`, any phone (e.g. `+15550001`), any email → **Save**.
   ✅ The picker shows `Hana (#1)`.
2. Try **New user** again with the *same phone* and a different email.
   ✅ You're switched back to the same user — phone and email are each unique on their own.
3. Try an email like `hana+test@gmail.com`.
   ✅ Rejected: `"+" aliases are not allowed`.
4. In window B create `Wes`.

## 2. Host creates an activity

1. Window A → **Host** tab → Title `Sunset Kayaking`, Starts = **tomorrow 18:00**, Spots = `5` → **Create**.
   ✅ It appears under "Your activities" as **5 of 5 left**.
2. Window B (Booker tab) shows the activity too, **5 of 5 left**.

## 3. Booking with held spots + live availability *(core)*

1. Window A: create a second user `Bo` (New user) — you're now the booker. Go to **Booker**.
2. On Sunset Kayaking choose **Friends: +2** → **Book 3**.
   ✅ You land on Bo's plan page: "**2 held spots to fill**" and a countdown of **one third of the time until the activity** (e.g. ~8h for an activity 24h away; never more than 72h).
3. **Look at window B without touching it.**
   ✅ It changed from **5 of 5** to **2 of 5 left** within a second — pushed over Server-Sent Events, no refresh.

## 4. The cap and the "only N left" prompt

1. Window B (Wes): choose **Friends: +3** → **Book 4**.
   ✅ "You can hold up to 2 spots for friends." (new-user cap = 2, read from the database).
2. Choose **Friends: +2** → **Book 3** (only 2 are left).
   ✅ A prompt: "**Only 2 left. Book 2 (you + 1)?**" → **OK**. It never books fewer without asking.
   ✅ Wes lands on his plan (1 held spot); window A's activity now says **Sold out**.

## 5. Vouch vs public links

1. Window A (Bo's plan page) → type `Ada` → **Create vouch link**.
   ✅ A **VOUCH · Ada** row with `velio://invite/…` and **Copy**.
2. **Get public link**.
   ✅ A **PUBLIC · Anyone** row. (One public link per plan; the button disappears.)
   **Talking point:** the vouch link reserved one of Bo's held spots for Ada. Bo's *other* held spot stays unbound, so whoever claims the public link first gets it. (Don't make a second vouch link yet; a third would say "Every held spot already has a vouch link.")

## 6. Guest claims on the phone *(core)*

1. Window A → **Copy** the Ada vouch link.
2. Simulator → the Velio home screen → paste into **Invite link or code** (⌘V) → **Open invite**.
   *Alternative:* `xcrun simctl openurl booted "<the copied link>"` and tap **Open** on the iOS prompt.
   *Alternative:* restart with `flutter run --dart-define=INVITE=<link or token>` to open it on launch.
   ✅ "**Bo vouched for you** · Sunset Kayaking · **Sold out** · A spot is being held for you."
   **Talking point:** the activity's open spots are gone, but Ada's spot was held for her at booking time, so she can still claim it.
3. Fill name `Ada`, a phone, an email → **Claim my spot**.
   ✅ "**You're in! See you there.**" (She took the spot held for her, so the count doesn't change.)
4. Window A: within ~5 s Bo's plan shows **Ada · VOUCH** under "Who's going", the vouch row says **claimed**, and "1 held spot to fill".
5. Open the **same vouch link** again in the simulator.
   ✅ "This vouch link has already been used." — vouch links are single-use.
6. Open Bo's **public link** in the simulator and claim.
   ✅ "You already have a spot for this activity." — the app remembers Ada, and one person can't hold two spots.

> To claim as a *different* guest on the same simulator, either run the app on a second simulator (`flutter run -d "iPhone 16 Pro Max"`) or claim via the API:
> ```bash
> API=http://localhost:3000
> G=$(curl -s -X POST $API/users -H 'content-type: application/json' -d '{"name":"Gus","phone":"+15550099","email":"gus@demo.dev"}' | jq -r .id)
> curl -s -X POST $API/invites/<public-token>/claim -H "X-User-Id: $G" | jq     # → source: "held" (Bo's unbound held spot)
> ```

## 7. Zero oversell, live

```bash
cd velio_server && ./scripts/race-demo.sh            # 20 guests hit the last spot at once
GUESTS=50 ./scripts/race-demo.sh
```
✅ `Winners: 1   race_lost: 19   spots left: 0` and "✅ No oversell". Open the dashboard: **Oversold activities 0, count drift 0**.

## 8. Hold windows, warnings and release

Holds last `min(72h, time-to-activity ÷ 3)`. To show it without waiting, fast-forward Wes's plan (find its id in window B's URL, `#/plan/<id>`):

```bash
psql() { docker compose exec -T postgres psql -U velio -d velio -c "$1"; }
psql "UPDATE plans SET created_at = now() - interval '6 hours', hold_expires_at = now() + interval '4 hours' WHERE id = <id>;"   # 60% used
```
✅ Within 5 s window B's hold box turns **amber**: "Halfway through your hold." Within ~60 s a `hold_warning_sent {pct: 50}` event is recorded (the job runs every minute).

```bash
psql "UPDATE plans SET created_at = now() - interval '9 hours 30 minutes', hold_expires_at = now() + interval '30 minutes' WHERE id = <id>;"   # 95%
```
✅ The box turns **red**: "Almost out of time." (`hold_warning_sent {pct: 90}` follows within a minute.)

```bash
psql "UPDATE plans SET hold_expires_at = now() WHERE id = <id>;"   # expire it
```
✅ Within ~60 s the expiry job releases Wes's unfilled held spot: window A goes from **Sold out** to **1 of 5 left** live, and Wes's plan says "Your held spots have been released".

**Released vouch fallback (optional):** create a vouch link on Wes's plan *before* expiring it, expire it, then claim that link as a new guest (second simulator or the API snippet above).
✅ The claim still succeeds from the open pool and the app says "The spot held for you had been released, so we gave you an open spot instead." The claim is still attributed as a **vouch**.

## 9. Tracking dashboard

1. Open http://localhost:3000/dashboard.
   ✅ Tiles for every target: oversold (0), booking success (race-lost excluded), availability p95, invite rate, claim rate **split vouch / public**, K-factor, plans that happened — each marked On target / Off target / No data yet.
2. **Settings → New-user cap** → `3` → **Save**. In window B, book another activity with **+3**.
   ✅ Allowed now — no redeploy. Set it back to `2`.
3. Run the raw queries:
   ```bash
   docker compose exec -T postgres psql -U velio -d velio < velio_server/queries/metrics.sql
   ```
   ✅ The same numbers as the dashboard, plus failures by reason, the per-type invite funnel, and held-spot outcomes.

## 10. Automated tests (show they're green)

```bash
cd velio_server && npm test && npm run test:e2e      # 10 unit + 60 database tests (recreates a velio_test DB)
cd velio_web && npm test                             # 9
cd velio_flutter && flutter test                     # 18 (one runs against the live API, skips if it's down)
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| API won't start: `ECONNREFUSED` (Redis/Postgres) | `docker compose up -d` first — the server needs both. |
| Web shows "Request failed" | API not running on :3000, or set `VITE_API_URL`. |
| Window B shows the same user as A | Use a private window or a different browser for B. |
| Simulator shows a stuck "Open in Velio?" dialog | Tap **Open**; if it persists, restart the simulator (`xcrun simctl shutdown all`). |
| Phone app can't reach the API on a **physical** device | `flutter run --dart-define=API_URL=http://<your-mac-lan-ip>:3000` |
| Android emulator | `--dart-define=API_URL=http://10.0.2.2:3000` |
| Counts look stale after the laptop slept | They resync automatically on reconnect / tab focus; a refresh also works. |
| Start over with clean data | `docker compose down -v && docker compose up -d && (cd velio_server && npm run migrate)` |
