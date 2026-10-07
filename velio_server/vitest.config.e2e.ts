import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { TEST_DATABASE_URL } from './test/global-setup.js';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // One file at a time: tests share one database, and the dashboard test checks exact totals.
    fileParallelism: false,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
