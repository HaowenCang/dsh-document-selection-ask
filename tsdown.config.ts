import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { defineConfig } from 'tsdown'
import type { Plugin } from 'rolldown'

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

/** React-xlsx package directory, for resolving the module the client build compiles. */
const req = createRequire(import.meta.url)
const REACT_XLSX_DIR = dirname(req.resolve('@extend-ai/react-xlsx/package.json'))

/** Resolve duke_sheets_wasm.js source for inlining */
const reqRx = createRequire(join(REACT_XLSX_DIR, 'package.json'))
const DUKE_JS_PATH = reqRx.resolve('@dukelib/sheets-wasm')
const rawDukeJs = readFileSync(DUKE_JS_PATH, 'utf8')
const inlinedDukeJs = rawDukeJs
  .replace(/export class/g, 'class')
  .replace(/export function/g, 'function')
  .replace(/export \{[^}]+\};?/g, '')
  .replace(/export default __wbg_init;?/g, '')
  .replace(/import\.meta\.url/g, '""')

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
 * Stated as one literal rather than a pattern so the rewrite below can assert
 * that it matched exactly once. A regex that silently matched nothing would let
 * the build succeed while the bundle still carried the library's own
 * `new URL("./xlsx-worker.js", import.meta.url)`, which rolldown emits for a
 * CommonJS target as `require("url").pathToFileURL(__filename).href` — a
 * reference that is not resolvable in the browser and that names an asset this
 * package does not ship.
 */
const XLSX_WORKER_CONSTRUCTION =
  'new Worker(new URL("./xlsx-worker.js", import.meta.url), { type: "module" })'

/**
 * The worker construction the client bundle is built with instead.
 *
 * The identifier is defined in the banner below and refuses to produce a URL:
 * the library's worker is a separate script file, and DSH offers no public
 * client-only way for an external plugin to deliver one (see
 * `src/client/renderers/xlsx/wasm.ts`). Failing closed at this seam keeps the
 * bundle free of any reference to a host route, a CDN or a document-relative
 * path, and it is the single place a permitted delivery mechanism would plug
 * into.
 */
const XLSX_WORKER_REPLACEMENT = 'new Worker(__dsa_xlsx_worker_source_url__(), { type: "module" })'

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
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\nvar __dukelib_sheets_wasm_module__ = null;\nfunction __dukelib_sheets_wasm_promise__() {\n  if (!__dukelib_sheets_wasm_module__) {\n    var exports = {};\n    ${inlinedDukeJs}\n    __dukelib_sheets_wasm_module__ = { CellValue, Workbook, Worksheet, default: __wbg_init, initSync };\n  }\n  return Promise.resolve(__dukelib_sheets_wasm_module__);\n}\nfunction __dsa_xlsx_worker_source_url__() {\n  throw new Error("dsh-document-selection-ask: the XLSX worker has no client-owned source. DSH exposes no public client-only contract for delivering a second file beside lib/client.js, and this plugin does not serve it from the host. See src/client/renderers/xlsx/wasm.ts.");\n}`,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
])
