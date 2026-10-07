import { INestApplication } from '@nestjs/common';
import { createApp, createUser } from './helpers.js';

let app: INestApplication;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, http } = await createApp()));
afterAll(() => app.close());

async function setup() {
  const hostId = await createUser(app, 'Host');
  const activity = await http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Sunset Kayaking', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity: 10 })
    .expect(201);
  const bookerId = await createUser(app, 'Booker');
  const booking = await http()
    .post('/bookings')
    .set('X-User-Id', bookerId)
    .send({ activityId: activity.body.id, heldSpots: 2 })
    .expect(201);
  return { activityId: activity.body.id as string, bookerId, planId: booking.body.planId as string };
}

describe('GET /plans/:id', () => {
  it('shows the booker the activity, countdown, members, held spots and invites', async () => {
    const { activityId, bookerId, planId } = await setup();
    const vouch = await http()
      .post(`/plans/${planId}/invites`)
      .set('X-User-Id', bookerId)
      .send({ type: 'vouch', label: 'Ada' })
      .expect(201);
    const ada = await createUser(app, 'Ada');
    await http().post(`/invites/${vouch.body.token}/claim`).set('X-User-Id', ada).send({}).expect(201);
    await http().post(`/plans/${planId}/invites`).set('X-User-Id', bookerId).send({ type: 'public' }).expect(201);

    const res = await http().get(`/plans/${planId}`).set('X-User-Id', bookerId).expect(200);
    expect(res.body).toMatchObject({
      id: planId,
      bookerId,
      activity: { id: activityId, title: 'Sunset Kayaking', spotsLeft: 7 },
      heldSpotsLeft: 1,
      members: [
        { userId: bookerId, name: 'Booker', role: 'booker' },
        { userId: ada, name: 'Ada', role: 'guest', inviteType: 'vouch' },
      ],
    });
    expect(res.body.holdExpiresAt).toBeDefined();
    expect(res.body.holdStartedAt).toBeDefined();
    expect(res.body.invites).toEqual([
      expect.objectContaining({ type: 'vouch', label: 'Ada', used: true, url: `velio://invite/${vouch.body.token}` }),
      expect.objectContaining({ type: 'public', used: false }),
    ]);
  });

  it('is only visible to the booker', async () => {
    const { planId } = await setup();
    const stranger = await createUser(app, 'Stranger');
    await http().get(`/plans/${planId}`).set('X-User-Id', stranger).expect(403);
  });
});

describe('GET /plans', () => {
  it("lists the caller's plans, newest first", async () => {
    const { bookerId, planId } = await setup();
    const res = await http().get('/plans').set('X-User-Id', bookerId).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ id: planId, activity: expect.objectContaining({ title: 'Sunset Kayaking' }) })]);
  });
});

describe('GET /users', () => {
  it('lists users for the identity picker', async () => {
    const id = await createUser(app, 'Picker');
    const res = await http().get('/users').expect(200);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id, name: 'Picker' })]));
    expect(res.body[0]).not.toHaveProperty('phone'); // no contact details in a public list
  });
});
