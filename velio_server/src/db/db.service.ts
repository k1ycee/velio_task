import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { DEFAULT_DATABASE_URL } from './migrate.js';

// BIGINT ids come back as strings by default; keep them strings (ids can exceed 2^53).
// INT columns (spots_left, capacity) already parse to numbers.

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });

  /** Runs fn inside one transaction: commits on success, rolls back on any throw. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
