import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { DbService } from '../src/db/db.service.js';
import * as schema from '../src/db/schema.js';

const db = new DbService();
afterAll(() => db.onModuleDestroy());

// Postgres reports short type names (udt_name); map Drizzle's SQL type names onto them.
const UDT: Record<string, string> = {
  bigint: 'int8',
  integer: 'int4',
  smallint: 'int2',
  'timestamp with time zone': 'timestamptz',
};

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

describe('Drizzle schema matches the migrated database', () => {
  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))('%s', async (name, table) => {
    const { rows } = await db.pool.query<{ column_name: string; udt_name: string; is_nullable: string }>(
      `SELECT column_name, udt_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
      [name],
    );
    const inDb = rows.map((r) => ({ name: r.column_name, type: r.udt_name, notNull: r.is_nullable === 'NO' }));
    const inSchema = getTableConfig(table)
      .columns.map((c) => ({ name: c.name, type: UDT[c.getSQLType()] ?? c.getSQLType(), notNull: c.notNull }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(inSchema).toEqual(inDb);
  });
});
