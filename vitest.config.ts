import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.ts', 'tests/client/**/*.spec.ts', 'tests/client/**/*.spec.tsx'],
    exclude: ['tests/browser/**', 'node_modules/**', 'lib/**'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    // Specs that assert on the built bundles need them to exist, so the build
    // runs once before the suite rather than relying on the caller's order.
    globalSetup: ['tests/setup/build-artifacts.ts'],
  },
})
