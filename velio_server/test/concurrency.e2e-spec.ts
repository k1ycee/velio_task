import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { createApp, createUser } from './helpers.js';

// The "zero oversell, ever" proof: many requests racing for the same spots.

let app: INestApplication;
let db: DbService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, db, http } = await createApp()));
afterAll(() => app.close());

async function newActivity(capacity: number) {
  const hostId = await createUser(app, 'Host');
  const res = await http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Race', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity })
    .expect(201);
  return res.body.id as string;
}

const createUsers = (n: number) => Promise.all(Array.from({ length: n }, (_, i) => createUser(app, `U${i}`)));

it('50 parallel claims on 1 remaining spot: exactly 1 wins, 49 get race_lost', async () => {
  const activityId = await newActivity(2);
  const bookerId = await createUser(app, 'Booker');
  const booking = await http()
    .post('/bookings')
    .set('X-User-Id', bookerId)
    .send({ activityId, heldSpots: 0 })
    .expect(201);
  const pub = await http()
    .post(`/plans/${booking.body.planId}/invites`)
    .set('X-User-Id', bookerId)
    .send({ type: 'public' })
    .expect(201);

  const guests = await createUsers(50);
  const results = await Promise.all(
    guests.map((g) => http().post(`/invites/${pub.body.token}/claim`).set('X-User-Id', g).send({})),
  );

  expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  const losers = results.filter((r) => r.status === 409);
  expect(losers).toHaveLength(49);
  expect(losers.every((r) => r.body.reason === 'race_lost')).toBe(true);

  const counts = await db.pool.query(
    `SELECT a.spots_left,
            (SELECT count(*)::int FROM spots WHERE activity_id = a.id AND status IN ('booker', 'claimed')) AS occupied
     FROM activities a WHERE a.id = $1`,
    [activityId],
  );
  expect(counts.rows[0]).toEqual({ spots_left: 0, occupied: 2 });
});

it('50 parallel bookings for a 10-spot activity: exactly 10 succeed', async () => {
  const activityId = await newActivity(10);
  const bookers = await createUsers(50);
  const results = await Promise.all(
    bookers.map((b) => http().post('/bookings').set('X-User-Id', b).send({ activityId, heldSpots: 0 })),
  );

  expect(results.filter((r) => r.status === 201)).toHaveLength(10);
  expect(results.filter((r) => r.status === 409)).toHaveLength(40);
  const { rows } = await db.pool.query(`SELECT spots_left FROM activities WHERE id = $1`, [activityId]);
  expect(rows[0].spots_left).toBe(0);
});

it('mixed held-spot bookings never take more than capacity', async () => {
  const activityId = await newActivity(7);
  const bookers = await createUsers(20);
  const results = await Promise.all(
    bookers.map((b, i) => http().post('/bookings').set('X-User-Id', b).send({ activityId, heldSpots: i % 3 })),
  );
  const taken = results.filter((r) => r.status === 201).length;
  const { rows } = await db.pool.query(
    `SELECT a.spots_left, (SELECT count(*)::int FROM spots WHERE activity_id = a.id) AS total
     FROM activities a WHERE a.id = $1`,
    [activityId],
  );
  expect(taken).toBeGreaterThan(0);
  expect(rows[0].total + rows[0].spots_left).toBe(7);
  expect(rows[0].total).toBeLessThanOrEqual(7);
});
