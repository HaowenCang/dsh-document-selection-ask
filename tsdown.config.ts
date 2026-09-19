import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { defineConfig } from 'tsdown'
import type { Plugin } from 'rolldown'

/**
 * The XLSX runtime assets are built by `scripts/xlsx-runtime-assets.ts`.
 *
 * The specifier carries the `.ts` extension because tsdown loads this config by
 * transforming it and then importing the result natively, which does not rewrite
 * a relative specifier — `.js`, extensionless and `.mjs` all fail to resolve
 * here. Node's own type stripping reads the `.ts` file, and its `erasableSyntaxOnly`
 * constraint is already enforced by this project's TypeScript configuration.
 */
import {
  XLSX_WORKER_CONSTRUCTION,
  XLSX_WORKER_REPLACEMENT,
  createXlsxRuntimeAssets,
} from './scripts/xlsx-runtime-assets.ts'

/**
 * The DSH web boot loads an external client plugin as one classic-script
 * bundle registered through `window.__ModuleLoader__.load({ id, factory })`,
 * where the factory receives a `require` resolving the static runtime modules
 * (`react`, `react/jsx-runtime`, `react-dom`, `@deepseek-ai/cordis`, …).
 *
 * Both entries therefore emit a single self-contained file wrapped in the
 * loader envelope by the banner/footer below; no top-level `import` or `export`
 * may survive, which is why React and React DOM stay external only in the sense
 * that the wrapper's `require` supplies them, and why the browser entry is
 * CommonJS rather than ESM.
 */
const PLUGIN_ID = 'dsh-document-selection-ask'

/**
 * The virtual ids the PDF renderer's sources import.
 */
const WORKER_VIRTUAL_ID = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const ASSETS_VIRTUAL_ID = 'virtual:pdfjs-assets'
const WORKER_RESOLVED_ID = '\0dsa:pdfjs-worker'
const ASSETS_RESOLVED_ID = '\0dsa:pdfjs-assets'

/** The installed PDF.js package directory, resolved from this config's own path. */
const PDFJS_DIR = join(import.meta.dirname, 'node_modules', 'pdfjs-dist')

/** React-xlsx package directory, for resolving the modules the client build compiles. */
const req = createRequire(import.meta.url)

/**
 * The XLSX runtime's two embedded assets, built and verified once per build.
 *
 * `createXlsxRuntimeAssets` reads the exact installed engine binary, refuses the
 * build unless its SHA-256 is the reviewed one, compresses it deterministically,
 * and synthesizes a self-contained worker module with no import of any kind.
 * Nothing here writes a file: the engine reaches the browser as a base64 string
 * inside `lib/client.js` and the worker as a `Blob` over a string inside the same
 * file, because DSH serves an external client plugin as exactly one script.
 */
const xlsxRuntime = createXlsxRuntimeAssets()

/** The virtual module the XLSX runtime reads its embedded payload through. */
const XLSX_WASM_VIRTUAL_ID = 'virtual:dsa-xlsx-wasm-gzip'
const XLSX_WASM_RESOLVED_ID = '\0dsa:xlsx-wasm-gzip'

/**
 * Publish the verified engine payload as a virtual module.
 *
 * The three exports are the payload and the two values the runtime checks it
 * against. They are build-time constants of a real installed dependency, so
 * neither the repository nor the package carries a second copy of the binary.
 *
 * @returns the plugin.
 */
function xlsxWasmPayloadPlugin(): Plugin {
  return {
    name: 'dsa-xlsx-wasm-payload',
    resolveId(source: string) {
      if (source === XLSX_WASM_VIRTUAL_ID) return XLSX_WASM_RESOLVED_ID
      return null
    },
    load(id: string) {
      if (id !== XLSX_WASM_RESOLVED_ID) return null
      return [
        `export const XLSX_WASM_GZIP_BASE64 = ${JSON.stringify(xlsxRuntime.gzipBase64)};`,
        `export const XLSX_WASM_RAW_BYTES = ${xlsxRuntime.rawBytes};`,
        `export const XLSX_WASM_SHA256 = ${JSON.stringify(xlsxRuntime.sha256)};`,
        `export const XLSX_WASM_GZIP_BYTES = ${xlsxRuntime.gzipBytes};`,
        `export const XLSX_WASM_PACKAGE_VERSION = ${JSON.stringify(xlsxRuntime.packageVersion)};`,
        '',
      ].join('\n')
    },
  }
}

/** The resource families PDF.js asks its `BinaryDataFactory` for. */
const ASSET_FAMILIES = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm',
} as const

function readAssetFamily(directory: string): Record<string, string> {
  const files = readdirSync(join(PDFJS_DIR, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('LICENSE'))
    .map((entry) => entry.name)
    .sort()

  if (files.length === 0) {
    throw new Error(`dsa-pdfjs-embed: ${directory} is empty; the installed pdfjs-dist layout changed`)
  }

  const table: Record<string, string> = {}
  for (const name of files) {
    table[name] = readFileSync(join(PDFJS_DIR, directory, name)).toString('base64')
  }
  return table
}

function pdfjsEmbedPlugin(): Plugin {
  return {
    name: 'dsa-pdfjs-embed',
    resolveId(source: string) {
      if (source === WORKER_VIRTUAL_ID) return WORKER_RESOLVED_ID
      if (source === ASSETS_VIRTUAL_ID) return ASSETS_RESOLVED_ID
      return null
    },
    load(id: string) {
      if (id === WORKER_RESOLVED_ID) {
        const source = readFileSync(join(PDFJS_DIR, 'build', 'pdf.worker.min.mjs'), 'utf8')
        if (source.length === 0) {
          throw new Error('dsa-pdfjs-embed: the PDF.js worker source is empty')
        }
        return `export default ${JSON.stringify(source)};`
      }
      if (id === ASSETS_RESOLVED_ID) {
        const table = Object.fromEntries(
          Object.entries(ASSET_FAMILIES).map(([kind, directory]) => [kind, readAssetFamily(directory)]),
        )
        return `export default ${JSON.stringify(table)};`
      }
      return null
    },
  }
}

function jszipBrowserPlugin(): Plugin {
  const jszipDistPath = req.resolve('jszip/dist/jszip.min.js', {
    paths: [req.resolve('docx-preview')],
  })
  return {
    name: 'dsa-jszip-browser',
    resolveId(source: string) {
      if (source === 'jszip' || source === 'jszip/lib/index') {
        return jszipDistPath
      }
      return null
    },
  }
}

function pptxCleanupPlugin(): Plugin {
  return {
    name: 'dsa-pptx-cleanup',
    transform(code, id) {
      if (id.includes('@aiden0z/pptx-renderer') || id.includes('aiden0z-pptx-renderer')) {
        return code.replace(
          /pdfjs-dist\/build\/pdf\.worker\.min\.mjs/g,
          'disabled-pptx-pdfjs-worker',
        )
      }
      return null
    },
  }
}

function fflateBrowserPlugin(): Plugin {
  const fflateBrowserPath = req.resolve('fflate/browser', {
    paths: [req.resolve('@extend-ai/react-xlsx')],
  })
  return {
    name: 'dsa-fflate-browser',
    resolveId(source: string) {
      if (source === 'fflate' || source === 'fflate/esm/index.mjs') {
        return fflateBrowserPath
      }
      return null
    },
  }
}

function reactVirtualTransformPlugin(): Plugin {
  return {
    name: 'dsa-react-virtual-transform',
    transform(code, id) {
      if (id.includes('@tanstack/react-virtual') || id.includes('react-virtual')) {
        return code
          .replace(/import\s*\{\s*flushSync\s*\}\s*from\s*["']react-dom["'];?/g, '')
          .replace(/flushSync\(rerender\)/g, 'rerender()')
      }
      return null
    },
  }
}

/**
 * The exact call `@extend-ai/react-xlsx` constructs its worker with.
 *
 * Imported from `scripts/xlsx-runtime-assets.ts` rather than restated here, so
 * the literal the rewrite matches and the literal the bundle spec asserts are the
 * same one. The rewrite is asserted to match exactly once: a regex that silently
 * matched nothing would let the build succeed while the bundle still carried the
 * library's own `new URL("./xlsx-worker.js", import.meta.url)`, which rolldown
 * emits for a CommonJS target as `require("url").pathToFileURL(__filename).href`
 * — a reference that is not resolvable in the browser and that names an asset
 * this package does not ship.
 */

/**
 * The worker construction the client bundle is built with instead.
 *
 * The identifier is defined in the banner below. It builds a `Worker` from a
 * `Blob` over the embedded worker source and releases the object URL in the same
 * statement, so the plugin owns exactly one object URL and revokes it before the
 * worker's first message is handled.
 */

/** The dynamic import the library loads its engine module through. */
const XLSX_DUKE_DYNAMIC_IMPORT = 'import("@dukelib/sheets-wasm")'

/**
 * Replace one exact literal, refusing anything but a single occurrence.
 *
 * A build-time rewrite of a dependency's code is a claim about that
 * dependency's shape. `String.prototype.replace` does not check the claim: on a
 * renamed symbol or a reformatted release it returns the input unchanged and the
 * build reports success while the bundle keeps the construct the rewrite exists
 * to remove. Asserting the count turns the claim into a build gate — zero
 * occurrences and two occurrences are both failures, because the second means
 * the rewrite is no longer describing one site.
 *
 * @param code - the module source being transformed.
 * @param needle - the exact literal to replace.
 * @param replacement - what to replace it with.
 * @param label - how to describe the literal in a failure message.
 * @returns the transformed source.
 * @throws Error when the literal does not occur exactly once.
 */
function replaceExactlyOnce(
  code: string,
  needle: string,
  replacement: string,
  label: string,
): string {
  const occurrences = code.split(needle).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `dsa-xlsx-client-runtime: expected exactly one occurrence of ${label} in the bundled ` +
        `@extend-ai/react-xlsx source, found ${occurrences}. The installed package's shape ` +
        'changed; this build refuses to emit a bundle whose XLSX runtime was not rewritten.',
    )
  }
  return code.replace(needle, replacement)
}

/**
 * Rewrite the two constructs in `@extend-ai/react-xlsx` the browser half cannot
 * carry as they are.
 *
 * Both rewrites are asserted (see {@link replaceExactlyOnce}). The second one is
 * not cosmetic: left alone, the library's dynamic `import("@dukelib/sheets-wasm")`
 * makes rolldown emit a separate chunk beside `lib/client.js`, and an external
 * client plugin is served as exactly one file — a second chunk is an asset no
 * contract delivers.
 *
 * @returns the plugin.
 */
function xlsxClientRuntimePlugin(): Plugin {
  return {
    name: 'dsa-xlsx-client-runtime',
    transform(code, id) {
      const normalised = id.split('\\').join('/')
      if (!normalised.includes('@extend-ai/react-xlsx/')) return null

      const withWorker = replaceExactlyOnce(
        code,
        XLSX_WORKER_CONSTRUCTION,
        XLSX_WORKER_REPLACEMENT,
        'the XlsxWorkerClient constructor',
      )
      return replaceExactlyOnce(
        withWorker,
        XLSX_DUKE_DYNAMIC_IMPORT,
        '__dukelib_sheets_wasm_promise__()',
        'the Duke engine dynamic import',
      )
    },
  }
}

/**
 * The bundle's opening envelope, built as a list rather than a template literal.
 *
 * It carries three things the module graph cannot supply: the classic-script
 * loader call DSH's web boot expects, the Duke engine's main-thread module — which
 * the rewrite above routes `import("@dukelib/sheets-wasm")` to, because a dynamic
 * import surviving into a CommonJS bundle would emit a second chunk — and the
 * self-contained worker source with the one helper that turns it into a `Worker`.
 *
 * Concatenation rather than a template literal is not style: the worker source is
 * 390 kB of JavaScript that contains backticks and `${` sequences of its own, and
 * a template literal would have to escape them.
 */
const BANNER = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(PLUGIN_ID)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  'var __dukelib_sheets_wasm_module__ = null;',
  'function __dukelib_sheets_wasm_promise__() {',
  '  if (!__dukelib_sheets_wasm_module__) {',
  '    var exports = {};',
  xlsxRuntime.dukeGlue,
  '    __dukelib_sheets_wasm_module__ = { CellValue, Workbook, Worksheet, default: __wbg_init, initSync };',
  '  }',
  '  return Promise.resolve(__dukelib_sheets_wasm_module__);',
  '}',
  '// The library worker, as one module with no import of any kind. DSH serves an',
  '// external client plugin as exactly one script, so a worker it starts has to',
  '// come from bytes this bundle already holds.',
  `var __dsa_xlsx_worker_source__ = ${JSON.stringify(xlsxRuntime.workerSource)};`,
  'function __dsa_xlsx_create_worker__() {',
  "  var url = URL.createObjectURL(new Blob([__dsa_xlsx_worker_source__], { type: 'text/javascript' }));",
  '  try {',
  "    return new Worker(url, { type: 'module' });",
  '  } finally {',
  '    // The URL is released as soon as the constructor has started the fetch:',
  '    // the library owns the Worker from here, terminates it on dispose, and',
  '    // offers no seam this plugin could revoke the URL through later.',
  '    URL.revokeObjectURL(url);',
  '  }',
  '}',
].join('\n')

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    plugins: [
      pdfjsEmbedPlugin(),
      jszipBrowserPlugin(),
      pptxCleanupPlugin(),
      fflateBrowserPlugin(),
      reactVirtualTransformPlugin(),
      xlsxWasmPayloadPlugin(),
      xlsxClientRuntimePlugin(),
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      alwaysBundle: [
        /^pdfjs-dist(\/|$)/,
        /^@zip\.js\/zip\.js(\/|$)/,
        /^docx-preview(\/|$)/,
        /^jszip(\/|$)/,
        /^@aiden0z\/pptx-renderer(\/|$)/,
        /^echarts(\/|$)/,
        /^zrender(\/|$)/,
        /^@extend-ai\/react-xlsx(\/|$)/,
        /^@dukelib\/sheets-wasm(\/|$)/,
        /^@tanstack\/react-virtual(\/|$)/,
        /^d3-.*(\/|$)/,
        /^fflate(\/|$)/,
        /^regl(\/|$)/,
        /^topojson-client(\/|$)/,
        /^us-atlas(\/|$)/,
        /^world-atlas(\/|$)/,
      ],
      onlyBundle: false,
    },
    banner: BANNER,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
])
