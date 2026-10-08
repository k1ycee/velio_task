import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { createApp, createUser, eventsNamed, newUserBody } from './helpers.js';

let app: INestApplication;
let db: DbService;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, db, http } = await createApp()));
afterAll(() => app.close());

describe('POST /users', () => {
  it('creates a user', async () => {
    const res = await http().post('/users').send(newUserBody()).expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('returns the existing user when the phone matches, even with a new email', async () => {
    const body = newUserBody();
    const first = await http().post('/users').send(body).expect(201);
    const again = await http()
      .post('/users')
      .send({ ...body, email: `other${Date.now()}@test.com` })
      .expect(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('returns the existing user when the email matches, case-insensitively', async () => {
    const body = newUserBody();
    const first = await http().post('/users').send(body).expect(201);
    const again = await http()
      .post('/users')
      .send({ ...body, phone: `+9${Date.now()}`, email: body.email.toUpperCase() })
      .expect(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('rejects "+" email aliases', async () => {
    await http()
      .post('/users')
      .send({ ...newUserBody(), email: 'john+me@gmail.com' })
      .expect(400);
  });

  it('rejects missing fields', async () => {
    await http().post('/users').send({ name: 'x' }).expect(400);
  });
});

describe('activities', () => {
  it('requires X-User-Id', async () => {
    await http().post('/activities').send({ title: 't', startsAt: new Date().toISOString(), capacity: 2 }).expect(401);
  });

  it('creates an activity with spots_left = capacity and emits activity_created', async () => {
    const hostId = await createUser(app, 'Host');
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await http()
      .post('/activities')
      .set('X-User-Id', hostId)
      .send({ title: 'Sunset Kayaking', startsAt, capacity: 10 })
      .expect(201);
    expect(res.body).toMatchObject({ title: 'Sunset Kayaking', capacity: 10, spotsLeft: 10, version: 0 });

    const avail = await http().get(`/activities/${res.body.id}/availability`).expect(200);
    expect(avail.body).toEqual({ spotsLeft: 10, version: 0 });

    const [event] = await eventsNamed(db, 'activity_created', { activityId: res.body.id });
    expect(event).toMatchObject({ user_id: hostId, props: { capacity: 10, startsAt } });
  });

  it('lists activities', async () => {
    const hostId = await createUser(app, 'Host');
    const created = await http()
      .post('/activities')
      .set('X-User-Id', hostId)
      .send({ title: 'Speakeasy', startsAt: new Date(Date.now() + 3_600_000).toISOString(), capacity: 4 })
      .expect(201);
    const list = await http().get('/activities').expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(created.body.id);
  });

  it('rejects a past start time or non-positive capacity', async () => {
    const hostId = await createUser(app, 'Host');
    await http()
      .post('/activities')
      .set('X-User-Id', hostId)
      .send({ title: 'x', startsAt: new Date(Date.now() - 1000).toISOString(), capacity: 2 })
      .expect(400);
    await http()
      .post('/activities')
      .set('X-User-Id', hostId)
      .send({ title: 'x', startsAt: new Date(Date.now() + 1000_000).toISOString(), capacity: 0 })
      .expect(400);
  });

  it('returns 400 (not 500) for an X-User-Id that does not exist', async () => {
    await http()
      .post('/activities')
      .set('X-User-Id', '999999999')
      .send({ title: 'x', startsAt: new Date(Date.now() + 1000_000).toISOString(), capacity: 2 })
      .expect(400);
  });

  it('404s availability for an unknown activity', async () => {
    await http().get('/activities/999999999/availability').expect(404);
  });
});

describe('GET /users/me/activities', () => {
  async function activity(hostId: string, title: string, hoursAway: number) {
    const res = await http()
      .post('/activities')
      .set('X-User-Id', hostId)
      .send({ title, startsAt: new Date(Date.now() + hoursAway * 3_600_000).toISOString(), capacity: 6 })
      .expect(201);
    return res.body.id as string;
  }

  it('lists the activities I booked or claimed, soonest first, with who booked them', async () => {
    const host = await createUser(app, 'Host');
    const bo = await createUser(app, 'Bo');
    const gia = await createUser(app, 'Gia');
    const later = await activity(host, 'Later', 72);
    const sooner = await activity(host, 'Sooner', 24);
    const notMine = await activity(host, 'Not mine', 48);

    await http().post('/bookings').set('X-User-Id', gia).send({ activityId: later, heldSpots: 0 }).expect(201);
    const plan = await http().post('/bookings').set('X-User-Id', bo).send({ activityId: sooner, heldSpots: 1 }).expect(201);
    await http().post('/bookings').set('X-User-Id', bo).send({ activityId: notMine, heldSpots: 1 }).expect(201);
    const vouch = await http()
      .post(`/plans/${plan.body.planId}/invites`)
      .set('X-User-Id', bo)
      .send({ type: 'vouch', label: 'Gia' })
      .expect(201);
    await http().post(`/invites/${vouch.body.token}/claim`).set('X-User-Id', gia).send({}).expect(201);

    const res = await http().get('/users/me/activities').set('X-User-Id', gia).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ role: 'guest', bookerName: 'Bo', activity: expect.objectContaining({ id: sooner, title: 'Sooner' }) }),
      expect.objectContaining({ role: 'booker', bookerName: 'Gia', activity: expect.objectContaining({ id: later, title: 'Later' }) }),
    ]);
    expect(res.body[0].activity.startsAt).toEqual(expect.any(String));
  });

  it('is empty for a new user and needs X-User-Id', async () => {
    const nobody = await createUser(app, 'Nobody');
    await http().get('/users/me/activities').set('X-User-Id', nobody).expect(200, []);
    await http().get('/users/me/activities').expect(401);
  });
});
