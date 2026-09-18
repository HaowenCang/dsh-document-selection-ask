import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const repoRoot = fileURLToPath(new URL('./', import.meta.url))

/**
 * The build-time virtual modules and the PDF.js stand-in, as the specs see them.
 *
 * `tsdown.config.ts` produces `virtual:pdfjs-assets`,
 * `pdfjs-dist/build/pdf.worker.min.mjs?raw` and `virtual:dsa-xlsx-wasm-gzip` by
 * reading the installed packages at build time — several megabytes of text that
 * no spec assertion is about, and that Vite would otherwise transform for every
 * client spec. The aliases below substitute small, inspectable stand-ins, and the
 * **built artifact** is what the bundle specs assert against instead
 * (`tests/unit/client-bundle.spec.ts`, `tests/unit/pdf-bundle.spec.ts`,
 * `tests/unit/xlsx-bundle.spec.ts`).
 *
 * `pdfjs-dist` itself is aliased for the same reason plus one more: the PDF.js
 * the specs must drive is a controllable one, because the properties under test
 * are this plugin's decisions — which worker, what cleanup, which failure — and
 * the real library would need a module worker and a 2-D canvas context that jsdom
 * does not implement. The alias is exact, so a subpath import (which this project
 * never writes) would not be swallowed by it.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: 'virtual:pdfjs-assets', replacement: `${repoRoot}tests/client/helpers/pdf-embedded-assets.ts` },
      {
        find: 'pdfjs-dist/build/pdf.worker.min.mjs?raw',
        replacement: `${repoRoot}tests/client/helpers/pdf-worker-source.ts`,
      },
      {
        find: 'virtual:dsa-xlsx-wasm-gzip',
        replacement: `${repoRoot}tests/client/helpers/xlsx-wasm-payload.ts`,
      },
      { find: /^pdfjs-dist$/, replacement: `${repoRoot}tests/client/helpers/pdfjs-mock.ts` },
    ],
  },
  // Vite's esbuild transform does not read `jsx` from `tsconfig.client.json`, so
  // a spec's JSX would compile to `React.createElement` against a runtime this
  // project never makes global. Stating the automatic runtime here keeps the
  // specs compiling the same way the bundler compiles `src/`.
  esbuild: {
    jsx: 'automatic',
  },
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
