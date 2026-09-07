import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 3000 },
  test: {
    // Unit tests run in-process; API tests need the built server (global setup seeds and boots it).
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] }
      },
      {
        extends: true,
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          testTimeout: 60000,
          hookTimeout: 180000,
          globalSetup: ['tests/global-setup.ts'],
          fileParallelism: false
        }
      }
    ]
  }
});
