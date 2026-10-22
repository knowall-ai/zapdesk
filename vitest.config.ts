import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Node by default: most tests here are pure functions and route handlers,
    // and a DOM for those is only overhead. A component test opts in with
    // `// @vitest-environment jsdom` at the top of the file, which keeps the
    // choice next to the test that needs it rather than in a glob here.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
