/**
 * Build-time synthesis of the XLSX client runtime's two embedded assets.
 *
 * ## Why this module exists at all
 *
 * `@extend-ai/react-xlsx` parses workbooks with a 4.4 MB WebAssembly engine that
 * ships beside its JavaScript, and with a worker bundle it constructs from a
 * document-relative URL. Neither can be delivered to an external DSH client
 * plugin as a **file**: DSH serves a plugin's browser half as exactly one
 * generated script, through a closed response table, and exposes no API by which
 * a plugin may contribute a second one. The host route an earlier revision
 * registered for the purpose made the browser runtime depend on a host service,
 * which the frozen client-only design forbids.
 *
 * What remains is the engine and the worker **inside the one bundle**. The engine
 * is the narrow, authorised exception: the exact installed WASM bytes,
 * deterministically gzipped, base64-encoded, and inflated and SHA-256 verified in
 * the browser on first use. The raw uncompressed binary is not base64-embedded —
 * that representation stays forbidden — and the worker source is a full
 * JavaScript module with no import of any kind, so nothing it contains is
 * resolved against the document or the network.
 *
 * ## This module is a build gate, not a helper
 *
 * Every claim it makes about the installed dependency is asserted, and every
 * assertion throws. A renamed symbol, a reformatted release, a re-compressed
 * binary or an upstream layout change fails the build with a named reason rather
 * than emitting a bundle that silently lacks an engine or a worker:
 *
 * - `XLSX WASM IDENTITY CHANGED` — the installed binary is not the reviewed one,
 *   or the pinned package version moved.
 * - `XLSX WASM COMPRESSION REGRESSION` — the compressed payload grew past the
 *   bound that keeps it from drifting back toward the forbidden representation.
 * - `XLSX RUNTIME SHAPE CHANGED` — a literal this module rewrites did not occur
 *   exactly as many times as it is claimed to.
 *
 * The module reads the installed package; it writes nothing, patches no
 * `node_modules` file, and emits no asset. `tests/unit/xlsx-bundle.spec.ts`
 * asserts both the values below and the built artifact they produce.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** The package the engine and the worker come from. */
export const XLSX_WASM_PACKAGE = '@extend-ai/react-xlsx'

/** The exact version this build is written against. */
export const XLSX_WASM_PACKAGE_VERSION = '0.16.4'

/** The public subpath that package publishes the engine binary under. */
export const XLSX_WASM_SUBPATH = 'dist/duke_sheets_wasm_bg.wasm'

/** The exact byte length of the reviewed engine binary. */
export const XLSX_WASM_RAW_BYTES_EXPECTED = 4_412_299

/** The SHA-256 of the reviewed engine binary, lowercase hex. */
export const XLSX_WASM_SHA256_EXPECTED =
  '24687a3e6d051689d7ff0fdde5148ff527744100d4fd70efa3d1580a05e6ef3d'

/**
 * The bound on the deterministic gzip payload.
 *
 * Measured at 1,674,037 bytes for this dependency. The bound is not that number:
 * a compressor's minor implementation can move the output by a handful of bytes,
 * and a fragile exact gate would fail a legitimate toolchain update while saying
 * nothing about the property that matters. What it does catch is a regression
 * toward the representation this architecture forbids — the raw binary base64 is
 * 5,883,068 characters, so a payload anywhere near it is a build that stopped
 * compressing.
 */
export const XLSX_WASM_GZIP_MAX_BYTES = 1_800_000

/** The bound on the base64 representation of that gzip payload. */
export const XLSX_WASM_BASE64_MAX_CHARS = 2_400_000

/** The gzip level the payload is produced at. */
export const XLSX_WASM_GZIP_LEVEL = 9

/** The host names an OOXML namespace identifier may use: they are names, not addresses. */
const XML_NAMESPACE_HOSTS: readonly string[] = [
  'schemas.openxmlformats.org',
  'schemas.microsoft.com',
  'www.w3.org',
  'purl.org',
]

/** The exact call `@extend-ai/react-xlsx` constructs its worker with. */
export const XLSX_WORKER_CONSTRUCTION =
  'new Worker(new URL("./xlsx-worker.js", import.meta.url), { type: "module" })'

/**
 * The worker construction the client bundle is built with instead.
 *
 * The rewritten expression has to be the **whole** construction, not its
 * argument: the helper returns a constructed `Worker`, and leaving the library's
 * own `new Worker(...)` around it would construct a worker from a worker —
 * `new Worker(workerObject)` stringifies its argument, so the browser would fetch
 * `[object Worker]` relative to the document, fail that request, and leave the
 * workbook unparsed. That is what the first live run of this architecture
 * produced, and the bundle spec now asserts the exact rewritten call site.
 */
export const XLSX_WORKER_REPLACEMENT = '__dsa_xlsx_create_worker__()'

/** The dynamic import the library loads its engine module through. */
export const XLSX_WORKER_DUKE_IMPORT = 'import("@dukelib/sheets-wasm")'

/** The library worker's source map comment, which names a file this package does not ship. */
export const XLSX_WORKER_SOURCE_MAP_COMMENT = '//# sourceMappingURL=xlsx-worker.js.map'

/**
 * The library worker's three `fflate` imports, each replaced by a destructuring of
 * the inlined copy.
 *
 * Stated as exact literals rather than a pattern for the same reason the client
 * runtime's rewrite is: the replacement is a claim about the dependency's shape,
 * and `String.prototype.replace` returns its input unchanged when the claim stops
 * being true.
 */
export const XLSX_WORKER_FFLATE_IMPORTS: ReadonlyArray<readonly [string, string]> = [
  [
    'import { strFromU8 as strFromU83, unzipSync as unzipSync2 } from "fflate";',
    'const { strFromU8: strFromU83, unzipSync: unzipSync2 } = __dsa_fflate__;',
  ],
  [
    'import { strFromU8, strToU8 } from "fflate";',
    'const { strFromU8, strToU8 } = __dsa_fflate__;',
  ],
  [
    'import { strFromU8 as strFromU82, strToU8 as strToU82, unzipSync, zipSync } from "fflate";',
    'const { strFromU8: strFromU82, strToU8: strToU82, unzipSync, zipSync } = __dsa_fflate__;',
  ],
]

/** The `fflate` entry points the worker binds, in the order the namespace returns them. */
const FFLATE_BINDINGS: readonly string[] = [
  'strFromU8',
  'strToU8',
  'unzipSync',
  'zipSync',
  'gzipSync',
  'gunzipSync',
  'inflateSync',
  'deflateSync',
]

/** The sources the build reads out of the installed packages. */
interface XlsxRuntimeSources {
  /** The installed `@extend-ai/react-xlsx` directory. */
  readonly packageDir: string
  /** The installed package version, read from its own manifest. */
  readonly packageVersion: string
  /** The exact engine binary. */
  readonly rawWasm: Buffer
  /** The library's worker module, `dist/xlsx-worker.js`. */
  readonly workerModule: string
  /** The `fflate` ESM browser build. */
  readonly fflateModule: string
  /** The Duke engine's JavaScript glue, with its module syntax removed. */
  readonly dukeGlue: string
}

/**
 * Everything the client bundle and its banner need.
 *
 * Produced once per build. Every field is derived from the installed packages and
 * from nothing else, so two builds of the same dependency bytes produce the same
 * values.
 */
export interface XlsxRuntimeAssets {
  /** The engine package's name. */
  readonly packageName: string
  /** The engine package's exact installed version. */
  readonly packageVersion: string
  /** The public subpath the binary is published at, recorded for provenance. */
  readonly wasmSubpath: string
  /** The exact engine byte length. */
  readonly rawBytes: number
  /** The engine's SHA-256, lowercase hex. */
  readonly sha256: string
  /** The deterministic gzip payload's length. */
  readonly gzipBytes: number
  /** The base64 payload's length in characters. */
  readonly gzipBase64Chars: number
  /** The deterministic gzip payload, base64-encoded: what the bundle carries. */
  readonly gzipBase64: string
  /** The self-contained worker module source. */
  readonly workerSource: string
  /** The worker source's length in characters. */
  readonly workerSourceChars: number
  /** The inlined Duke engine glue, for the bundle banner's main-thread copy. */
  readonly dukeGlue: string
  /** The inlined Duke glue's length in characters. */
  readonly dukeGlueChars: number
}

/**
 * Fail the build with a named reason.
 *
 * The reason strings are part of the contract: a build log that says only
 * "assertion failed" leaves the operator to work out whether a dependency moved
 * or the bundler did.
 *
 * @param reason - the stable reason label.
 * @param detail - what was expected and what was found.
 * @returns never.
 */
function failBuild(reason: string, detail: string): never {
  throw new Error(`dsa-xlsx-runtime-assets: ${reason}: ${detail}`)
}

/**
 * Replace one exact literal, refusing anything but a single occurrence.
 *
 * @param source - the module source being transformed.
 * @param needle - the exact literal to replace.
 * @param replacement - what to replace it with.
 * @param label - how to describe the literal in a failure message.
 * @returns the transformed source.
 */
function replaceExactlyOnce(
  source: string,
  needle: string,
  replacement: string,
  label: string,
): string {
  const occurrences = source.split(needle).length - 1
  if (occurrences !== 1) {
    failBuild(
      'XLSX RUNTIME SHAPE CHANGED',
      `expected exactly one occurrence of ${label}, found ${occurrences}`,
    )
  }
  return source.replace(needle, replacement)
}

/**
 * Remove a module's own `export` statements while keeping every declaration.
 *
 * Only the three forms the ecosystem's bundlers emit are handled — `export
 * function`, `export var` and a single-line `export { … };` — and the count is
 * asserted in both directions: a statement form this function cannot process
 * fails the build rather than surviving into a worker whose syntax is then
 * invalid.
 *
 * @param source - the module source.
 * @param label - how to describe the module in a failure message.
 * @returns the source with no top-level `export` statement.
 */
function stripModuleExports(source: string, label: string): string {
  const lines = source.split('\n')
  let stripped = 0
  const out = lines.map((line) => {
    if (line.startsWith('export function ')) {
      stripped += 1
      return line.slice('export '.length)
    }
    if (line.startsWith('export var ')) {
      stripped += 1
      return line.slice('export '.length)
    }
    if (/^export \{[^}]*\};?$/.test(line)) {
      stripped += 1
      return ''
    }
    return line
  })

  const declared = lines.filter((line) => line.startsWith('export ')).length
  if (stripped !== declared) {
    failBuild(
      'XLSX RUNTIME SHAPE CHANGED',
      `${label} carries ${declared} top-level export statements but only ${stripped} ` +
        'were in a form this build rewrites',
    )
  }

  const remaining = out.filter((line) => /^\s*export\b/.test(line))
  if (remaining.length > 0) {
    failBuild(
      'XLSX RUNTIME SHAPE CHANGED',
      `${label} still carries ${remaining.length} export statements after the rewrite`,
    )
  }
  return out.join('\n')
}

/**
 * Read the exact installed engine binary and verify its identity.
 *
 * The filename is not the gate. A package that publishes the same file name with
 * different bytes — a re-published patch, a corrupted install, a substituted
 * tarball — has to fail here, before anything is compressed or bundled, because
 * the runtime's own integrity check would otherwise agree with whatever this
 * build embedded.
 *
 * @param sources - the installed sources.
 * @returns nothing; throws when the identity differs.
 */
function assertEngineIdentity(sources: XlsxRuntimeSources): void {
  if (sources.packageVersion !== XLSX_WASM_PACKAGE_VERSION) {
    failBuild(
      'XLSX WASM IDENTITY CHANGED',
      `installed ${XLSX_WASM_PACKAGE} is ${sources.packageVersion}, this build is written ` +
        `against ${XLSX_WASM_PACKAGE_VERSION}`,
    )
  }
  if (sources.rawWasm.byteLength !== XLSX_WASM_RAW_BYTES_EXPECTED) {
    failBuild(
      'XLSX WASM IDENTITY CHANGED',
      `${XLSX_WASM_SUBPATH} is ${sources.rawWasm.byteLength} bytes, expected ` +
        `${XLSX_WASM_RAW_BYTES_EXPECTED}`,
    )
  }
  const sha256 = createHash('sha256').update(sources.rawWasm).digest('hex')
  if (sha256 !== XLSX_WASM_SHA256_EXPECTED) {
    failBuild(
      'XLSX WASM IDENTITY CHANGED',
      `${XLSX_WASM_SUBPATH} hashes to ${sha256}, expected ${XLSX_WASM_SHA256_EXPECTED}`,
    )
  }
}

/**
 * Compress the exact engine bytes deterministically and bound the result.
 *
 * `gzipSync` writes a zero MTIME and no file name, so the payload is a function
 * of the dependency bytes and the compressor alone — the property that lets the
 * same dependency produce the same bundle twice.
 *
 * @param rawWasm - the verified engine binary.
 * @returns the payload and its measured sizes.
 */
function compressEngine(rawWasm: Buffer): {
  gzipBytes: number
  gzipBase64Chars: number
  gzipBase64: string
} {
  const gzip = gzipSync(rawWasm, { level: XLSX_WASM_GZIP_LEVEL })
  if (gzip.byteLength > XLSX_WASM_GZIP_MAX_BYTES) {
    failBuild(
      'XLSX WASM COMPRESSION REGRESSION',
      `the gzip payload is ${gzip.byteLength} bytes, over the ${XLSX_WASM_GZIP_MAX_BYTES} ` +
        'byte bound; a payload this size is not compressing',
    )
  }
  const gzipBase64 = gzip.toString('base64')
  if (gzipBase64.length > XLSX_WASM_BASE64_MAX_CHARS) {
    failBuild(
      'XLSX WASM COMPRESSION REGRESSION',
      `the base64 payload is ${gzipBase64.length} characters, over the ` +
        `${XLSX_WASM_BASE64_MAX_CHARS} character bound`,
    )
  }
  return { gzipBytes: gzip.byteLength, gzipBase64Chars: gzipBase64.length, gzipBase64 }
}

/**
 * Inline the Duke engine's JavaScript glue into a form a bundle can carry.
 *
 * The glue is an ES module whose only side effect at import time is none: it
 * exports the classes and the `__wbg_init` initialiser. Removing its module
 * syntax leaves declarations a function body can hold, which is how both the
 * bundle banner and the embedded worker carry it.
 *
 * @param rawGlue - the installed `@dukelib/sheets-wasm` entry source.
 * @returns the glue with no `export` statement and no `import.meta`.
 */
function inlineDukeGlue(rawGlue: string): string {
  const inlined = rawGlue
    .replace(/export class/g, 'class')
    .replace(/export function/g, 'function')
    .replace(/export \{[^}]+\};?/g, '')
    .replace(/export default __wbg_init;?/g, '')
    .replace(/import\.meta\.url/g, '""')

  if (/^\s*export\b/m.test(inlined) || /\bimport\.meta\b/.test(inlined)) {
    failBuild(
      'XLSX RUNTIME SHAPE CHANGED',
      'the Duke engine glue still carries module syntax after inlining',
    )
  }
  return inlined
}

/**
 * Wrap the `fflate` ESM browser build as a worker-scoped namespace.
 *
 * The worker needs four of its synchronous entry points, and it needs them
 * **inside the worker**: a worker has its own global scope, so the copy the main
 * thread bundled is not reachable from it. The module is wrapped in a function
 * rather than flattened into the worker's own top level, because the worker
 * already declares hundreds of top-level names and a collision would be a syntax
 * error in a file no test compiles.
 *
 * @param fflateModule - the installed `fflate/esm/browser.js` source.
 * @returns the wrapped namespace declaration.
 */
function inlineFflate(fflateModule: string): string {
  const stripped = stripModuleExports(fflateModule, 'the fflate ESM browser build')
  for (const name of FFLATE_BINDINGS) {
    if (!stripped.includes(`function ${name}(`)) {
      failBuild(
        'XLSX RUNTIME SHAPE CHANGED',
        `the fflate ESM browser build no longer declares ${name}`,
      )
    }
  }
  const namespace = FFLATE_BINDINGS.map((name) => `${name}: ${name}`).join(', ')
  return [
    'var __dsa_fflate__ = (function () {',
    '"use strict";',
    stripped,
    `return { ${namespace} };`,
    '})();',
  ].join('\n')
}

/**
 * Build the worker prelude: the inlined libraries the worker's own module needs.
 *
 * The Duke factory is lazily initialised and cached, so the 76 kB of glue is
 * evaluated once per worker rather than once per request, and it returns a
 * promise because the library's own call site is `import(...).then(...)`.
 *
 * @param dukeGlue - the inlined Duke glue.
 * @param fflateModule - the installed `fflate/esm/browser.js` source.
 * @returns the prelude source, terminated by a newline.
 */
function workerPrelude(dukeGlue: string, fflateModule: string): string {
  return [
    '// dsh-document-selection-ask: generated worker prelude.',
    '// The library worker is bundled as one module with no imports, because an',
    '// external client plugin is served as exactly one script and a worker cannot',
    '// resolve a specifier against it.',
    inlineFflate(fflateModule),
    'var __dsa_duke_module_cache__ = null;',
    'function __dsa_duke_module__() {',
    '  if (!__dsa_duke_module_cache__) {',
    '    var exports = {};',
    dukeGlue,
    '    __dsa_duke_module_cache__ = { CellValue: CellValue, Workbook: Workbook, Worksheet: Worksheet, default: __wbg_init, initSync: initSync };',
    '  }',
    '  return Promise.resolve(__dsa_duke_module_cache__);',
    '}',
    '',
  ].join('\n')
}

/**
 * Synthesize the self-contained worker module the bundle embeds.
 *
 * @param sources - the installed sources.
 * @returns the worker module source.
 */
function buildWorkerSource(sources: XlsxRuntimeSources): string {
  let module = replaceExactlyOnce(
    sources.workerModule,
    XLSX_WORKER_SOURCE_MAP_COMMENT,
    '',
    'the library worker source map comment',
  )

  for (const [needle, replacement] of XLSX_WORKER_FFLATE_IMPORTS) {
    module = replaceExactlyOnce(module, needle, replacement, `the worker's fflate import ${needle}`)
  }

  module = replaceExactlyOnce(
    module,
    XLSX_WORKER_DUKE_IMPORT,
    '__dsa_duke_module__()',
    'the worker Duke engine dynamic import',
  )

  const source = workerPrelude(sources.dukeGlue, sources.fflateModule) + module

  // Post-conditions rather than descriptions: a worker whose source still
  // contains any of these is a worker that would have to fetch something.
  if (/^\s*import\b/m.test(source)) {
    failBuild('XLSX RUNTIME SHAPE CHANGED', 'the embedded worker still carries a static import')
  }
  if (/\bimport\s*\(/.test(source)) {
    failBuild('XLSX RUNTIME SHAPE CHANGED', 'the embedded worker still carries a dynamic import')
  }
  if (/\brequire\s*\(/.test(source)) {
    failBuild('XLSX RUNTIME SHAPE CHANGED', 'the embedded worker still carries a require call')
  }
  if (source.includes('importScripts')) {
    failBuild('XLSX RUNTIME SHAPE CHANGED', 'the embedded worker still carries importScripts')
  }
  if (source.includes('sourceMappingURL')) {
    failBuild('XLSX RUNTIME SHAPE CHANGED', 'the embedded worker still names a source map')
  }
  return source
}

/**
 * Resolve the installed packages and read the sources the build embeds.
 *
 * @returns the installed sources.
 */
function readSources(): XlsxRuntimeSources {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve(`${XLSX_WASM_PACKAGE}/package.json`)
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const version =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? String((manifest as { version: unknown }).version)
      : ''

  const packageDir = dirname(manifestPath)
  const reactXlsxRequire = createRequire(manifestPath)
  const fflateDir = dirname(reactXlsxRequire.resolve('fflate/package.json'))

  return {
    packageDir,
    packageVersion: version,
    rawWasm: readFileSync(join(packageDir, ...XLSX_WASM_SUBPATH.split('/'))),
    workerModule: readFileSync(join(packageDir, 'dist', 'xlsx-worker.js'), 'utf8'),
    fflateModule: readFileSync(join(fflateDir, 'esm', 'browser.js'), 'utf8'),
    dukeGlue: inlineDukeGlue(readFileSync(reactXlsxRequire.resolve('@dukelib/sheets-wasm'), 'utf8')),
  }
}

/**
 * Build every embedded asset the XLSX client runtime needs.
 *
 * @returns the verified engine payload and the self-contained worker source.
 * @throws Error with a stable `dsa-xlsx-runtime-assets: <reason>` prefix when an
 *   identity, size or shape gate fails.
 */
export function createXlsxRuntimeAssets(): XlsxRuntimeAssets {
  const sources = readSources()
  assertEngineIdentity(sources)
  const compressed = compressEngine(sources.rawWasm)
  const workerSource = buildWorkerSource(sources)

  return {
    packageName: XLSX_WASM_PACKAGE,
    packageVersion: sources.packageVersion,
    wasmSubpath: XLSX_WASM_SUBPATH,
    rawBytes: sources.rawWasm.byteLength,
    sha256: createHash('sha256').update(sources.rawWasm).digest('hex'),
    gzipBytes: compressed.gzipBytes,
    gzipBase64Chars: compressed.gzipBase64Chars,
    gzipBase64: compressed.gzipBase64,
    workerSource,
    workerSourceChars: workerSource.length,
    dukeGlue: sources.dukeGlue,
    dukeGlueChars: sources.dukeGlue.length,
  }
}

/** Where an absolute address was found in an embedded worker source. */
export interface XlsxWorkerAddresses {
  /** Addresses on executable lines, with OOXML namespace identifiers excluded. */
  readonly code: readonly string[]
  /** Addresses on comment lines: documentation links, never dereferenced. */
  readonly comments: readonly string[]
}

/**
 * List the absolute addresses an embedded worker source carries.
 *
 * OOXML namespace identifiers are names, not addresses: the library's own
 * relationship constants are URIs of the form
 * `http://schemas.openxmlformats.org/...` and nothing ever dereferences them, so
 * they are excluded from the executable set. Comments are reported separately
 * rather than silently allowed — a documentation link in a comment is not a
 * reachable address, but it is also not something this build should hide.
 *
 * @param source - the embedded worker source.
 * @returns the distinct code and comment addresses, each sorted.
 */
export function findRemoteAddresses(source: string): XlsxWorkerAddresses {
  const code = new Set<string>()
  const comments = new Set<string>()
  for (const line of source.split('\n')) {
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(line)
    for (const match of line.matchAll(/https?:\/\/[^\s"'`)\\,;]+/g)) {
      const address = match[0]
      if (isComment) {
        comments.add(address)
        continue
      }
      const isNamespace = XML_NAMESPACE_HOSTS.some((host) => address.startsWith(`http://${host}/`))
      if (!isNamespace) code.add(address)
    }
  }
  return { code: [...code].sort(), comments: [...comments].sort() }
}
