import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { databaseUrl } from '../src/env.js';

const TEST_DB = 'velio_test';
const ADMIN_URL = databaseUrl();
// Same server and credentials as the dev database (from .env), different database.
export const TEST_DATABASE_URL = Object.assign(new URL(ADMIN_URL), { pathname: `/${TEST_DB}` }).toString();

// Recreates a throwaway velio_test database before the e2e run.
export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  await migrate(TEST_DATABASE_URL);
}
