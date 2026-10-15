import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Rendering tests for the screens.
 *
 * They run the real components against the real payloads the API returns, in
 * `react-dom/server`. That is deliberately not a browser: what these catch is
 * the class of failure a typechecker cannot — a chart dividing by a zero-length
 * array, an optional field read without a guard, a `toFixed` on a null — on
 * payloads whose exact shape (an empty series, a single point, a day with fewer
 * doses than the widest day) is what actually turns up in practice.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.tsx'],
    environment: 'node',
  },
});
