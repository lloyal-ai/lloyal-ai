import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.tsx` too: the wizard's own rows render components, and ink-testing-library needs JSX.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: true,
  },
});
