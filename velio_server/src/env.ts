import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// npm runs (dev server, migrations, tests) read the repo-root .env; Docker passes real environment
// variables and has no file. Values already in the environment always win.
const file = ['.env', '../.env'].find((f) => existsSync(f));
if (file) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) process.env[key] ??= value;
}

/** The database connection string. There is deliberately no default: credentials never live in code. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.');
  return url;
}
