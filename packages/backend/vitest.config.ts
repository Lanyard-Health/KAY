import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/helpers/setup.ts'],
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      'tests/schema-drift.test.ts',
      'node_modules/**',
    ],
    isolate: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
