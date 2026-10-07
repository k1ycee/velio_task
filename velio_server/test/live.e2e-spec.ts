import { INestApplication } from '@nestjs/common';
import { DbService } from '../src/db/db.service.js';
import { ExpiryService } from '../src/expiry/expiry.service.js';
import { createApp, createUser, eventsNamed } from './helpers.js';

interface Availability {
  activityId: string;
  spotsLeft: number;
  version: number;
  committedAt: string | null;
}

/** Minimal SSE reader over fetch: collects `data:` messages, skips named events (pings). */
async function openStream(baseUrl: string, activityId: string | null) {
  const res = await fetch(`${baseUrl}/activities/${activityId === null ? '' : `${activityId}/`}stream`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const queue: Availability[] = [];
  let buf = '';
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n');
        buf = buf.slice(i + 2);
        const data = lines.find((l) => l.startsWith('data:'));
        if (data && !lines.some((l) => l.startsWith('event:'))) queue.push(JSON.parse(data.slice(5)));
      }
    }
  })().catch(() => undefined);

  return {
    async next(timeoutMs = 2000): Promise<Availability> {
      const deadline = Date.now() + timeoutMs;
      while (!queue.length) {
        if (Date.now() > deadline) throw new Error(`no SSE message within ${timeoutMs}ms`);
        await new Promise((r) => setTimeout(r, 20));
      }
      return queue.shift()!;
    },
    close: () => reader.cancel(),
  };
}

let a: Awaited<ReturnType<typeof createApp>>;
let b: Awaited<ReturnType<typeof createApp>>;
let urlA: string;
let urlB: string;

const baseUrl = async (app: INestApplication) => {
  await app.listen(0);
  return (await app.getUrl()).replace('[::1]', 'localhost');
};

beforeAll(async () => {
  [a, b] = await Promise.all([createApp(), createApp()]);
  [urlA, urlB] = await Promise.all([baseUrl(a.app), baseUrl(b.app)]);
});
afterAll(() => Promise.all([a.app.close(), b.app.close()]));

async function newActivity(capacity: number) {
  const hostId = await createUser(a.app, 'Host');
  const res = await a
    .http()
    .post('/activities')
    .set('X-User-Id', hostId)
    .send({ title: 'Live', startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), capacity })
    .expect(201);
  return res.body.id as string;
}

const book = async (activityId: string, heldSpots = 0) => {
  const bookerId = await createUser(a.app, 'Booker');
  return (
    await a.http().post('/bookings').set('X-User-Id', bookerId).send({ activityId, heldSpots }).expect(201)
  ).body as { planId: string };
};

describe('GET /activities/:id/stream', () => {
  it('sends a snapshot, then the committed count after a booking, within 2s', async () => {
    const activityId = await newActivity(10);
    const stream = await openStream(urlA, activityId);
    try {
      expect(await stream.next()).toMatchObject({ activityId, spotsLeft: 10, version: 0, committedAt: null });

      const started = Date.now();
      await book(activityId, 2);
      const update = await stream.next();
      expect(update).toMatchObject({ activityId, spotsLeft: 7, version: 1 });
      expect(update.committedAt).not.toBeNull();
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await stream.close();
    }
  });

  it('fans out through Redis: a booking on instance A reaches a client on instance B', async () => {
    const activityId = await newActivity(5);
    const stream = await openStream(urlB, activityId);
    try {
      await stream.next(); // snapshot
      await book(activityId); // goes through instance A
      expect(await stream.next()).toMatchObject({ activityId, spotsLeft: 4, version: 1 });
    } finally {
      await stream.close();
    }
  });

  it('publishes open-pool claims and expiry releases', async () => {
    const activityId = await newActivity(10);
    const stream = await openStream(urlA, activityId);
    try {
      await stream.next(); // snapshot
      const bookerId = await createUser(a.app, 'Booker');
      const booking = await a
        .http()
        .post('/bookings')
        .set('X-User-Id', bookerId)
        .send({ activityId, heldSpots: 1 })
        .expect(201);
      expect((await stream.next()).spotsLeft).toBe(8);

      const pub = await a
        .http()
        .post(`/plans/${booking.body.planId}/invites`)
        .set('X-User-Id', bookerId)
        .send({ type: 'public' })
        .expect(201);
      for (const name of ['G1', 'G2']) {
        const g = await createUser(a.app, name);
        await a.http().post(`/invites/${pub.body.token}/claim`).set('X-User-Id', g).send({}).expect(201);
      }
      // G1 took the held spot (no count change, no message); G2 took an open spot.
      expect(await stream.next()).toMatchObject({ spotsLeft: 7, version: 2 });

      const booking2 = await book(activityId, 2);
      expect((await stream.next()).spotsLeft).toBe(4);
      await a.db.pool.query(`UPDATE plans SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        booking2.planId,
      ]);
      await a.app.get(ExpiryService).releaseExpiredHolds();
      expect(await stream.next()).toMatchObject({ spotsLeft: 6 });
    } finally {
      await stream.close();
    }
  });

  it('GET /activities/stream carries updates for every activity on one connection', async () => {
    const first = await newActivity(4);
    const second = await newActivity(6);
    const stream = await openStream(urlB, null);
    try {
      await book(first);
      await book(second, 1);
      // Other test files publish on the same Redis, so skip their activities.
      const got: Availability[] = [];
      const deadline = Date.now() + 2000;
      while (got.length < 2) {
        const msg = await stream.next(Math.max(1, deadline - Date.now()));
        if (msg.activityId === first || msg.activityId === second) got.push(msg);
      }
      expect(got).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ activityId: first, spotsLeft: 3 }),
          expect.objectContaining({ activityId: second, spotsLeft: 4 }),
        ]),
      );
    } finally {
      await stream.close();
    }
  });

  it('404s an unknown activity', async () => {
    const res = await fetch(`${urlA}/activities/999999999/stream`);
    expect(res.status).toBe(404);
  });
});

describe('POST /events', () => {
  it('stores availability_received with latency corrected for client clock drift', async () => {
    const activityId = await newActivity(3);
    const committedAt = new Date(Date.now() - 300); // server committed 300ms ago
    const skew = 60_000; // client clock runs a minute fast
    const clientReceivedAt = new Date(Date.now() - 100 + skew);
    const clientSentAt = new Date(Date.now() + skew);

    await a
      .http()
      .post('/events')
      .send({
        name: 'availability_received',
        activityId,
        props: { version: 1, committedAt, clientReceivedAt, clientSentAt },
      })
      .expect(201);

    const [event] = await eventsNamed(a.db as DbService, 'availability_received', { activityId });
    expect(event.props.latencyMs).toBeGreaterThanOrEqual(150);
    expect(event.props.latencyMs).toBeLessThan(450);
  });

  it('only accepts client-reportable event names', async () => {
    await a.http().post('/events').send({ name: 'spot_claimed', props: {} }).expect(400);
  });
});
