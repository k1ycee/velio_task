#!/usr/bin/env node
// Load test through the real HTTP API, leaving real data in the database (users, activities,
// bookings, invites, claims, events). Mirrors what the apps do:
//   hosts create activities (web) → bookers book with held spots (web) → bookers create vouch +
//   public links (web) → guests open the link, create an identity and claim (Flutter).
// Live listeners subscribe to /activities/stream and report delivery latency, like the clients.
//
//   node scripts/load-test.mjs                       # 100 hosts, 200 bookers, 700 guests
//   CONCURRENCY=100 SEED=7 node scripts/load-test.mjs
//
// Env: API (http://localhost:3000) · HOSTS 100 · BOOKERS 200 · GUESTS 700 · CONCURRENCY 50 ·
//      LISTENERS 10 · CLAIM_RATE 0.9 (share of guests who claim after opening) · SEED (random)
// ponytail: one Node process drives everything; split across machines if it becomes the bottleneck.

const env = (k, d) => process.env[k] ?? d;
const API = env('API', 'http://localhost:3000');
const HOSTS = Number(env('HOSTS', 100));
const BOOKERS = Number(env('BOOKERS', 200));
const GUESTS = Number(env('GUESTS', 700));
const CONCURRENCY = Number(env('CONCURRENCY', 50));
const LISTENERS = Number(env('LISTENERS', 10));
const CLAIM_RATE = Number(env('CLAIM_RATE', 0.9));
const SEED = Number(env('SEED', Math.floor(Math.random() * 2 ** 31)));
const RUN = Date.now().toString(36);
const PHONE_STAMP = String(Date.now()).slice(-8); // unique per run; phone and email must be unique
const ROLE_DIGIT = { Host: 1, Booker: 2, Guest: 3 };

// Seeded PRNG (mulberry32), so a SEED reproduces the same shape of traffic.
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

// ---- HTTP with per-endpoint timing -------------------------------------------------------------
const timings = new Map(); // label → ms[]
const statuses = new Map(); // "label status" → count
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

async function call(label, method, path, { body, user } = {}) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(user ? { 'X-User-Id': user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    bump(statuses, `${label} network-error`);
    return { status: 0, body: { message: String(err) } };
  }
  const json = await res.json().catch(() => ({}));
  (timings.get(label) ?? timings.set(label, []).get(label)).push(performance.now() - started);
  bump(statuses, `${label} ${res.status}`);
  return { status: res.status, body: json };
}

/** Runs `fn` over `items` with at most CONCURRENCY in flight. */
async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const pad = (n) => String(n).padStart(3, '0');
const phases = [];
async function phase(name, fn) {
  const started = performance.now();
  const result = await fn();
  phases.push({ name, seconds: (performance.now() - started) / 1000 });
  console.log(`✓ ${name} (${phases.at(-1).seconds.toFixed(1)}s)`);
  return result;
}

const newUser = (role, i) =>
  call('POST /users', 'POST', '/users', {
    body: {
      name: `${role} ${pad(i)}`,
      phone: `+1${PHONE_STAMP}${ROLE_DIGIT[role]}${pad(i)}`,
      email: `${role.toLowerCase()}${pad(i)}-${RUN}@load.test`,
    },
  }).then((r) => {
    if (!r.body.id) throw new Error(`could not create ${role} ${i}: ${JSON.stringify(r.body)}`);
    return r.body.id;
  });

// ---- Live listeners: the clients' latency reports ----------------------------------------------
const listenerAbort = new AbortController();
let liveUpdates = 0;
async function listen(userId) {
  try {
    const res = await fetch(`${API}/activities/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: listenerAbort.signal,
    });
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const u = JSON.parse(line.slice(5));
        if (!u.committedAt) continue; // snapshot, not a committed change
        liveUpdates++;
        const receivedAt = new Date().toISOString();
        call('POST /events', 'POST', '/events', {
          user: userId,
          body: {
            name: 'availability_received',
            activityId: u.activityId,
            props: { version: u.version, committedAt: u.committedAt, clientReceivedAt: receivedAt, clientSentAt: new Date().toISOString() },
          },
        });
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('listener dropped:', err.message);
  }
}

// ---- The run -----------------------------------------------------------------------------------
const TITLES = [
  'Sunset Kayaking', 'Pottery Night', 'Rooftop Yoga', 'Street Food Walk', 'Climbing Session', 'Board Game Club',
  'Wine Tasting', 'Salsa Basics', 'Trail Run', 'Jazz Night', 'Paddleboard Tour', 'Cooking Class',
  'Photo Walk', 'Pub Quiz', 'Bike Ride', 'Comedy Open Mic', 'Escape Room', 'Beach Volleyball',
];

console.log(`Load test ${RUN} → ${API}: ${HOSTS} hosts, ${BOOKERS} bookers, ${GUESTS} guests, concurrency ${CONCURRENCY}, seed ${SEED}`);
const t0 = performance.now();

const hosts = await phase(`create ${HOSTS} hosts`, () => pool([...Array(HOSTS).keys()], (i) => newUser('Host', i + 1)));

const activities = await phase(`create ${HOSTS} activities`, () =>
  pool(hosts, async (host, i) => {
    const startsAt = new Date(Date.now() + int(1, 14) * 86_400_000);
    startsAt.setUTCHours(int(9, 20), pick([0, 15, 30, 45]), 0, 0);
    const capacity = int(6, 14);
    const r = await call('POST /activities', 'POST', '/activities', {
      user: host,
      body: { title: `${pick(TITLES)} #${pad(i + 1)} (${RUN})`, startsAt: startsAt.toISOString(), capacity },
    });
    return { id: r.body.id, capacity };
  }),
);
const seats = activities.reduce((n, a) => n + a.capacity, 0);

const listenerUsers = hosts.slice(0, LISTENERS);
listenerUsers.forEach((u) => listen(u));
await new Promise((r) => setTimeout(r, 300)); // let the streams connect

const bookers = await phase(`create ${BOOKERS} bookers`, () => pool([...Array(BOOKERS).keys()], (i) => newUser('Booker', i + 1)));

// Each booker books a random activity, asking for 0–3 friends. Like the web: a 422 lowers the
// request to the cap; a race_lost with spots still available takes the "Only N left" offer.
const outcomes = new Map();
const plans = await phase(`${BOOKERS} concurrent bookings`, () =>
  pool(bookers, async (booker) => {
    const activity = pick(activities);
    let heldSpots = pick([0, 0, 1, 1, 2, 3]);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await call('POST /bookings', 'POST', '/bookings', { user: booker, body: { activityId: activity.id, heldSpots } });
      if (r.status === 201) {
        bump(outcomes, heldSpots === 0 ? 'booking: solo' : 'booking: with held spots');
        return { booker, planId: r.body.planId, activityId: activity.id, heldSpots };
      }
      if (r.status === 422 && heldSpots > r.body.cap) {
        heldSpots = r.body.cap;
        continue;
      }
      if (r.status === 409 && r.body.reason === 'race_lost' && Number(r.body.available) > 0) {
        heldSpots = Number(r.body.available) - 1;
        continue;
      }
      bump(outcomes, `booking: ${r.body.reason ?? r.status}`);
      return null;
    }
    return null;
  }),
).then((ps) => ps.filter(Boolean));

// One vouch link per held spot, plus a public link for every plan.
await phase(`create invites for ${plans.length} plans`, () =>
  pool(plans, async (plan) => {
    plan.vouch = [];
    for (let k = 0; k < plan.heldSpots; k++) {
      const r = await call('POST /plans/:id/invites', 'POST', `/plans/${plan.planId}/invites`, {
        user: plan.booker,
        body: { type: 'vouch', label: `Friend ${k + 1}` },
      });
      if (r.body.token) plan.vouch.push(r.body.token);
    }
    const pub = await call('POST /plans/:id/invites', 'POST', `/plans/${plan.planId}/invites`, { user: plan.booker, body: { type: 'public' } });
    plan.public = pub.body.token;
  }),
);

// Hand out guests: each vouch link goes to one guest first, the rest share public links.
const guestLinks = [];
for (const plan of plans) for (const token of plan.vouch) guestLinks.push({ token, type: 'vouch' });
while (guestLinks.length < GUESTS) {
  const plan = pick(plans);
  guestLinks.push({ token: plan.public, type: 'public' });
}
guestLinks.length = GUESTS;
guestLinks.sort(() => rand() - 0.5); // arrivals interleave across plans

await phase(`${GUESTS} guests open and claim (concurrent)`, () =>
  pool(guestLinks, async (link, i) => {
    // First open on a fresh install: no identity yet, exactly like the Flutter app.
    const opened = await call('GET /invites/:token', 'GET', `/invites/${link.token}`);
    if (opened.status !== 200) return bump(outcomes, `guest: open failed ${opened.status}`);
    if (rand() > CLAIM_RATE) return bump(outcomes, `guest: opened, never claimed`);
    const guest = await newUser('Guest', i + 1);
    const r = await call('POST /invites/:token/claim', 'POST', `/invites/${link.token}/claim`, { user: guest, body: {} });
    bump(outcomes, r.status === 201 ? `guest: claimed via ${link.type} (${r.body.source} spot)` : `guest: ${link.type} → ${r.body.reason ?? r.status}`);
  }),
);

await new Promise((r) => setTimeout(r, 1500)); // let the last live updates and latency reports land
listenerAbort.abort();
const total = (performance.now() - t0) / 1000;

// ---- Report ------------------------------------------------------------------------------------
const q = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const requests = [...timings.values()].reduce((n, xs) => n + xs.length, 0);

console.log(`\n== Run ${RUN}: ${requests} requests in ${total.toFixed(1)}s (${(requests / total).toFixed(0)} req/s), ${seats} seats across ${activities.length} activities`);
console.table(
  Object.fromEntries(
    [...timings].map(([label, xs]) => [
      label,
      { requests: xs.length, 'p50 ms': Math.round(q(xs, 0.5)), 'p95 ms': Math.round(q(xs, 0.95)), 'p99 ms': Math.round(q(xs, 0.99)), 'max ms': Math.round(Math.max(...xs)) },
    ]),
  ),
);
console.log('Status codes:');
console.table(Object.fromEntries([...statuses].sort().map(([k, n]) => [k, { count: n }])));
console.log('Outcomes:');
console.table(Object.fromEntries([...outcomes].sort().map(([k, n]) => [k, { count: n }])));
console.log(`Live: ${liveUpdates} committed updates received by ${listenerUsers.length} listeners`);

const m = (await call('GET /dashboard/metrics', 'GET', '/dashboard/metrics')).body;
console.log('\n== Dashboard (all-time, includes this run)');
console.table({
  'oversold activities': { value: m.oversoldActivities, target: 0 },
  'count drift': { value: m.countDrift, target: 0 },
  'booking success %': { value: m.bookingSuccessPct, target: '≥ 99.5' },
  'live update p95 ms': { value: m.latencyP95Ms, target: '≤ 2000' },
  'invite rate %': { value: m.inviteRatePct, target: '≥ 30' },
  'claim rate % (vouch)': { value: m.claimRatePct?.vouch, target: '≥ 25' },
  'claim rate % (public)': { value: m.claimRatePct?.public, target: '≥ 25' },
  'K-factor': { value: m.kFactor?.total, target: '—' },
});
const ok = m.oversoldActivities === 0 && m.countDrift === 0;
console.log(ok ? '✅ Zero oversell and no count drift.' : '❌ Integrity check failed — see the dashboard.');
console.log(`Find this run's data: activities titled "… (${RUN})", users with emails "*-${RUN}@load.test".`);
process.exit(ok ? 0 : 1);
