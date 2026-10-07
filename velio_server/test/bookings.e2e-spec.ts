import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { holdExpiresAt } from '../src/hold-window.js';
import { createApp, createUser, eventsNamed } from './helpers.js';

let app: INestApplication;
let db: DbService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, db, http } = await createApp()));
afterAll(() => app.close());

async function newActivity(capacity: number, hoursOut = 24) {
  const hostId = await createUser(app, 'Host');
  const res = await http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Kayak', startsAt: new Date(Date.now() + hoursOut * 3_600_000).toISOString(), capacity })
    .expect(201);
  return res.body as { id: string; startsAt: string };
}

const book = (userId: string, activityId: string, heldSpots: number) =>
  http().post('/bookings').set('X-User-Id', userId).send({ activityId, heldSpots });

describe('POST /bookings', () => {
  it('books the booker spot plus held spots in one go', async () => {
    const activity = await newActivity(10);
    const bookerId = await createUser(app, 'Booker');
    const before = Date.now();

    const res = await book(bookerId, activity.id, 2).expect(201);

    expect(res.body).toMatchObject({ spotsLeft: 7 });
    const spots = await db.pool.query(`SELECT status, user_id FROM spots WHERE plan_id = $1 ORDER BY id`, [
      res.body.planId,
    ]);
    expect(spots.rows).toEqual([
      { status: 'booker', user_id: bookerId },
      { status: 'held', user_id: null },
      { status: 'held', user_id: null },
    ]);

    const avail = await http().get(`/activities/${activity.id}/availability`).expect(200);
    expect(avail.body).toEqual({ spotsLeft: 7, version: 1 });

    // 24h out → 8h window
    const expected = holdExpiresAt(new Date(activity.startsAt), new Date(before)).getTime();
    expect(Math.abs(new Date(res.body.holdExpiresAt).getTime() - expected)).toBeLessThan(60_000);

    const [event] = await eventsNamed(db, 'booking_created', { planId: res.body.planId });
    expect(event).toMatchObject({ user_id: bookerId, activity_id: activity.id, props: { spotsHeld: 2 } });
  });

  it('allows booking with no held spots', async () => {
    const activity = await newActivity(1);
    const bookerId = await createUser(app, 'Booker');
    const res = await book(bookerId, activity.id, 0).expect(201);
    expect(res.body.spotsLeft).toBe(0);
  });

  it('rejects held spots above the cap with 422 {cap}', async () => {
    const activity = await newActivity(10);
    const bookerId = await createUser(app, 'Booker');
    const res = await book(bookerId, activity.id, 3).expect(422);
    expect(res.body).toMatchObject({ cap: 2 });
  });

  it('reads the cap from settings on every booking (no redeploy)', async () => {
    const activity = await newActivity(10);
    const bookerId = await createUser(app, 'Booker');
    await db.pool.query(`UPDATE settings SET value = '3' WHERE key = 'new_user_cap'`);
    try {
      await book(bookerId, activity.id, 3).expect(201);
    } finally {
      await db.pool.query(`UPDATE settings SET value = '2' WHERE key = 'new_user_cap'`);
    }
  });

  it('returns 409 {available} when fewer spots remain than requested, changing nothing', async () => {
    const activity = await newActivity(3);
    const bookerId = await createUser(app, 'Booker');

    const res = await book(bookerId, activity.id, 2).expect(201);
    expect(res.body.spotsLeft).toBe(0);

    const other = await createUser(app, 'Other');
    const activity2 = await newActivity(3);
    await book(other, activity2.id, 1).expect(201); // 1 left
    const late = await createUser(app, 'Late');
    const conflict = await book(late, activity2.id, 2).expect(409);
    expect(conflict.body).toMatchObject({ reason: 'race_lost', available: 1 });

    const avail = await http().get(`/activities/${activity2.id}/availability`).expect(200);
    expect(avail.body.spotsLeft).toBe(1);

    const [failed] = await eventsNamed(db, 'booking_failed', { activityId: activity2.id });
    expect(failed).toMatchObject({ user_id: late, props: { reason: 'race_lost', requested: 3, available: 1 } });
  });

  it('stops the same booker booking the same activity twice', async () => {
    const activity = await newActivity(10);
    const bookerId = await createUser(app, 'Booker');
    await book(bookerId, activity.id, 0).expect(201);
    await book(bookerId, activity.id, 0).expect(409);
    const avail = await http().get(`/activities/${activity.id}/availability`).expect(200);
    expect(avail.body.spotsLeft).toBe(9);
  });

  it('404s an unknown activity and 400s bad input', async () => {
    const bookerId = await createUser(app, 'Booker');
    await book(bookerId, '999999999', 0).expect(404);
    await book(bookerId, 'abc', 0).expect(400);
    const activity = await newActivity(10);
    await book(bookerId, activity.id, -1).expect(400);
  });
});
