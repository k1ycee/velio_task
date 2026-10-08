import { eq } from 'drizzle-orm';
import type { Executor } from './db/db.service.js';
import { settings } from './db/schema.js';

/** Settings live in Postgres so they change without a redeploy (e.g. new_user_cap). */
export async function readSetting<T>(db: Executor, key: string): Promise<T> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  if (!row) throw new Error(`missing setting ${key}`);
  return row.value as T;
}
