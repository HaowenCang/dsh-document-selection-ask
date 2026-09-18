import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
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

/** React-xlsx package directory and assets */
const req = createRequire(import.meta.url)
const REACT_XLSX_DIR = dirname(req.resolve('@extend-ai/react-xlsx/package.json'))
const REACT_XLSX_WASM_PATH = join(REACT_XLSX_DIR, 'dist', 'duke_sheets_wasm_bg.wasm')
const REACT_XLSX_WORKER_PATH = join(REACT_XLSX_DIR, 'dist', 'xlsx-worker.js')

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

function xlsxAssetPlugin(): Plugin {
  return {
    name: 'dsa-xlsx-asset',
    writeBundle() {
      const assetsDir = join(import.meta.dirname, 'lib', 'assets')
      mkdirSync(assetsDir, { recursive: true })
      copyFileSync(REACT_XLSX_WASM_PATH, join(assetsDir, 'duke_sheets_wasm_bg.wasm'))
    },
  }
}

function xlsxWorkerTransformPlugin(): Plugin {
  return {
    name: 'dsa-xlsx-worker-transform',
    transform(code, id) {
      if (id.includes('@extend-ai/react-xlsx') || id.includes('react-xlsx')) {
        let transformed = code.replace(
          /new Worker\(new URL\("\.\/xlsx-worker\.js",\s*import\.meta\.url\),\s*\{ type: "module" \}\)/g,
          'new Worker(new URL("/dsa-assets/xlsx-worker.js", typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:50001"), { type: "module" })',
        )
        if (transformed.includes('import("@dukelib/sheets-wasm")')) {
          transformed = transformed.replace(
            'import("@dukelib/sheets-wasm")',
            '__dukelib_sheets_wasm_promise__()',
          )
        }
        return transformed
      }
      return null
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
      xlsxAssetPlugin(),
      xlsxWorkerTransformPlugin(),
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
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\nvar __dukelib_sheets_wasm_module__ = null;\nfunction __dukelib_sheets_wasm_promise__() {\n  if (!__dukelib_sheets_wasm_module__) {\n    var exports = {};\n    ${inlinedDukeJs}\n    __dukelib_sheets_wasm_module__ = { CellValue, Workbook, Worksheet, default: __wbg_init, initSync };\n  }\n  return Promise.resolve(__dukelib_sheets_wasm_module__);\n}`,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
  {
    entry: { 'assets/xlsx-worker': REACT_XLSX_WORKER_PATH },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    plugins: [
      {
        name: 'dsa-worker-dukelib-inline',
        transform(code, id) {
          if (id.includes('xlsx-worker')) {
            if (code.includes('import("@dukelib/sheets-wasm")')) {
              return code.replace(
                'import("@dukelib/sheets-wasm")',
                'Promise.resolve(__dukelib_worker_wasm_module__)',
              )
            }
          }
          return null
        },
        banner() {
          return `
var exports = {};
${inlinedDukeJs}
var __dukelib_worker_wasm_module__ = { CellValue, Workbook, Worksheet, default: __wbg_init, initSync };
`
        },
      },
    ],
    deps: {
      alwaysBundle: [/^fflate(\/|$)/, /^@dukelib\/sheets-wasm(\/|$)/],
      onlyBundle: false,
    },
  },
])
