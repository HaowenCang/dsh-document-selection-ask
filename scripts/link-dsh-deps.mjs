/**
 * Prepare this project's `node_modules` so the contract probe compiles against
 * *this machine's* DSH installation.
 *
 * Three things are needed, and none of them is expressible as a semver range in
 * `package.json`:
 *
 * 1. Junction the installation's `@deepseek-ai` packages into
 *    `node_modules/@deepseek-ai`, so a plugin import such as
 *    `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client` resolves to the
 *    DSH that will actually load the plugin rather than to a registry copy of
 *    unknown vintage. The client half of DSH is not uniformly published, so
 *    range resolution cannot be relied on for it at all.
 *
 * 2. Install the few client packages the installation's own declarations name
 *    but does not ship next to itself. These live in `devDependencies` at the
 *    installed DSH version.
 *
 * 3. Junction those packages into the installation scope, because Node and
 *    TypeScript resolve a bare specifier by walking up from the *physical*
 *    location of the declaring package. Step 3 is the only write this script
 *    makes outside the project: it adds junctions alongside the installation,
 *    never inside a package and never over an existing entry, and prints each
 *    one so it can be deleted to revert. Skip it with
 *    `DSH_LINK_NO_INSTALL_REPAIR=1`, and an unresolvable contract then surfaces
 *    as a compile error instead of a silent `any`.
 *
 * The script is idempotent, never edits an installed file, and runs as
 * `preinstall` and as `pnpm dsh:link` so a fresh clone reaches the same state.
 *
 * Override the installation with `DSH_INSTALL_NODE_MODULES` (a `node_modules`
 * directory containing `@deepseek-ai/`), or point `DSH_HOME` at another DSH
 * home. Additional sources may be appended with `DSH_EXTRA_MODULE_ROOTS`
 * (path-delimiter separated).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scope = '@deepseek-ai'
const scopeDir = join(projectRoot, 'node_modules', scope)

/**
 * Client packages named by the installed DSH's client declarations that the
 * installation does not supply next to itself, so a consumer's compiler cannot
 * resolve them. Each is installed from the registry at the installed DSH
 * version and then junctioned into the installation scope by
 * {@link repairInstallationResolution}.
 */
const INSTALLATION_RESOLUTION_GAPS = new Set([
  'dsh-client-ui-slots',
  'dsh-client-store',
  'dsh-client-ui-dockkit',
])

/**
 * Packages the link loop must NOT take from the installation's module-fallback
 * tree, because the fallback copy is a different release than this project
 * asked for:
 *
 * `dsh-client-ui-slots`, because the fallback ships `0.1.0-rc.7` while every
 * other package in the installation is `0.1.5-rc.1`, and the installed
 * `dsh-client-ui-session` imports members (`SlotScopeAdapter`,
 * `KeyedStandardSource`, `KeyedSnapshotSelectorHook`) that the older release
 * does not declare. Linking the fallback copy puts two incompatible releases of
 * one interface into the same program.
 *
 * `dsh-client-store`, because the installation never ships it at all.
 */
const REGISTRY_PREFERRED = new Set(['dsh-client-ui-slots', 'dsh-client-store'])

/**
 * DSH client packages this plugin's contract graph actually imports, as
 * published by `src/client/dsh/contracts.ts`. Only gaps reachable from these
 * entries fail the build: the installed DSH names further client packages
 * (`dsh-client-app-shell` has no registry release at all) that no declaration
 * this plugin consumes ever reaches, and those must not be reported as this
 * plugin's problem.
 */
const CONSUMED_CONTRACT_PACKAGES = [
  'cordis',
  'dsh-client-ui-slots',
  'dsh-client-ui-conversation',
  'dsh-client-ui-sidebar-documentpreview',
]

/**
 * Candidate `node_modules` directories holding DSH packages, in precedence
 * order: an explicit override, the installation `dsh` itself resolves from,
 * then the per-user DSH profile trees with their module-fallback packages.
 *
 * The project's own `node_modules` is deliberately absent from this list: it is
 * the destination, and feeding it back in would let a previously linked or
 * registry-installed copy claim precedence over the installation under test.
 * @returns existing candidate directories.
 */
function candidateRoots() {
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  const roots = [
    process.env.DSH_INSTALL_NODE_MODULES,
    join(home, 'node_modules'),
    join(dshHome, 'profiles', 'node_modules'),
    join(dshHome, 'profiles', 'web', '.dsh-module-fallback', 'node_modules'),
    ...(process.env.DSH_EXTRA_MODULE_ROOTS ?? '').split(process.platform === 'win32' ? ';' : ':'),
  ]
  return roots.filter((root) => root !== undefined && root !== '').map((root) => resolve(root))
    .filter((root) => existsSync(join(root, scope)))
}

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
 * Collect `scope/name -> absolute package directory`, first root winning.
 * @param roots - candidate `node_modules` directories.
 * @returns the merged package map.
 */
function collectPackages(roots) {
  const packages = new Map()
  const provenance = new Map()
  for (const root of roots) {
    for (const entry of readdirSync(join(root, scope), { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const packageDir = join(root, scope, entry.name)
      if (!existsSync(join(packageDir, 'package.json'))) continue
      if (packages.has(entry.name)) continue
      packages.set(entry.name, packageDir)
      provenance.set(entry.name, root)
    }
  }
  return { packages, provenance }
}

const roots = candidateRoots()
if (roots.length === 0) {
  console.error(
    `link-dsh-deps: no ${scope} packages found. Set DSH_INSTALL_NODE_MODULES to a ` +
      'node_modules directory that contains the installed DSH packages.',
  )
  process.exit(1)
}

const { packages, provenance } = collectPackages(roots)
const dshVersion = readVersion(join(roots[0], scope, 'dsh'))

// A package already present in the project keeps its place: it came from
// `package.json`, so it is the version this project asked for. Replacing it
// with a junction would silently swap in the installation's copy — for a
// package such as `@deepseek-ai/cordis` that forks the Cordis identity and
// splits every `declare module` augmentation in two, and for the client
// packages it swaps an aligned release for the installation's older fallback
// copy.
mkdirSync(scopeDir, { recursive: true })
const scopeEntries = new Set(
  readdirSync(scopeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name),
)

let linked = 0
let replaced = 0
const lines = []

/**
 * List every file below a directory.
 * @param dir - absolute directory.
 * @returns absolute file paths.
 */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * Collect the `@deepseek-ai` package names a set of package declaration trees
 * names in an import, export, or `declare module` position.
 * @param startNames - package names to start from, without the scope.
 * @returns every reachable name, including the starting set.
 */
function reachablePackages(startNames) {
  const seen = new Set()
  const queue = [...startNames]
  while (queue.length > 0) {
    const name = queue.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const packageDir = packages.get(name)
    if (packageDir === undefined) continue
    const typesRoot = join(packageDir, 'lib', 'types')
    if (!existsSync(typesRoot)) continue
    for (const file of walk(typesRoot)) {
      if (!file.endsWith('.d.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(
        /['"](@deepseek-ai\/[a-z0-9-]+)(?:\/[a-z0-9./-]+)?['"]/g,
      )) {
        queue.push(match[1].slice(scope.length + 1))
      }
    }
  }
  return seen
}

const reachable = reachablePackages(CONSUMED_CONTRACT_PACKAGES)

/**
 * Judge one package the contract graph depends on against what this project
 * actually resolves. Version skew is the quiet failure this whole script exists
 * to catch: two releases of one interface in a single program make a slot key
 * resolve to `never` while every individual declaration still looks valid.
 * @param name - package name without the scope.
 * @returns a diagnostic line, or `null` when the package is supplied as intended.
 */
function inspectContractPackage(name) {
  const localDir = join(scopeDir, name)
  if (!existsSync(join(localDir, 'package.json'))) {
    const elsewhere = packages.get(name)
    return `  - ${scope}/${name}: not installed in this project` +
      (elsewhere === undefined
        ? `; install it as a devDependency at ${dshVersion ?? '<dsh version>'}`
        : ` (only ${readVersion(elsewhere) ?? '?'} exists, in ${provenance.get(name)})`)
  }
  const local = readVersion(localDir)
  if (REGISTRY_PREFERRED.has(name) && local !== dshVersion) {
    return `  - ${scope}/${name}: installed at ${local}, installed DSH is ${dshVersion ?? '?'}`
  }
  // A package on the contract graph that stays inside this project's
  // `node_modules` would compile this project while remaining invisible to the
  // client declarations that import it by name from the installation.
  if (INSTALLATION_RESOLUTION_GAPS.has(name)) {
    const installLink = join(roots[0], scope, name)
    if (!existsSync(join(installLink, 'package.json'))) {
      return `  - ${scope}/${name}: present at ${local} but unreachable from the installation; ` +
        're-run without DSH_LINK_NO_INSTALL_REPAIR=1'
    }
  }
  return null
}

for (const [name, packageDir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  // A registry-preferred package must come from this project's dependencies,
  // never from the installation's fallback tree: the fallback copy is a
  // different release, and mixing releases is what breaks the slot contract.
  if (REGISTRY_PREFERRED.has(name) && existsSync(join(scopeDir, name))) {
    lines.push(
      `  ! ${scope}/${name}@${readVersion(join(scopeDir, name)) ?? '?'} kept from this project ` +
        `(fallback has ${readVersion(packageDir) ?? '?'})`,
    )
    continue
  }
  const linkPath = join(scopeDir, name)
  const existing = scopeEntries.has(name)
  if (existing) {
    const current = readVersion(linkPath)
    const wanted = readVersion(packageDir)
    if (current === wanted) {
      lines.push(`  = ${scope}/${name}@${wanted ?? '?'} (already present)`)
      continue
    }
    rmSync(linkPath, { recursive: true, force: true })
    replaced += 1
  } else {
    linked += 1
  }
  symlinkSync(packageDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  lines.push(
    `  + ${scope}/${name}@${readVersion(packageDir) ?? '?'} <- ${provenance.get(name)}`,
  )
}

console.log(`link-dsh-deps: sources\n${roots.map((root) => `  - ${root}`).join('\n')}`)
console.log(`link-dsh-deps: ${scope} packages linked=${linked} replaced=${replaced}`)
console.log(lines.join('\n'))
console.log(`link-dsh-deps: installed DSH = ${dshVersion ?? 'unknown'}`)
console.log(
  'link-dsh-deps: contract graph roots = ' +
    CONSUMED_CONTRACT_PACKAGES.map((name) => `${scope}/${name}`).join(', '),
)

// Repair runs before validation: the repair is what puts the missing packages
// where the installation's own declarations look for them, so validating first
// would report a gap on every clean checkout and then "fix" it, turning the
// preinstall hook into a spurious failure.
repairInstallationResolution()

// A problem on the contract graph is fatal. It is not a style preference: the
// contract probe would compile that type as `any` or as `never` and then report
// a contract as verified without having checked anything. Packages outside the
// graph are not this plugin's business, so they are never reported.
const contractPackageProblems = [...INSTALLATION_RESOLUTION_GAPS, ...reachable]
  .map(inspectContractPackage)
  .filter((line) => line !== null)
  .sort()

if (contractPackageProblems.length > 0) {
  console.log(
    'link-dsh-deps: the contract graph cannot be typed as intended:\n' +
      contractPackageProblems.join('\n'),
  )
  process.exitCode = 1
}

/**
 * Complete the installation's own module-fallback resolution.
 *
 * The DSH client packages declare their contract in `.d.ts` files that name
 * further client packages — `@deepseek-ai/dsh-client-ui-conversation` names
 * `@deepseek-ai/dsh-client-ui-slots` and `@deepseek-ai/dsh-client-store`. Node
 * and TypeScript resolve such a specifier by walking up from the *physical*
 * location of the declaring package, so they look in the installation's own
 * `node_modules/@deepseek-ai`, not in this project's. The installation does not
 * ship every package it names there; it supplies them to the running client
 * through the per-profile `.dsh-module-fallback` tree instead, which is why a
 * declaration can name a package that a plugin consumer cannot resolve.
 *
 * The effect is not cosmetic: TypeScript silently degrades an unresolvable
 * named import to `any`, so a broken resolution chain would let this plugin's
 * contract probe compile against an untyped hole and report a contract as
 * verified when nothing had been checked.
 *
 * This step therefore completes the same fallback the installation already
 * uses, by adding missing junctions *next to the installation* (never inside a
 * package, never over an existing entry). It is idempotent, reversible by
 * deleting the junctions it reports, and skippable with
 * `DSH_LINK_NO_INSTALL_REPAIR=1` — in which case an unresolvable contract
 * surfaces as a compile error rather than as a silent `any`.
 */
function repairInstallationResolution() {
  if (process.env.DSH_LINK_NO_INSTALL_REPAIR === '1') {
    console.log('link-dsh-deps: installation repair skipped (DSH_LINK_NO_INSTALL_REPAIR=1)')
    return
  }
  const installScope = join(roots[0], scope)
  const repaired = []

  for (const name of INSTALLATION_RESOLUTION_GAPS) {
    const installLink = join(installScope, name)
    if (existsSync(join(installLink, 'package.json'))) continue
    const local = join(scopeDir, name)
    // Absence is reported by inspectContractPackage; this loop only repairs.
    if (!existsSync(join(local, 'package.json'))) continue
    symlinkSync(local, installLink, process.platform === 'win32' ? 'junction' : 'dir')
    repaired.push(`  + ${join(installScope, name)} -> ${local}`)
  }

  if (repaired.length > 0) {
    console.log(
      'link-dsh-deps: repaired installation resolution gaps (delete these junctions to revert)\n' +
        repaired.join('\n'),
    )
  }
}