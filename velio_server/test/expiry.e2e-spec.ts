import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { ExpiryService } from '../src/expiry/expiry.service.js';
import { createApp, createUser, eventsNamed } from './helpers.js';

let app: INestApplication;
let db: DbService;
let expiry: ExpiryService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => {
  ({ app, db, http } = await createApp());
  expiry = app.get(ExpiryService);
});
afterAll(() => app.close());

async function bookedPlan(capacity: number, heldSpots: number) {
  const hostId = await createUser(app, 'Host');
  const activity = await http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Kayak', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity })
    .expect(201);
  const bookerId = await createUser(app, 'Booker');
  const booking = await http()
    .post('/bookings')
    .set('X-User-Id', bookerId)
    .send({ activityId: activity.body.id, heldSpots })
    .expect(201);
  return { activityId: activity.body.id as string, bookerId, planId: booking.body.planId as string };
}

const availability = async (activityId: string) =>
  (await http().get(`/activities/${activityId}/availability`).expect(200)).body as { spotsLeft: number; version: number };

/** Moves a plan's hold so that `elapsedPct` of the window has passed. */
async function setHoldProgress(planId: string, elapsedPct: number, windowHours = 10) {
  const created = new Date(Date.now() - (elapsedPct / 100) * windowHours * 3_600_000);
  const expires = new Date(created.getTime() + windowHours * 3_600_000);
  await db.pool.query(`UPDATE plans SET created_at = $2, hold_expires_at = $3 WHERE id = $1`, [
    planId,
    created,
    expires,
  ]);
}

describe('releaseExpiredHolds', () => {
  it('releases every unfilled held spot (bound or not) back to the open pool once the window ends', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 2);
    const v = await http().post(`/plans/${planId}/invites`).set('X-User-Id', bookerId).send({ type: 'vouch' });
    expect(v.status).toBe(201);
    const before = await availability(activityId);
    expect(before.spotsLeft).toBe(7);

    await setHoldProgress(planId, 101);
    const released = await expiry.releaseExpiredHolds();

    expect(released).toContain(activityId);
    const after = await availability(activityId);
    expect(after.spotsLeft).toBe(9);
    expect(after.version).toBeGreaterThan(before.version);

    const statuses = await db.pool.query(`SELECT status FROM spots WHERE plan_id = $1 ORDER BY id`, [planId]);
    expect(statuses.rows.map((r) => r.status)).toEqual(['booker', 'released', 'released']);

    const [event] = await eventsNamed(db, 'hold_released', { planId });
    expect(event).toMatchObject({ user_id: bookerId, props: { spotsReleased: 2 } });
  });

  it('leaves claimed spots alone and is idempotent', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 2);
    const p = await http().post(`/plans/${planId}/invites`).set('X-User-Id', bookerId).send({ type: 'public' });
    const guest = await createUser(app, 'Guest');
    await http().post(`/invites/${p.body.token}/claim`).set('X-User-Id', guest).expect(201);

    await setHoldProgress(planId, 101);
    await expiry.releaseExpiredHolds();
    await expiry.releaseExpiredHolds();

    expect((await availability(activityId)).spotsLeft).toBe(8);
    const statuses = await db.pool.query(`SELECT status FROM spots WHERE plan_id = $1 ORDER BY id`, [planId]);
    expect(statuses.rows.map((r) => r.status)).toEqual(['booker', 'claimed', 'released']);
    expect(await eventsNamed(db, 'hold_released', { planId })).toHaveLength(1);
  });

  it('does not touch plans whose window is still open', async () => {
    const { activityId, planId } = await bookedPlan(10, 2);
    await setHoldProgress(planId, 99);
    await expiry.releaseExpiredHolds();
    expect((await availability(activityId)).spotsLeft).toBe(7);
  });
});

describe('hold warnings', () => {
  it('warns once at 50% and once at 90%', async () => {
    const { bookerId, planId } = await bookedPlan(10, 1);

    await setHoldProgress(planId, 40);
    await expiry.sendHoldWarnings();
    expect(await eventsNamed(db, 'hold_warning_sent', { planId })).toHaveLength(0);

    await setHoldProgress(planId, 60);
    await expiry.sendHoldWarnings();
    await expiry.sendHoldWarnings();
    const fifty = await eventsNamed(db, 'hold_warning_sent', { planId });
    expect(fifty).toHaveLength(1);
    expect(fifty[0]).toMatchObject({ user_id: bookerId, props: { pct: 50, heldSpotsLeft: 1 } });

    await setHoldProgress(planId, 95);
    await expiry.sendHoldWarnings();
    const all = await eventsNamed(db, 'hold_warning_sent', { planId });
    expect(all.map((e) => e.props.pct)).toEqual([50, 90]);
  });

  it('skips plans with no held spots left to fill', async () => {
    const { planId } = await bookedPlan(10, 0);
    await setHoldProgress(planId, 95);
    await expiry.sendHoldWarnings();
    expect(await eventsNamed(db, 'hold_warning_sent', { planId })).toHaveLength(0);
  });
});
