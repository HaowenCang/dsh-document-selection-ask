/**
 * Report whether this project's DSH contract dependencies match the DSH
 * installation this machine actually runs.
 *
 * The compile probe (`tests/compatibility/contracts.compile.ts`) has to
 * type-check against the *published* DSH declarations, and those declarations
 * name further DSH client packages by bare specifier. TypeScript resolves such
 * a specifier by walking up from the physical location of the declaring
 * package, so a plugin can only see those packages when they sit in this
 * project's own `node_modules`. That is why the contract packages are pinned in
 * `devDependencies` at one exact release: `pnpm install` then supplies the whole
 * graph locally, and a fresh clone needs nothing from the machine beyond Node
 * and the registry.
 *
 * Two failure modes remain, and both are silent without this script:
 *
 * 1. Version skew. Two releases of one interface inside a single program make a
 *    slot key resolve to `never` while each individual declaration still looks
 *    valid 鈥?a contract would then be reported as verified without having been
 *    checked.
 *
 * 2. Runtime drift. The pin exists to track the installed DSH. When the
 *    installation moves to another release, the contract must be re-probed
 *    against it rather than assumed.
 *
 * This script only reads. It never writes inside the project and never touches
 * anything outside it; the project deliberately does not depend on the DSH
 * installation being present at all. Run it directly (`pnpm dsh:doctor`), or
 * with `--runtime` to require the runtime comparison and fail when the
 * installation cannot be found.
 *
 * Locations are discovered, never hard-coded:
 *
 * - `DSH_INSTALL_NODE_MODULES` names a `node_modules` directory holding the
 *   installation's `@deepseek-ai` scope.
 * - `DSH_HOME` names the DSH home; the default is `~/.dsh`.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@deepseek-ai'
const requireRuntime = process.argv.includes('--runtime')

/**
 * DSH client packages this project installs so the contract probe can compile
 * against the published declarations. Every entry is a direct or transitive
 * `import type` reachable from `src/client/dsh/contracts.ts`; nothing here is
 * speculative, and nothing else from the DSH tree is pinned.
 */
const CONTRACT_PACKAGES = [
  'cordis',
  'dsh-client-ui-slots',
  'dsh-client-store',
  'dsh-client-ui-dockkit',
  'dsh-client-ui-session',
  'dsh-client-ui-conversation',
  'dsh-client-ui-sidebar-documentpreview',
]

/** Contract packages that are not published under DSH release numbers. */
const NON_RELEASE_PACKAGES = new Set(['cordis'])

const problems = []
const notes = []

/**
 * Read a package's declared version.
 * @param packageDir - absolute package directory.
 * @returns the version string, or `null` when the manifest is unreadable.
 */
function readVersion(packageDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * Collect this project's declared dependency ranges.
 * @returns name (without scope) to declared range, for `@deepseek-ai` entries only.
 */
function declaredRanges() {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  const ranges = new Map()
  for (const field of fields) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(`${SCOPE}/`)) continue
      if (field === 'peerDependencies') continue
      ranges.set(name.slice(SCOPE.length + 1), String(range))
    }
  }
  return ranges
}

/**
 * The release version pinned by the contract packages, taken from the first
 * package that is published under DSH release numbers.
 * @param ranges - declared ranges by package name.
 * @returns the pinned release version, or `null` when the pins disagree.
 */
function pinnedRelease(ranges) {
  const releases = new Set()
  for (const name of CONTRACT_PACKAGES) {
    if (NON_RELEASE_PACKAGES.has(name)) continue
    releases.add(ranges.get(name) ?? '<not declared>')
  }
  if (releases.size !== 1) return null
  const [only] = [...releases]
  return only === undefined || only === '<not declared>' ? null : only
}

/**
 * Candidate `node_modules` directories holding an installed DSH. Nothing outside
 * these is inspected, and none of them is written to.
 *
 * `DSH_INSTALL_NODE_MODULES` is an override rather than one more candidate: when
 * it is set it is the only location inspected, so pointing it at the wrong
 * directory fails loudly instead of falling back to whatever else the machine
 * happens to have.
 * @returns candidate directories, in precedence order.
 */
function runtimeCandidates() {
  const override = process.env.DSH_INSTALL_NODE_MODULES
  if (override !== undefined && override !== '') return [resolve(override)]
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  return [join(home, 'node_modules'), join(dshHome, 'profiles', 'node_modules')].map((root) =>
    resolve(root),
  )
}

/**
 * Read the installed DSH release and where it was found.
 * @returns the version and scope directory, or `null` when no installation is present.
 */
function installedRuntime() {
  for (const root of runtimeCandidates()) {
    const scopeDir = join(root, SCOPE)
    const dshDir = join(scopeDir, 'dsh')
    const version = readVersion(dshDir)
    if (version === null) continue
    // DSH is commonly installed behind a link; report the directory that
    // actually holds it rather than the link on the PATH.
    let reported = scopeDir
    try {
      reported = dirname(realpathSync(dshDir))
    } catch {
      // An unreadable link still yields a usable version; keep the literal path.
    }
    return { version, scopeDir: reported }
  }
  return null
}

/**
 * List the `@deepseek-ai` packages present in the project's own `node_modules`.
 * @returns package names without the scope, or `null` when dependencies are not installed.
 */
function installedContractPackages() {
  const scopeDir = join(projectRoot, 'node_modules', SCOPE)
  if (!existsSync(scopeDir)) return null
  const present = new Set()
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (existsSync(join(scopeDir, entry.name, 'package.json'))) present.add(entry.name)
  }
  return present
}

const ranges = declaredRanges()
const release = pinnedRelease(ranges)
const runtime = installedRuntime()
const present = installedContractPackages()

// Every contract package must be declared exactly, because a range would let two
// checkouts of the same commit compile against different declarations.
for (const name of CONTRACT_PACKAGES) {
  const range = ranges.get(name)
  if (range === undefined) {
    problems.push(
      `  - ${SCOPE}/${name}: not declared in devDependencies; the contract graph cannot resolve it`,
    )
    continue
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) {
    problems.push(`  - ${SCOPE}/${name}: declared as "${range}"; an exact version is required`)
  }
}

if (release === null) {
  problems.push(
    '  - the contract packages do not pin one DSH release; mix releases of one interface ' +
      'and a slot key resolves to `never` while every declaration still looks valid',
  )
}

if (present === null) {
  notes.push('  - project dependencies are not installed; run `pnpm install`')
} else {
  for (const name of CONTRACT_PACKAGES) {
    const declared = ranges.get(name)
    if (declared === undefined) continue
    if (!present.has(name)) {
      problems.push(`  - ${SCOPE}/${name}: declared at ${declared} but absent from node_modules`)
      continue
    }
    const installed = readVersion(join(projectRoot, 'node_modules', SCOPE, name))
    if (installed !== declared) {
      problems.push(
        `  - ${SCOPE}/${name}: installed at ${installed ?? '?'}, declared at ${declared}; ` +
          're-run `pnpm install`',
      )
    }
  }
}

if (runtime === null) {
  const line =
    '  - no DSH installation found; set DSH_INSTALL_NODE_MODULES to its node_modules directory'
  if (requireRuntime) problems.push(line)
  else notes.push(line)
} else if (release !== null && runtime.version !== release) {
  problems.push(
    `  - installed DSH is ${runtime.version} while the contract packages pin ${release}; ` +
      're-probe the contract against the installed runtime before claiming support for it',
  )
}

console.log(`dsh-doctor: installed DSH = ${runtime?.version ?? 'not found'}`)
if (runtime !== null) console.log(`dsh-doctor: DSH scope = ${runtime.scopeDir}`)
console.log(`dsh-doctor: contract release pin = ${release ?? 'inconsistent'}`)
console.log(
  'dsh-doctor: contract packages = ' +
    CONTRACT_PACKAGES.map((name) => `${SCOPE}/${name}@${ranges.get(name) ?? '?'}`).join(', '),
)
if (notes.length > 0) console.log(`dsh-doctor: notes\n${notes.join('\n')}`)

if (problems.length > 0) {
  console.error(`dsh-doctor: contract environment is inconsistent:\n${problems.join('\n')}`)
  process.exitCode = 1
} else {
  console.log('dsh-doctor: contract environment is consistent')
}
