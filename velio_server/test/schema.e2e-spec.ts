import { eq } from 'drizzle-orm';
import { DbService } from '../src/db/db.service.js';
import { activities } from '../src/db/schema.js';

const db = new DbService();

afterAll(() => db.onModuleDestroy());

async function seedActivity(capacity = 2) {
  const host = await db.pool.query<{ id: string }>(
    `INSERT INTO users (name, phone, email) VALUES ('Host', $1, $2) RETURNING id`,
    [`+1${Date.now()}${Math.random()}`, `h${Date.now()}${Math.random()}@x.com`],
  );
  const act = await db.pool.query<{ id: string }>(
    `INSERT INTO activities (host_id, title, starts_at, capacity, spots_left)
     VALUES ($1, 'Kayak', now() + interval '1 day', $2, $2) RETURNING id`,
    [host.rows[0].id, capacity],
  );
  return act.rows[0].id;
}

describe('schema', () => {
  it('rejects negative spots_left (oversell guard)', async () => {
    const id = await seedActivity();
    await expect(
      db.pool.query(`UPDATE activities SET spots_left = -1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects spots_left above capacity', async () => {
    const id = await seedActivity(2);
    await expect(
      db.pool.query(`UPDATE activities SET spots_left = 3 WHERE id = $1`, [id]),
    ).rejects.toThrow(/check constraint/);
  });

  it('enforces unique phone and unique email independently', async () => {
    await db.pool.query(
      `INSERT INTO users (name, phone, email) VALUES ('A', '+100', 'a@x.com')
       ON CONFLICT DO NOTHING`,
    );
    await expect(
      db.pool.query(`INSERT INTO users (name, phone, email) VALUES ('B', '+100', 'b@x.com')`),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      db.pool.query(`INSERT INTO users (name, phone, email) VALUES ('C', '+101', 'a@x.com')`),
    ).rejects.toThrow(/duplicate key/);
  });

  it('seeds new_user_cap = 2', async () => {
    const r = await db.pool.query(`SELECT value FROM settings WHERE key = 'new_user_cap'`);
    expect(r.rows[0].value).toBe(2);
  });

  it('tx() rolls back everything when the callback throws', async () => {
    const id = await seedActivity(2);
    await expect(
      db.tx(async (tx) => {
        await tx.update(activities).set({ spotsLeft: 1 }).where(eq(activities.id, id));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const r = await db.pool.query(`SELECT spots_left FROM activities WHERE id = $1`, [id]);
    expect(r.rows[0].spots_left).toBe(2);
  });
});
