/**
 * The build's embedded PDF.js worker source, as the specs see it.
 *
 * `tsdown.config.ts` produces this module by reading
 * `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` and embedding its text. A
 * spec that imported the real thing would carry a 1.3 MB string through Vite's
 * transform for every client spec, and no assertion here is about the worker's
 * contents — the bundle's own contents are asserted against the built artifact in
 * `tests/unit/client-bundle.spec.ts`.
 *
 * What matters to the runtime is only that the source is a non-empty string that
 * `URL.createObjectURL` receives, so this stands in for it.
 */

export const TEST_WORKER_SOURCE = '/* dsa test worker: the real source is embedded by the build */'

export default TEST_WORKER_SOURCE
