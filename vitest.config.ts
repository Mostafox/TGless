import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'examples/*/test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
