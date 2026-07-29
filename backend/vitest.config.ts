import { defineConfig, configDefaults } from 'vitest/config';

// Unit tests only — fast, no DB. Integration tests (*.integration.test.ts) run via
// vitest.integration.config.ts (`npm run test:integration`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    globals: false,
  },
});
