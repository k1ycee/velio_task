import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { computeMetrics } from '../src/dashboard/metrics.js';
import { createApp, createUser } from './helpers.js';

let app: INestApplication;
let db: DbService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, db, http } = await createApp()));
afterAll(() => app.close());

describe('computeMetrics', () => {
  it('computes every target from a known scenario', async () => {
    // e2e files run one at a time, so everything after `since` is this scenario.
    const since = new Date();
    const as = (id: string) => ({ 'X-User-Id': id });

    const host = await createUser(app, 'Host');
    const activity = await http()
      .post('/activities')
      .set(as(host))
      .send({ title: 'Metrics', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity: 4 })
      .expect(201);
    const activityId = activity.body.id;

    // Booker A: 1 + 2 held, creates a vouch and a public link. Booker B: just themselves, no invites.
    const a = await createUser(app, 'A');
    const planA = (await http().post('/bookings').set(as(a)).send({ activityId, heldSpots: 2 }).expect(201)).body.planId;
    const b = await createUser(app, 'B');
    await http().post('/bookings').set(as(b)).send({ activityId, heldSpots: 0 }).expect(201);
    const vouch = (await http().post(`/plans/${planA}/invites`).set(as(a)).send({ type: 'vouch' }).expect(201)).body;
    const pub = (await http().post(`/plans/${planA}/invites`).set(as(a)).send({ type: 'public' }).expect(201)).body;

    // G1 opens the vouch twice (one unique open) and claims. G2 opens the public link and leaves.
    // G3 opens the public link and claims. C tries to book a full activity: race_lost (excluded).
    const g1 = await createUser(app, 'G1');
    await http().get(`/invites/${vouch.token}`).set(as(g1)).expect(200);
    await http().get(`/invites/${vouch.token}`).set(as(g1)).expect(200);
    await http().post(`/invites/${vouch.token}/claim`).set(as(g1)).expect(201);
    const g2 = await createUser(app, 'G2');
    await http().get(`/invites/${pub.token}`).set(as(g2)).expect(200);
    const g3 = await createUser(app, 'G3');
    await http().get(`/invites/${pub.token}`).set(as(g3)).expect(200);
    await http().post(`/invites/${pub.token}/claim`).set(as(g3)).expect(201);
    const c = await createUser(app, 'C');
    await http().post('/bookings').set(as(c)).send({ activityId, heldSpots: 0 }).expect(409);

    // 20 latency samples: 100, 200, ... 2000 ms.
    for (let i = 1; i <= 20; i++) {
      await db.pool.query(
        `INSERT INTO events (name, activity_id, props) VALUES ('availability_received', $1, $2)`,
        [activityId, { latencyMs: i * 100 }],
      );
    }

    // The activity has now happened: plan A had guests, plan B didn't.
    await db.pool.query(`UPDATE activities SET starts_at = now() - interval '1 hour' WHERE id = $1`, [activityId]);

    const m = await computeMetrics(db.pool, since);
    expect(m).toMatchObject({
      oversoldActivities: 0,
      countDrift: 0,
      bookingAttempts: 4, // 2 bookings + 2 claims; the race_lost attempt is excluded
      bookingFailures: 0,
      bookingSuccessPct: 100,
      latencyP95Ms: 1905,
      latencySamples: 20,
      bookers: 2,
      inviters: 1,
      inviteRatePct: 50,
      claimRatePct: { vouch: 100, public: 50 },
      kFactor: { total: 1, vouch: 0.5, public: 0.5 },
      plansHappened: 1,
      pastPlans: 2,
    });
  });
});

describe('GET /dashboard', () => {
  it('renders the targets and the cap', async () => {
    const res = await http().get('/dashboard').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    for (const label of ['Oversold activities', 'Booking success', 'Availability p95', 'Invite rate', 'Claim rate', 'K-factor', 'Plans that happened', 'New-user cap']) {
      expect(res.text).toContain(label);
    }
  });
});

describe('POST /settings', () => {
  it('updates the cap without a redeploy and redirects back', async () => {
    const res = await http().post('/settings').type('form').send({ new_user_cap: '4' }).expect(303);
    expect(res.headers.location).toBe('/dashboard');
    const { rows } = await db.pool.query(`SELECT value FROM settings WHERE key = 'new_user_cap'`);
    expect(rows[0].value).toBe(4);
    await http().post('/settings').type('form').send({ new_user_cap: '2' }).expect(303);
  });

  it('rejects a negative or non-numeric cap', async () => {
    await http().post('/settings').type('form').send({ new_user_cap: '-1' }).expect(400);
    await http().post('/settings').type('form').send({ new_user_cap: 'lots' }).expect(400);
  });
});
