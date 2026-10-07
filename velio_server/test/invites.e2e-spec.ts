import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { createApp, createUser, eventsNamed } from './helpers.js';

let app: INestApplication;
let db: DbService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, db, http } = await createApp()));
afterAll(() => app.close());

/** Activity with `capacity`, booked by a fresh booker holding `heldSpots`. */
async function bookedPlan(capacity: number, heldSpots: number) {
  const hostId = await createUser(app, 'Host');
  const activity = await http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Speakeasy', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity })
    .expect(201);
  const bookerId = await createUser(app, 'Booker');
  const booking = await http()
    .post('/bookings')
    .set('X-User-Id', bookerId)
    .send({ activityId: activity.body.id, heldSpots })
    .expect(201);
  return { activityId: activity.body.id as string, bookerId, planId: booking.body.planId as string };
}

const invite = (userId: string, planId: string, type: 'vouch' | 'public', label?: string) =>
  http().post(`/plans/${planId}/invites`).set('X-User-Id', userId).send({ type, label });

const claim = (userId: string, token: string) =>
  http().post(`/invites/${token}/claim`).set('X-User-Id', userId).send({});

const spotsLeft = async (activityId: string) =>
  (await http().get(`/activities/${activityId}/availability`).expect(200)).body.spotsLeft as number;

describe('creating invites', () => {
  it('binds each vouch URL to its own held spot, and refuses when none are left', async () => {
    const { bookerId, planId } = await bookedPlan(10, 2);
    const a = await invite(bookerId, planId, 'vouch', 'Ada').expect(201);
    const b = await invite(bookerId, planId, 'vouch', 'Bo').expect(201);
    expect(a.body).toMatchObject({ type: 'vouch', url: `velio://invite/${a.body.token}` });
    expect(a.body.token).not.toBe(b.body.token);

    const bound = await db.pool.query(`SELECT spot_id FROM invites WHERE plan_id = $1 AND type = 'vouch'`, [planId]);
    expect(new Set(bound.rows.map((r) => r.spot_id)).size).toBe(2);

    const none = await invite(bookerId, planId, 'vouch', 'Cy').expect(409);
    expect(none.body.reason).toBe('no_held_spot');

    const [event] = await eventsNamed(db, 'invite_created', { planId });
    expect(event).toMatchObject({ user_id: bookerId, props: { inviteType: 'vouch', inviteId: a.body.inviteId } });
  });

  it('has one reusable public URL per plan', async () => {
    const { bookerId, planId } = await bookedPlan(10, 0);
    const first = await invite(bookerId, planId, 'public').expect(201);
    const again = await invite(bookerId, planId, 'public').expect(200);
    expect(again.body.token).toBe(first.body.token);
  });

  it('only the booker can create invites', async () => {
    const { planId } = await bookedPlan(10, 1);
    const stranger = await createUser(app, 'Stranger');
    await invite(stranger, planId, 'vouch').expect(403);
  });

  it('rejects an unknown type', async () => {
    const { bookerId, planId } = await bookedPlan(10, 1);
    await http().post(`/plans/${planId}/invites`).set('X-User-Id', bookerId).send({ type: 'other' }).expect(400);
  });
});

describe('opening an invite', () => {
  it('returns what the guest needs and tracks invite_opened', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 1);
    const v = await invite(bookerId, planId, 'vouch', 'Ada').expect(201);
    const guest = await createUser(app, 'Guest');

    const res = await http().get(`/invites/${v.body.token}`).set('X-User-Id', guest).expect(200);
    expect(res.body).toMatchObject({
      type: 'vouch',
      label: 'Ada',
      used: false,
      inviterName: 'Booker',
      activity: { id: activityId, title: 'Speakeasy', spotsLeft: 8 },
    });

    const [opened] = await eventsNamed(db, 'invite_opened', { planId });
    expect(opened).toMatchObject({ user_id: guest, props: { inviteType: 'vouch', inviteId: v.body.inviteId } });
  });

  it('404s an unknown token', async () => {
    await http().get('/invites/nope').expect(404);
  });
});

describe('claiming', () => {
  it('vouch: claims the bound held spot, is single-use, and leaves spots_left unchanged', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 1);
    const v = await invite(bookerId, planId, 'vouch', 'Ada').expect(201);
    const guest = await createUser(app, 'Guest');

    const res = await claim(guest, v.body.token).expect(201);
    expect(res.body).toMatchObject({ planId, source: 'held' });
    expect(await spotsLeft(activityId)).toBe(8);

    const spot = await db.pool.query(`SELECT status, user_id, invite_id FROM spots WHERE id = $1`, [res.body.spotId]);
    expect(spot.rows[0]).toEqual({ status: 'claimed', user_id: guest, invite_id: v.body.inviteId });

    const [event] = await eventsNamed(db, 'spot_claimed', { planId });
    expect(event).toMatchObject({
      user_id: guest,
      props: { inviteType: 'vouch', inviteId: v.body.inviteId, inviterId: bookerId, isNewUser: true, source: 'held' },
    });

    const other = await createUser(app, 'Other');
    expect((await claim(other, v.body.token).expect(409)).body.reason).toBe('used');
  });

  it('public: takes an unbound held spot first, then the open pool, and everyone joins the plan', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 2);
    const v = await invite(bookerId, planId, 'vouch', 'Ada').expect(201); // binds 1 of the 2 held spots
    const p = await invite(bookerId, planId, 'public').expect(201);

    const g1 = await createUser(app, 'G1');
    const first = await claim(g1, p.body.token).expect(201);
    expect(first.body.source).toBe('held');
    expect(await spotsLeft(activityId)).toBe(7);

    const boundSpot = await db.pool.query(`SELECT spot_id FROM invites WHERE id = $1`, [v.body.inviteId]);
    expect(first.body.spotId).not.toBe(boundSpot.rows[0].spot_id); // the vouched spot is protected

    const g2 = await createUser(app, 'G2');
    const second = await claim(g2, p.body.token).expect(201);
    expect(second.body).toMatchObject({ source: 'open', planId });
    expect(await spotsLeft(activityId)).toBe(6);

    // The vouch still works.
    const ada = await createUser(app, 'Ada');
    expect((await claim(ada, v.body.token).expect(201)).body.source).toBe('held');
  });

  it('released vouch: falls back to an open spot and keeps vouch attribution', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(10, 1);
    const v = await invite(bookerId, planId, 'vouch', 'Ada').expect(201);
    // Simulate the expiry job releasing the bound spot.
    await db.pool.query(
      `UPDATE spots SET status = 'released' WHERE id = (SELECT spot_id FROM invites WHERE id = $1)`,
      [v.body.inviteId],
    );
    await db.pool.query(`UPDATE activities SET spots_left = spots_left + 1 WHERE id = $1`, [activityId]);
    expect(await spotsLeft(activityId)).toBe(9);

    const guest = await createUser(app, 'Guest');
    const res = await claim(guest, v.body.token).expect(201);
    expect(res.body.source).toBe('open');
    expect(await spotsLeft(activityId)).toBe(8);

    const [event] = await eventsNamed(db, 'spot_claimed', { planId });
    expect(event.props).toMatchObject({ inviteType: 'vouch', inviteId: v.body.inviteId, source: 'open' });
  });

  it('released vouch with no open spots: 409 race_lost, nothing changes', async () => {
    const { activityId, bookerId, planId } = await bookedPlan(2, 1); // full: 0 left
    const v = await invite(bookerId, planId, 'vouch').expect(201);
    await db.pool.query(
      `UPDATE spots SET status = 'released' WHERE id = (SELECT spot_id FROM invites WHERE id = $1)`,
      [v.body.inviteId],
    );
    const guest = await createUser(app, 'Guest');
    expect((await claim(guest, v.body.token).expect(409)).body.reason).toBe('race_lost');
    expect(await spotsLeft(activityId)).toBe(0);

    const used = await db.pool.query(`SELECT used_at FROM invites WHERE id = $1`, [v.body.inviteId]);
    expect(used.rows[0].used_at).toBeNull();
  });

  it('one person cannot take two spots in the same activity', async () => {
    const { bookerId, planId } = await bookedPlan(10, 2);
    const v = await invite(bookerId, planId, 'vouch').expect(201);
    const p = await invite(bookerId, planId, 'public').expect(201);
    const guest = await createUser(app, 'Guest');
    await claim(guest, v.body.token).expect(201);
    await claim(guest, p.body.token).expect(409);
  });

  it('the booker cannot claim their own invite', async () => {
    const { bookerId, planId } = await bookedPlan(10, 1);
    const p = await invite(bookerId, planId, 'public').expect(201);
    await claim(bookerId, p.body.token).expect(400);
  });

  it('isNewUser is false for someone who has booked before', async () => {
    const earlier = await bookedPlan(10, 0);
    const { bookerId, planId } = await bookedPlan(10, 1);
    const p = await invite(bookerId, planId, 'public').expect(201);
    await claim(earlier.bookerId, p.body.token).expect(201);
    const [event] = await eventsNamed(db, 'spot_claimed', { planId });
    expect(event.props.isNewUser).toBe(false);
  });
});
