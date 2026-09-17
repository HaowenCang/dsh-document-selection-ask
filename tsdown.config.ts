import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

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
 *
 * tsdown emits JavaScript only. Declarations come from `tsc -p
 * tsconfig.build.json`, which writes one declaration file per module: the
 * bundled declaration output resolves the entire DSH client type graph, and the
 * packages on that graph are pinned to one exact release in `devDependencies`
 * so `pnpm install` supplies them inside this project's own `node_modules`.
 * The plugin's type contract is checked exhaustively by `pnpm typecheck`
 * against `tests/compatibility/contracts.compile.ts`.
 *
 * ## The two build-time embeds, and why they are build-time
 *
 * The client half renders PDFs with `pdfjs-dist`, which the DSH loader cannot
 * resolve as a bare specifier: the loader's `require` serves the shared runtime
 * modules only, so a surviving `require("pdfjs-dist")` in the artifact is a
 * runtime failure in the browser and nothing about the source hints at it. Two
 * statements say otherwise, here rather than in prose:
 *
 * - `deps.alwaysBundle` pulls `pdfjs-dist` into the client artifact even though
 *   it is a production `dependency`;
 * - the plugin below embeds the resources that artifact needs from the **exact
 *   installed** package — the worker's module source, and the CMap,
 *   standard-font and wasm families as base64. Nothing is copied into the
 *   repository, so the embedded resources cannot drift from the pinned version,
 *   and no source file names a URL a browser would have to fetch.
 *
 * Task 9 bundles `@zip.js/zip.js`, `docx-preview`, and `jszip` into the client
 * artifact: the DOCX renderer imports `preflightOoxml()`, and DSH's loader cannot
 * resolve bare external npm specifiers.
 */
const PLUGIN_ID = 'dsh-document-selection-ask'

/**
 * The virtual ids the PDF renderer's sources import.
 *
 * They are declared in `src/client/renderers/pdf/virtual-modules.d.ts`, which is
 * what keeps `pnpm typecheck` honest about two modules that do not exist on
 * disk.
 */
const WORKER_VIRTUAL_ID = 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
const ASSETS_VIRTUAL_ID = 'virtual:pdfjs-assets'
const WORKER_RESOLVED_ID = '\0dsa:pdfjs-worker'
const ASSETS_RESOLVED_ID = '\0dsa:pdfjs-assets'

/** The installed PDF.js package directory, resolved from this config's own path. */
const PDFJS_DIR = join(import.meta.dirname, 'node_modules', 'pdfjs-dist')

/** The resource families PDF.js asks its `BinaryDataFactory` for. */
const ASSET_FAMILIES = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm',
} as const

/**
 * Read one asset family into a filename → base64 table.
 *
 * License files are skipped: they are not resources PDF.js ever requests, they
 * are recorded in `THIRD_PARTY_NOTICES.md` instead, and embedding eleven copies
 * of them as base64 would be a notice nobody reads inside a string literal.
 *
 * @param directory - the family's directory inside the installed package.
 * @returns the embedded table.
 * @throws Error when the directory is empty, because an installed package whose
 * layout changed must fail the build rather than produce an asset-less renderer.
 */
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

/**
 * The plugin that answers both virtual ids.
 *
 * It reads from the installed package at build time, so `pnpm build` runs after
 * `pnpm install` — which it does, and which is also what makes a version bump of
 * `pdfjs-dist` flow into the artifact without a second edit anywhere.
 *
 * @returns the Rolldown plugin.
 */
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

/**
 * Route jszip imports to its self-contained browser distribution (`dist/jszip.min.js`).
 *
 * docx-preview requires 'jszip', which resolves by default to jszip's Node entrypoint
 * ('./lib/index'), dragging in unpolyfilled Node modules ('stream', 'buffer', 'events', 'util').
 * The browser distribution is an entirely self-contained UMD bundle satisfying docx-preview
 * without leaving any bare Node specifiers in the client bundle.
 */
function jszipBrowserPlugin(): Plugin {
  const req = createRequire(import.meta.url)
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
    // CommonJS, not ESM: the DSH web boot evaluates a client plugin bundle as a
    // classic script inside the `__ModuleLoader__` factory, so a surviving
    // top-level `export` statement is a syntax error rather than a module
    // boundary. CommonJS emits `exports.apply = …` against the wrapper's own
    // `module`/`exports`, which is exactly the shape the loader's `require`
    // returns to the boot.
    //
    // The file is `lib/client.js`, the name DSH's own dual-face packages use and
    // the one `exports["./client"]` advertises. The host serves that export at
    // `/plugins/<id>/client.js` whatever it is called, but the conventions that
    // inspect a plugin package — the DSH plugin injection tooling among them —
    // look for the literal file, and a CommonJS output otherwise takes `.cjs`.
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    plugins: [pdfjsEmbedPlugin(), jszipBrowserPlugin()],
    deps: {
      // React and React DOM are supplied by the loader's `require`, never
      // inlined: a second React would be a second hook dispatcher, and every
      // hook this plugin passes across the slot boundary would belong to the
      // wrong one.
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      // A production dependency is external by default, which is right for a Node
      // library and wrong here: the DSH loader resolves the shared runtime only,
      // so `pdfjs-dist`, `docx-preview`, `jszip`, and `@zip.js/zip.js` have to be inside the artifact.
      alwaysBundle: [
        /^pdfjs-dist(\/|$)/,
        /^@zip\.js\/zip\.js(\/|$)/,
        /^docx-preview(\/|$)/,
        /^jszip(\/|$)/,
      ],
      // The "some dependencies were bundled" hint has nothing to add: the
      // statement above is a decision, not an oversight.
      onlyBundle: false,
    },
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
])
