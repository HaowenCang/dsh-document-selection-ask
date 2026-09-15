/**
 * Bundle configuration for the test-only smoke driver.
 *
 * The driver is a DSH client plugin, so it has to be packaged exactly like one:
 * the DSH web boot evaluates it as a **classic script** that calls
 * `window.__ModuleLoader__.load({ id, factory })`, and the factory receives a
 * `require` resolving the platform's shared modules. That is why the client
 * banner and footer below wrap that whole bundle and why React stays external
 * rather than being inlined — the loader supplies it.
 *
 * The host half is emitted as well, for a reason worth stating: the loader
 * resolves a bundle row through its `exports "."`, which points at `lib/index.js`
 * in both halves of this package. A row whose host entry does not exist is a
 * boot failure — `failed to import loader entry … Cannot find module` — not a
 * warning, so the inert host body still has to be bundled to a real file.
 *
 * This configuration mirrors the shipping plugin's `tsdown.config.ts`
 * deliberately. The two differ only in the plugin id and in the entries, because
 * the loader contract the client half must satisfy is the same contract, and
 * re-deriving it here by hand is how a driver bundle silently stops matching the
 * boot.
 */

import { defineConfig } from 'tsdown'

/** The loader id the driver registers and the patch row addresses. */
const PLUGIN_ID = '@dsh-smoke/dsa-smoke-driver'

/** The driver package directory, relative to this repository's root. */
const DRIVER = 'tests/browser/smoke-driver'

export default defineConfig([
  {
    entry: { index: `${DRIVER}/src/index.ts` },
    outDir: `${DRIVER}/lib`,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: true,
  },
  {
    entry: { client: `${DRIVER}/src/client/index.tsx` },
    outDir: `${DRIVER}/lib`,
    // CommonJS, not ESM: a surviving top-level `export` inside a classic script
    // is a syntax error rather than a module boundary. CommonJS emits
    // `exports.apply = …` against the wrapper's own `module`/`exports`, which is
    // the shape the loader's `require` returns to the boot.
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: true,
    outExtensions: () => ({ js: '.js' }),
    // React is supplied by the loader's `require`, never inlined. `neverBundle`
    // rather than the deprecated `external` alias: this config is new, so it
    // states the current option name.
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] },
    banner: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(PLUGIN_ID)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
    footer: `\t\treturn module.exports;\n\t}\n});`,
  },
])
