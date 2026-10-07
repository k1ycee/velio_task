import pg from 'pg';
import { DEFAULT_DATABASE_URL, migrate } from '../src/db/migrate.js';

const TEST_DB = 'velio_test';
export const TEST_DATABASE_URL = DEFAULT_DATABASE_URL.replace(/\/velio$/, `/${TEST_DB}`);

// Recreates a throwaway velio_test database before the e2e run.
export default async function setup() {
  const admin = new pg.Client({ connectionString: DEFAULT_DATABASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await migrate(TEST_DATABASE_URL);
}
