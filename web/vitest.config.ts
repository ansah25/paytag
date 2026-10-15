import { defineConfig } from 'vitest/config';

// Unit tests for pure logic (lib/**). UI is exercised in the browser, not here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
