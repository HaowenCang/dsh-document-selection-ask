/**
 * The PDF.js worker source this bundle carries.
 *
 * The virtual module id below is produced by `tsdown.config.ts`, which reads
 * `pdfjs-dist/build/pdf.worker.min.mjs` from the installed package and embeds its
 * text. The indirection exists for one reason: an import of a **virtual** id
 * cannot be given a specifier a spec can stub, so the mapping lives in this one
 * file and the runtime reaches the value through it.
 *
 * The worker and the API must come from the same PDF.js version — the worker's
 * message protocol is not stable across releases — which is why the version is
 * pinned exactly in `package.json` and both halves are read from that one
 * installed package by the same build.
 */

import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'

/**
 * The complete `pdf.worker.min.mjs` module source.
 *
 * It is a module, not a classic worker script, so the runtime starts it with
 * `new Worker(url, { type: 'module' })`.
 */
export const PDF_WORKER_SOURCE: string = workerSource
