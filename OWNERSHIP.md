# Ownership: the invite funnel is missing its target

**Situation.** Group bookings shipped. The technical targets hold: 0 oversold, booking success ≥ 99.5%, live updates p95 ≤ 2s. The growth loop is what's underperforming. K-factor and "plans that actually happen" are the metrics Velio cares about most, so this is the part I own.

There are really two different misses here, and I wouldn't treat them the same way:

| Case | What's missing | Side of the funnel | Where I'd look first |
| --- | --- | --- | --- |
| **A** | Fewer than **30%** of bookers invite | Booker | H2, H6: links not leaving the booker's screen, or bookers not thinking to invite |
| **B** | Fewer than **25%** of opened invites end in a claim | Guest | H1, H3, H4, H5: no app, spot gone, form too long, no reason to trust the link |

If both miss, I start with B. A booker who sees their friends actually show up is more likely to invite next time, and fixing A first just sends more people into a broken claim step.

The funnel as the build records it today:

```
booking_created ──► invite_created ──► (link shared — not tracked) ──► invite_opened ──► spot_claimed ──► plan happened
   bookers           30% target            ⚠ blind spot                 25% target                       ⚠ proxy only
```

---

## 1. Diagnose

### What I'd look at first

I want to find **which step** loses people, and **for whom**, before guessing why. Most of this is already in `velio_server/queries/metrics.sql`: section 4 (invite rate), 5 (funnel by invite type), 2b (failures by reason) and 8 (held spots filled vs released).

1. **The funnel by step, split by vouch and public.** A blended claim rate hides the real story. I'd expect vouch to convert far better than public. If vouch is healthy and public isn't, the problem is much narrower than it looks.
2. **Where each step's losers end up:**
   - **Bookers who never invite:** did they hold 0 spots? Did they create a link and never come back? (`booking_created.props.spotsHeld` against `invite_created`.)
   - **Opens with no claim:** did they hit `race_lost`, a used link, or nothing at all (they just left)?
   - **Held spots** that ended up `released` instead of `claimed`. A high release rate means links aren't reaching friends in time.
3. **Time between steps:** `invite_created → invite_opened → spot_claimed`, against the **hold window** each booking got. A next-day activity only gets about 8 hours, and I suspect some links expire before friends even see them.
4. **Segments:** how far ahead the activity is (same day / next day / more than 3 days), activity size, new vs returning guests (`isNewUser`), and how many invites each booker sends.
5. **Talk to people.** I'd watch 10 session recordings of the claim screen or interview 5 guests. The numbers tell me where people drop; people tell me why.

### Blind spots I'd fix before trusting any of this

The current tracking **can't see** some of the most likely failure points:

| Gap | Why it matters |
| --- | --- |
| **No "link shared" event**, only "link created" | I can't tell "never sent" from "sent and ignored". |
| **Opens only count inside the app** | A guest without the app never produces `invite_opened`. The biggest likely drop-off is invisible, *and* it makes the claim rate look better than it is. |
| **No claim-form events** (started / failed validation) | I can't separate "not interested" from "gave up on the form". |
| **No platform or entry point** (iOS / Android, tapped link vs pasted code) | I can't spot one broken platform. |
| **"Plan happened" is a proxy.** It means the date passed with the booker + ≥ 1 guest still holding a spot. Nobody confirms they turned up | This is a core metric and I'm guessing at it. A plan where nobody showed counts the same as one where everybody did. |

### My top hypotheses (most likely × biggest impact first)

| # | Hypothesis | What would confirm it |
| --- | --- | --- |
| H1 | **Guests without the app are lost before I can see them.** I built this assuming invited guests already have the app. The scope says they often arrive "for the first time", so this is the assumption I'd revisit first. | Few `invite_opened` per `invite_created` (especially public); new-user share of opens near zero; once a web landing page exists, its views far outnumber app opens. |
| H2 | **Links never leave the booker's screen.** Bookers are on desktop web, and moving a `velio://` link from a laptop to a phone chat is awkward. | Many `invite_created` with no `invite_opened` at all; few bookers on mobile web. |
| H3 | **The spot is gone when the guest arrives.** Short hold windows and sold-out activities. | `race_lost` on claims and released vouch spots concentrated in short-lead activities. |
| H4 | **The claim form asks too much.** Three fields typed on a phone, for a first-timer. | High open → no claim with no failure event; worst for new users. |
| H5 | **A public link gives no reason to trust it.** It shows who invited you, but not who else is going, the price or the location. | Public claim rate far below vouch even with spots available. |
| H6 | **Bookers don't think of inviting.** They booked alone, or the invite step isn't in their face right after booking. | Low invite rate even among bookers who held spots, or most bookings hold 0 spots. |

---

## 2. Improve

Ranked by **expected impact ÷ effort**. Effort is relative to this codebase (S ≈ a day or less, M ≈ 2–4 days, L ≈ 1–2 weeks).

| Rank | Change | Case | Impact | Effort | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | **Close the tracking gaps:** `invite_shared` (copy / share tapped), `claim_form_started`, `claim_form_error`, plus `platform` and `entry` (deep link / code / web) on every event | A + B | Unblocks everything | S | I can't fix what I can't see. Makes H1, H2 and H4 testable |
| 2 | **Web claim page for guests without the app:** `velio_web/#/invite/:token` on the existing `GET /invites/:token` and claim API, then a nudge to install | B | **High** | M (~4h) | H1. It also turns invisible drop-off into opens I can count |
| 3 | **Native share instead of copy:** Web Share API / SMS on the plan page, offered automatically right after booking | A | High | S | H2, H6. One tap from booking to the friend's chat |
| 4 | **One-field claim:** phone only (email later); skip the form for people the app already knows | B | Med–High | S | H4. The app already remembers the user ID |
| 5 | **Universal Links (`https://velio.app/i/<token>`)** with a rich preview (activity, inviter, spots left) | A + B | High | M | H1, H2, H5. `velio://` links aren't tappable in many chat apps and show no preview |
| 6 | **Social proof on the claim screen:** who's going, spots held for "your group", price and location | B | Med | S | H5. The plan endpoint already returns the members |
| 7 | **Hold tuning:** a minimum window (e.g. 30 min), and extend a vouch hold by N minutes when its link is opened | B | Med | S–M | H3. The formula lives in `hold-window.ts`; the extension is one update in the open handler |
| 8 | **Check-in:** the booker taps "We're here" (or guests confirm) on the day | Core metric | Measures the goal | S | Turns "plans that happen" from a guess into data, so I can judge everything above against it |
| 9 | **Actually send the 50% / 90% reminders** (email now, push once bookers have a native app) | A + B | Med | M | H2, H3. Today it's only an event and a banner the booker has to be looking at |
| 10 | **Waitlist on sold-out invites** | B | Low–Med | M | H3's tail. Only worth it if claim `race_lost` turns out to be large |
| 11 | **Phone verification (one-time code)** | Data trust | Neutral for conversion, **high for trust** | M | Not a conversion lever. It protects K-factor and vouch credit from fake identities. Ship it with rank 4 so it adds no fields |

### What I'd do in the first 30 days

| When | What | Why then |
| --- | --- | --- |
| Week 1 | Rank 1 (tracking) and rank 8 (check-in). Let a week of clean data come in | Every later decision depends on this data |
| Weeks 2–3 | Rank 2 (web claim page) and rank 3 (native share), built in parallel | One is the biggest guest fix, the other the biggest booker fix |
| Week 3 | Read the clean funnel. Pick the next fix from what it shows: 4, 5, 6 or 7 | Don't guess past the data |
| Weeks 3–5 | Run the experiments below for at least two full weeks | Covers weekday and weekend activities |

### What I won't do

- **Pay people to invite** (credits, discounts). It lifts K-factor with low-intent users who don't show up, so plans that happen can go *down* while the dashboard looks great.
- **Cut the hold window blindly** to free spots. It could fix H3 for hosts and make it worse for guests. It changes only with data from rank 7.
- **Auto-create links at booking** to push the invite rate up. That makes the 30% metric meaningless, because every booker would "invite".

---

## 3. Prove it

### Metrics

- **Primary, claim side (case B):** claims ÷ **unique link reaches**. Once ranks 1 and 2 ship, a web landing view and an app open both count as a reach. Reported separately for vouch and public. *The denominator changes when the web page launches, so I compare arms on the same definition, never against old dashboards.*
- **Primary, invite side (case A):** bookers with ≥ 1 `invite_shared` ÷ bookers.
- **Secondary:** K-factor, time to claim, and plans that happen (now measured by check-in).
- **Guardrails, with limits I'd set before launch:**

| Guardrail | Limit |
| --- | --- |
| Oversold and count drift | Stay at 0. Any breach stops the test |
| Booking success | Stays ≥ 99.5% |
| Live availability p95 | Stays ≤ 2s |
| Held-spot release rate | No more than 5 points above control (more holds without fills means hosts see phantom-full activities) |
| Host fill rate (spots taken by start time) | No more than 2 points below control |
| Plans that happen | Not below control |

### Experiment design

- **Split by booker, not by guest.** Invites spread through a booker's friends. If I split guests, two guests on the same plan could see different flows and contaminate each other. I hash `booker_id` into arms, so every invite from a booker shares one experience. The same design works for both case A (share button) and case B (claim page).
- **Arms:** control vs treatment, plus a persistent **10% global holdout** that gets none of the growth changes. That holdout measures the combined, long-run effect on K-factor and plans that happen.
- **Record the arm** as `props.arm` on `booking_created`, `invite_*` and `spot_claimed`, so every query in `metrics.sql` can split by arm with one `GROUP BY`.
- **Sample size (rough):** going from a 20% to a 25% claim rate (two-sided α = 0.05, power 0.8) needs about **1,100 reaches per arm**. Splitting by booker clusters the data, which inflates that by `1 + (m − 1)·ρ` (m = reaches per booker, ρ = how alike one booker's guests behave). With m ≈ 3 and ρ ≈ 0.2 that's ×1.4, so about **1,550 per arm**.
- **Duration:** fixed in advance, at least **two full weeks**. No peeking at significance halfway (or a sequential test if I need to stop early).
- **Success rule, written before launch:** ship if the primary metric's lift is significant *and* no guardrail crosses its limit. Then, 4 weeks later, check that **plans that happen** moved too, not just claims. Claims that don't turn into real plans are a vanity win.

---

## 4. Decide: if it still misses after all this

**My call: change the goal, keep the feature (the vouch path especially), and remove only the parts that hurt hosts.**

1. **The 25% / 30% targets were set for this exercise, not worked out from Velio's business.** What Velio actually cares about is **K-factor** and **plans that happen**. If the feature moves those against the holdout, it's working even at a 20% claim rate. I wouldn't kill something that grows the company because it missed a proxy.
2. **Blended targets punish the healthy half.** Vouch and public links are different products. One is a personal "I stand behind you", the other a broadcast. They should have separate targets (say vouch ≥ 40%, public ≥ 10%). A blended 25% can miss while vouch is doing really well.
3. **"Keep iterating" only makes sense with a named, untested hypothesis and a measured trend.** If ranks 1–7 shipped and the lift is flat, more iterating is sunk cost. At that point I'd change what I measure, or narrow the feature.
4. **I'd only remove a part if it's net-negative for the people paying for it.** Held spots cost hosts: phantom-full activities turn real bookers away. If the release rate stays high and host fill rate drops against the holdout, I'd remove holds for *public* links (they'd claim from the open pool only) and keep them for vouches. Removing the whole feature only makes sense if K-factor and plans that happen are flat or down against the holdout **and** hosts are worse off. That's the one case where it's pure cost.

**The decision rule I'd agree with the team up front:**

| Outcome against the holdout (after ranks 1–7) | Decision |
| --- | --- |
| Claim rate on target | Keep it; move on to K-factor work |
| Below target, **but K-factor or plans that happen are up** | **Change the goal:** split by vouch/public and anchor on K-factor |
| Below target, core metrics flat, and one specific hypothesis is still untested | One more iteration, capped at 2 weeks, then decide again |
| Below target, core metrics flat or down, host fill rate down | Remove holds for public links; if it's still negative, remove the feature |

There's no single right answer here. What matters to me is that this rule is written down **before** the results come in, so the decision isn't made by whoever most wants the feature to survive.
