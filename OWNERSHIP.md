# Ownership: the invite funnel is missing its target

**Situation.** Group bookings shipped. The technical targets hold (0 oversold, booking success ≥ 99.5%, p95 ≤ 2s), but the growth loop is underperforming: fewer than **30%** of bookers invite, and/or fewer than **25%** of opened invites end in a claimed spot. K-factor and "plans that actually happen" are Velio's core metrics, so this is the part that matters.

The funnel, as the build records it:

```
booking_created ──► invite_created ──► (link shared — not tracked) ──► invite_opened ──► spot_claimed ──► plan happened
   bookers           30% target            ⚠ blind spot                 25% target                       core metric
```

---

## 1. Diagnose

### What I'd look at first

The goal is to find **which step** loses people, and **for whom**, before guessing why. Everything below comes from the `events`, `spots` and `plans` tables (`velio_server/queries/metrics.sql` sections 4, 5, 8 and 9 already cover most of it).

1. **The funnel by step, split by `inviteType` (vouch vs public).** A blended claim rate hides the real story: vouch should convert far higher than public. If vouch is healthy and public isn't, the problem is narrow.
2. **Where each step's losers end up:**
   - **Bookers who never invite:** do they hold 0 spots? Did they create a link and never come back? (`booking_created.props.spotsHeld` against `invite_created`.)
   - **Opens with no claim:** did they hit `booking_failed` (`race_lost` via claim), a used link, or nothing at all (they just left)?
   - **Held spots** that ended up `released` versus `claimed` (section 8). A high release rate means links aren't reaching friends in time.
3. **Time between steps:** `invite_created → invite_opened → spot_claimed`, and the **hold window length** at booking (`holdExpiresAt − created_at`). Short windows for next-day activities may expire before friends see the link.
4. **Segments:** how far ahead the activity is (same-day / next-day / >3 days), activity size, new vs returning guests (`isNewUser`), and how many invites each booker sends.
5. **Qualitative:** watch 10 session replays or run 5 guest interviews on the claim screen. Numbers say where people drop; people say why.

### Blind spots to fix before trusting any of this

The current tracking **cannot see** some of the most likely failure points:

| Gap | Why it matters |
| --- | --- |
| **No "link shared" event**; we only know a link was *created* | Can't tell "never sent" from "sent but ignored". |
| **Opens are only counted inside the app** | A guest without the app never produces `invite_opened`, so the biggest likely drop-off is invisible *and* inflates the measured claim rate. |
| **No claim-form events** (started / submitted / failed validation) | Can't separate "not interested" from "gave up on the form". |
| **No platform or entry-point properties** (iOS / Android, deep link vs pasted code) | Can't spot one broken platform. |

### Top hypotheses (ranked by likelihood × impact)

| # | Hypothesis | What would confirm it |
| --- | --- | --- |
| H1 | **Guests without the app are lost before we can see them.** The build assumes the app is installed; the scope says guests arrive "often for the first time". | Few `invite_opened` per `invite_created` (especially public); new-user share of opens near zero; once a web-landing event exists, its views far exceed app opens. |
| H2 | **Links never leave the booker's screen.** The booker is on desktop web, and copying a `velio://` link then moving it to a phone is awkward. | Many `invite_created` with no `invite_opened` at all; a low share of bookers on mobile web. |
| H3 | **The spot is gone when the guest arrives.** Short hold windows (a next-day activity gets ~8h, a same-day one minutes) and sold-out activities. | `booking_failed{via: claim, reason: race_lost}` and released vouch spots concentrated in short-lead activities. |
| H4 | **The claim form costs too much.** Three fields, typed on a phone, for a first-timer. | High open → no-claim with no failure event; drop-off highest for new users. |
| H5 | **There's no reason to trust a public link.** It shows the inviter but not who else is going, the price, or the location. | Public claim rate far below vouch, even with spots available. |
| H6 | **Bookers don't think of inviting.** They booked alone, or the invite step isn't prominent right after booking. | Low invite rate even among bookers who held spots, or held spots ≈ 0. |

---

## 2. Improve

Ranked by **expected impact ÷ effort**. Effort is relative to this codebase (S ≈ ≤ 1 day, M ≈ 2–4 days, L ≈ 1–2 weeks).

| Rank | Change | Type | Impact | Effort | Why / hypothesis |
| --- | --- | --- | --- | --- | --- |
| 1 | **Close the tracking gaps:** `invite_shared` (copy / share tapped), `claim_form_started`, `claim_form_error`, plus `platform` and `entry` (deep link / code / web) on every event | Tracking | Unblocks everything | S | You can't fix what you can't see; makes H1, H2 and H4 testable |
| 2 | **Web claim page for guests without the app:** `velio_web/#/invite/:token` using the existing `GET /invites/:token` and claim API, then nudge to install | Product + tech | **High** | M (~4h) | H1. Also turns invisible drop-off into measurable opens. *Note:* this deliberately revisits the "guests have the app" assumption from the session |
| 3 | **Native share instead of copy:** Web Share API / SMS link on the plan page; offer it automatically right after booking | Product | High | S | H2, H6. One tap from booking to the friend's chat |
| 4 | **Universal Links (`https://velio.app/i/<token>`)** with a rich link preview (activity, inviter, spots left) | Tech | High | M | H1, H2, H5. Custom-scheme `velio://` links aren't tappable in many chat apps and show no preview |
| 5 | **One-field claim:** phone only (email later); skip the form entirely for known users | Product | Med–High | S | H4. The app already remembers the user ID; drop email from the first claim |
| 6 | **Social proof on the claim screen:** who's going, spots held for "your group", price and location | Product | Med | S | H5. The plan endpoint already has the members |
| 7 | **Hold policy tuning:** a minimum window (e.g. 30 min); extend a vouch hold by N minutes when its link is opened | Product + tech | Med | S–M | H3. The window formula already lives in `hold-window.ts`; the extension is one update in the open handler |
| 8 | **Actually send the 50% / 90% reminders** (email now, push once there's a native booker app) | Tech | Med | M | H2, H3. Today they're only an event and a banner the booker has to be looking at |
| 9 | **Waitlist on sold-out invites** | Product | Low–Med | M | H3 tail. Only worth it if `race_lost` via claim turns out to be large |
| 10 | **Phone verification (one-time code)** | Tech | Neutral for conversion, **high for data trust** | M | Not a conversion lever; it protects K-factor and vouch attribution from fake identities. Ship it with rank 5 so it adds no fields |

**Order of work:** 1 → 2 + 3 (in parallel) → 5 → 4 → 6 → 7. Ranks 8–10 depend on what the new data shows.

---

## 3. Prove it

### Metrics

- **Primary:** claims ÷ **unique link reaches**, with web landing views and app opens both counted as reaches once rank 1 and 2 ship. Reported separately for vouch and public. *(Note that the denominator changes when the web page launches; compare arms on the same definition, never against old dashboards.)*
- **Secondary:** invite rate (bookers with ≥1 shared link), K-factor, time to claim.
- **Guardrails (must not get worse):**
  - oversold = 0 and count drift = 0;
  - booking success ≥ 99.5%;
  - p95 ≤ 2s;
  - held-spot release rate (more holds and no fills means phantom-full activities for hosts);
  - plans that actually happen;
  - host fill rate (activity spots taken by start time).

### Holdout design

- **Randomize by booker, not by guest.** Invites spread through a booker's network; if guests were split, two guests of the same plan could see different flows and contaminate each other. Hash the `booker_id` into arms, so every invite from a booker shares one experience.
- **Arms:** control (current) vs treatment. Keep a persistent **10% global holdout** that gets none of the growth changes, to measure their combined long-run effect on K-factor and plans that happen.
- **Record the arm** on `booking_created`, `invite_*` and `spot_claimed` (`props.arm`), so every metric in `metrics.sql` can be split by arm with one `GROUP BY`.
- **Sample size (rough):** going from 20% to 25% claim rate (two-sided α = 0.05, power 0.8) needs ≈ **1,100 reaches per arm**. Clustering by booker inflates that by the design effect `1 + (m − 1)·ρ` (m = reaches per booker, ρ = within-booker correlation); with m ≈ 3 and ρ ≈ 0.2 that's ×1.4, so about **1,550 per arm**.
- **Duration:** fixed in advance, at least **two full weeks** to cover weekday and weekend activities. No peeking at significance mid-test (or use a sequential test if you need early stopping).
- **Success rule, written before launch:** ship if the primary metric's lift is significant *and* no guardrail is worse beyond a pre-set tolerance. Then check after 4 weeks that **plans that happen** moved too, not just claims (claims that don't turn into plans are a vanity win).

---

## 4. Decide: if it still misses after the improvements

**Recommendation: change the goal, keep the feature (the vouch path in particular). Remove only the parts that hurt hosts.**

The argument:

1. **The 25% / 30% targets were set for this exercise, not derived from Velio's economics.** Velio's core metrics are **K-factor** and **plans that happen**. If the feature raises those against the holdout, it's working even at a 20% claim rate. Holding a proxy target above the real outcome would mean killing something that grows the company.
2. **Blended targets punish the healthy half.** Vouch and public links are different products: one is a personal "I stand behind you", the other a broadcast. They should have separate targets (for example vouch ≥ 40%, public ≥ 10%). A blended 25% can be missed while vouch performs very well.
3. **"Keep iterating" is only right with a named, untested hypothesis and a measured trend.** If ranks 1–7 shipped and the lift is flat, more iterating is sunk cost. Change what you measure, or narrow the feature.
4. **Remove a part only if it's net-negative for the people it costs.** Held spots cost hosts: phantom-full activities turn real bookers away. If the **release rate of held spots stays high and host fill rate drops** against the holdout, remove holding for *public* links (they'd claim from the open pool only) and keep holds for vouches. Removing the whole feature is only justified if K-factor and plans that happen are flat or negative against the holdout **and** hosts are worse off. That's the one case where it's pure cost.

**Decision rule to agree up front:**

| Outcome against the holdout (after ranks 1–7) | Decision |
| --- | --- |
| Claim rate on target | Keep; move on to K-factor work |
| Claim rate below target, **but K-factor or plans-that-happen up** | **Change the goal:** split by vouch/public and anchor on K-factor |
| Below target, core metrics flat, a specific untested hypothesis remains | One more time-boxed iteration (≤ 2 weeks), then decide again |
| Below target, core metrics flat or down, host fill rate down | Remove held spots for public links; if still negative, remove the feature |

There's no single right answer here. What matters is that this rule is written down **before** the results come in, so the decision isn't made by whoever wants the feature to survive.
