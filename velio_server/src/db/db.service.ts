import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrl } from '../env.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything queries can run on: the pool-backed client or an open transaction. */
export type Executor = Db | Tx;

@Injectable()
export class DbService implements OnModuleDestroy {
  /** Raw driver, for migrations and test setup. App code uses [orm]. */
  readonly pool = new pg.Pool({ connectionString: databaseUrl() });
  readonly orm: Db = drizzle(this.pool, { schema });

  /** Runs fn inside one transaction: commits on success, rolls back on any throw. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.orm.transaction(fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
