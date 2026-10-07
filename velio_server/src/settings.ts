import pg from 'pg';

/** Settings live in Postgres so they change without a redeploy (e.g. new_user_cap). */
export async function readSetting<T>(c: pg.Pool | pg.PoolClient, key: string): Promise<T> {
  const { rows } = await c.query<{ value: T }>(`SELECT value FROM settings WHERE key = $1`, [key]);
  if (!rows[0]) throw new Error(`missing setting ${key}`);
  return rows[0].value;
}
