import { defineConfig } from 'tsdown'

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
 * bundled declaration output resolves the entire DSH client type graph, and
 * that graph contains packages the installation supplies to the running client
 * through its own module fallback rather than alongside itself. The plugin's
 * type contract is checked exhaustively by `pnpm typecheck` against
 * `tests/compatibility/contracts.compile.ts`.
 */
const PLUGIN_ID = 'dsh-document-selection-ask'

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
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
])
