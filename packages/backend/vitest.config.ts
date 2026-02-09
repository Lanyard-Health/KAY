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
    isolate: true,
    restoreMocks: true,
    testTimeout: 10000,
  },
});
