#!/usr/bin/env node
/**
 * The Task 14 compatibility gate: does this checkout's DSH contract
 * environment still describe the runtime it claims to support?
 *
 * ## Why the version comparison is not enough on its own
 *
 * The compile probe (`tests/compatibility/contracts.compile.ts`) has to
 * type-check against the *published* DSH declarations, and those declarations
 * name further DSH client packages by bare specifier. TypeScript resolves such a
 * specifier by walking up from the physical location of the declaring package,
 * so the plugin can only see them when they sit in this project's own
 * `node_modules`. That is why the contract packages are pinned in
 * `devDependencies` at one exact release: `pnpm install` supplies the whole
 * graph locally and a fresh clone needs nothing from the machine beyond Node and
 * the registry.
 *
 * Two failure modes stay silent without this script, and reading
 * `package.json` cannot separate them:
 *
 * 1. **Version skew.** Two releases of one interface inside a single program
 *    make a slot key resolve to `never` while each individual declaration still
 *    looks valid, so a contract is reported as verified without having been
 *    checked.
 * 2. **Runtime drift.** The pin exists to track the installed DSH. When the
 *    installation moves to another release, the contract must be re-probed
 *    against it rather than assumed.
 *
 * A third failure mode is only visible by compiling: a pin that is *internally*
 * consistent and matches the runtime can still fail to satisfy the plugin's
 * public contract. The script therefore ends by running the project's own
 * typecheck, which compiles the probes against the installed declarations.
 * Reporting "contracts are compatible" after reading `package.json` alone would
 * be exactly the claim this gate exists to prevent.
 *
 * ## What it reads, and what it refuses to do
 *
 * The script only reads. It never writes inside the project, never touches the
 * DSH installation, never queries a registry, never downloads a package, and
 * never runs an install. Its only two child processes are the CLI version probe
 * described below and the project's own TypeScript compiler — and the probe runs
 * only when no override names the installation, as the next section states; the
 * compiler is invoked directly, as `node <root>/node_modules/typescript/bin/tsc`
 * with the arguments the `typecheck` script declares, because `pnpm run` decides
 * whether the dependency tree is up to date before running a script and would
 * install one for a tree it does not recognise.
 *
 * ## The pin fields it owns
 *
 * `dependencies`, `devDependencies` and `optionalDependencies` are audited.
 * `peerDependencies` is deliberately excluded: a peer range states what a
 * *consumer* may bring rather than what this checkout compiles against, and this
 * repository declares its one peer as `^4.0.2`, which is not an exact pin. A
 * package pinned exactly in both `dependencies` and `devDependencies` keeps the
 * later field's range, so a divergent duplicate is not detected; that shape is
 * not present here and the lockfile forbids the installation it would describe.
 *
 * ## Runtime discovery
 *
 * The DSH installation is discovered, never hard-coded, and the routes are tried
 * in this order:
 *
 * 1. `DSH_INSTALL_NODE_MODULES` — a `node_modules` directory holding an
 *    installation's `@deepseek-ai` scope. When it is set and non-empty it is the
 *    **only** authority: the location inspected, the runtime selected and the
 *    verdict reached. Pointing it at the wrong directory fails loudly instead of
 *    falling back to whatever else the machine happens to have. That exclusivity
 *    is what makes the gate usable for an isolated comparison: an override onto
 *    another release has to produce a mismatch, not a pass.
 * 2. The `dsh` CLI on `PATH`. Its own version command is executed and its output
 *    is validated, rather than assumed: the flag and the output shape were
 *    probed on the installed CLI (`dsh --help` documents `-V, --version`)
 *    instead of being guessed. Each directory that holds a `dsh` launcher also
 *    contributes its own `node_modules`, which is where an npm-style global
 *    installation keeps the package.
 * 3. The public `DSH_HOME` layout — `$DSH_HOME` or the default home directory,
 *    then `profiles/node_modules` — followed by the home directory's own
 *    `node_modules`.
 *
 * Routes 2 and 3 are excluded by the override rather than ranked below it. With
 * `DSH_INSTALL_NODE_MODULES` set, `probePathCli` is never called: the `dsh` on
 * `PATH` is not executed, not read, and not reported, so an ambient installation
 * — a different release, or a launcher that fails — cannot reach the verdict
 * even as a secondary complaint. Exclusivity therefore holds at three levels at
 * once: which locations are read, which runtime is selected, and what is
 * reported. An override that is absent, that is not a `node_modules`, that holds
 * no `@deepseek-ai/dsh`, or whose version disagrees with the contract pin fails
 * on its own evidence; none of the three routes is a fallback for a bad override.
 *
 * ## Usage
 *
 * ```text
 * node scripts/check-dsh-contracts.mjs            # full gate, including typecheck
 * node scripts/check-dsh-contracts.mjs --no-typecheck
 * node scripts/check-dsh-contracts.mjs --root <dir>
 * ```
 *
 * `--root` points the same checks at a throwaway copy of the tree. It exists for
 * the same reason `scripts/verify.mjs` has one: a reviewer shows that a negative
 * gate is connected to anything only by making it fire on an input that should
 * fail, and the positive worktree must not be edited to manufacture that.
 *
 * Exit codes: `0` every check passed; `1` the contract environment is
 * inconsistent; `2` the command line was not understood.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

/** The scope every DSH package is published under. */
const SCOPE = '@deepseek-ai'

/**
 * Contract packages that are **not** published under DSH release numbers.
 *
 * `@deepseek-ai/cordis` is versioned independently of the DSH release train
 * (`4.0.2`), so folding it into the release comparison would report a mismatch
 * on a correct environment. It is still checked — as an exact pin of its own —
 * but it never participates in the release family.
 */
const NON_RELEASE_PACKAGES = new Set(['cordis'])

/** The dependency fields whose `@deepseek-ai` entries are pins this gate owns. */
const PIN_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

/** An exact version, optionally carrying a prerelease tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** The CLI version output shape, checked rather than assumed. */
const CLI_VERSION_OUTPUT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** Exit code for an inconsistent contract environment. */
const EXIT_INCONSISTENT = 1

/** Exit code for a command line this script does not understand. */
const EXIT_USAGE = 2

/**
 * Read a text file without a byte-order mark.
 *
 * A manifest written by an editor that prefixes a BOM would otherwise fail
 * `JSON.parse` and be reported as an absent package — a wrong diagnosis for a
 * readable file, and one that would make the negative proofs ambiguous.
 *
 * @param path - absolute file path.
 * @returns the file's text, or `null` when it cannot be read.
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

/**
 * Read a package's declared version.
 * @param packageDir - absolute package directory.
 * @returns the version string, or `null` when the manifest is unreadable.
 */
function readVersion(packageDir) {
  const text = readText(join(packageDir, 'package.json'))
  if (text === null) return null
  try {
    const manifest = JSON.parse(text)
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * Read a JSON file, or `null` when it is absent or malformed.
 * @param path - absolute file path.
 * @returns the parsed value, or `null`.
 */
function readJson(path) {
  const text = readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Strip the comment and trailing-comma forms from a JSONC document.
 *
 * TypeScript configuration files in this repository are written with comments,
 * so `JSON.parse` alone cannot read them. The scan is character-wise rather than
 * a regular expression over the whole text, because a `//` inside a string — a
 * Windows path in an `include` entry, for instance — is content, not a comment.
 *
 * @param source - the file's text.
 * @returns text `JSON.parse` accepts.
 */
function stripJsonComments(source) {
  let out = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (inString) {
      out += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      out += character
      continue
    }
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    out += character
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Read a JSONC file, or `null` when it is absent or malformed.
 * @param path - absolute file path.
 * @returns the parsed value, or `null`.
 */
function readJsonc(path) {
  const text = readText(path)
  if (text === null) return null
  try {
    return JSON.parse(stripJsonComments(text))
  } catch {
    return null
  }
}

/**
 * Collect one manifest's declared `@deepseek-ai` pins.
 *
 * `peerDependencies` is deliberately excluded: a peer range states what a
 * *consumer* may bring, not what this checkout compiles against, and the contract
 * graph is compiled against the installed `devDependencies`.
 *
 * @param manifest - a parsed package manifest.
 * @returns name without scope to `{ range, field }`, in declaration order.
 */
function declaredPins(manifest) {
  const pins = new Map()
  for (const field of PIN_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(`${SCOPE}/`)) continue
      pins.set(name.slice(SCOPE.length + 1), { range: String(range), field })
    }
  }
  return pins
}

/** Directories that never hold a checked-in manifest this gate should read. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'lib',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'smoke-fixtures',
  '.pnpm-store',
])

/**
 * How deep the manifest walk descends. The repository's own manifests sit within
 * a few levels of the root; the bound keeps a stray directory from turning the
 * gate into a filesystem crawl.
 */
const MANIFEST_WALK_DEPTH = 6

/**
 * Find every `package.json` in the repository that declares a `@deepseek-ai`
 * pin.
 *
 * One manifest is not enough. A second package in the same repository — the
 * test-only smoke driver, for instance — carries its own contract pins, and a
 * stale release left behind there is the same defect this gate exists to catch:
 * it names a release the current runtime is not, and nothing else would report
 * it. The walk is bounded and skips the directories that hold other packages'
 * manifests rather than this repository's.
 *
 * @param root - the project root.
 * @returns `{ path, dir, manifest, pins }` for each manifest that declares one.
 */
function discoverPinManifests(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > MANIFEST_WALK_DEPTH) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const manifest = readJson(join(dir, 'package.json'))
    if (manifest !== null) {
      const pins = declaredPins(manifest)
      if (pins.size > 0) {
        found.push({ path: (relative(root, dir) || '.').split('\\').join('/'), dir, manifest, pins })
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(root, 0)
  return found
}

/**
 * Resolve the `node_modules` a manifest's specifiers resolve against.
 *
 * Node and TypeScript both walk up from the declaring package, so a nested
 * manifest's contract packages are supplied by an ancestor's tree when it has
 * none of its own. Comparing a nested manifest against its own absent
 * `node_modules` would report every pin as uninstalled.
 *
 * @param from - the manifest's directory.
 * @param root - the project root, the highest directory consulted.
 * @returns the nearest existing `node_modules`, or `null`.
 */
function resolveNodeModules(from, root) {
  let current = from
  for (;;) {
    const candidate = join(current, 'node_modules')
    if (existsSync(candidate)) return candidate
    if (current === root) return null
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Split the declared pins into the release family and the independently
 * versioned packages.
 * @param pins - declared pins by package name.
 * @returns the two name lists.
 */
function partitionPins(pins) {
  const release = []
  const independent = []
  for (const name of pins.keys()) {
    if (NON_RELEASE_PACKAGES.has(name)) independent.push(name)
    else release.push(name)
  }
  return { release, independent }
}

/**
 * Read the version this project has installed for each declared package.
 * @param root - the project root.
 * @param pins - declared pins by package name.
 * @returns name to installed version, with `null` for an absent package.
 */
function installedProjectVersions(root, pins) {
  const installed = new Map()
  for (const name of pins.keys()) {
    const dir = join(root, 'node_modules', SCOPE, name)
    installed.set(name, existsSync(dir) ? readVersion(dir) : null)
  }
  return installed
}

/**
 * Locate the `dsh` launcher on `PATH`.
 *
 * Only the *directory* is needed, because an npm-style global installation keeps
 * its packages in the `node_modules` beside the launcher. Windows launchers carry
 * `.cmd` and `.ps1` extensions, so all three names are probed.
 *
 * @param env - the environment to read `PATH` from.
 * @returns absolute launcher paths, in `PATH` order.
 */
function pathLaunchers(env) {
  const raw = env.PATH ?? env.Path ?? env.path ?? ''
  const names = process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh']
  const found = []
  for (const entry of raw.split(delimiter)) {
    if (entry === '') continue
    for (const name of names) {
      const candidate = join(entry, name)
      if (existsSync(candidate)) {
        found.push(candidate)
        break
      }
    }
  }
  return found
}

/**
 * Run the public CLI's own version command.
 *
 * The flag is not guessed: `dsh --help` on the installed CLI documents
 * `-V, --version`, and the output shape is validated here rather than trusted.
 * A CLI whose output does not match is reported as unreadable instead of being
 * coerced into a version.
 *
 * @param env - the environment to run in.
 * @returns `{ version }`, `{ error }` when the probe failed, or `null` when no
 *   `dsh` launcher is on `PATH` at all.
 */
function probePathCli(env) {
  if (pathLaunchers(env).length === 0) return null
  const result = spawnSync('dsh --version', {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    shell: true,
    env,
  })
  if (result.error !== undefined && result.error !== null) {
    return { error: `running \`dsh --version\` failed: ${result.error.message}` }
  }
  const output = `${result.stdout ?? ''}`.trim()
  if (result.status !== 0) {
    return { error: `\`dsh --version\` exited ${result.status ?? '?'}: ${output || '(no output)'}` }
  }
  if (!CLI_VERSION_OUTPUT.test(output)) {
    return { error: `\`dsh --version\` printed ${JSON.stringify(output)}, which is not a version` }
  }
  return { version: output }
}

/**
 * Candidate `node_modules` directories holding an installation, in precedence
 * order. Nothing outside these is inspected, and none of them is written to.
 *
 * An override short-circuits before `pathLaunchers` is consulted, so `PATH` is
 * not even scanned in that mode — the exclusivity is a property of the read, not
 * of how a later comparison happens to treat its result.
 *
 * @param env - the environment to read.
 * @returns `{ roots, source, exclusive }` where `source` names the route that
 *   produced them and `exclusive` states whether the override was the authority.
 */
function runtimeCandidates(env) {
  const override = env.DSH_INSTALL_NODE_MODULES
  if (override !== undefined && override !== '') {
    // Exclusive: an override that is wrong must fail, not fall through.
    return { roots: [resolve(override)], source: 'DSH_INSTALL_NODE_MODULES override', exclusive: true }
  }

  const roots = []
  for (const launcher of pathLaunchers(env)) {
    const binDir = dirname(launcher)
    roots.push(join(binDir, 'node_modules'), join(binDir, '..', 'lib', 'node_modules'))
  }

  const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  roots.push(join(home, 'profiles', 'node_modules'))
  roots.push(join(homedir(), 'node_modules'))

  return { roots: [...new Set(roots.map((root) => resolve(root)))], source: 'PATH, DSH_HOME and home', exclusive: false }
}

/**
 * Read the DSH release version a candidate directory holds.
 *
 * An npm-style installation can keep the client packages either hoisted beside
 * `@deepseek-ai/dsh` or nested inside it, so both layouts are probed when a
 * nested package is asked for.
 *
 * @param root - a candidate `node_modules` directory.
 * @param name - package name without scope.
 * @returns the version, or `null` when neither layout holds the package.
 */
function versionAt(root, name) {
  for (const dir of [
    join(root, SCOPE, name),
    join(root, SCOPE, 'dsh', 'node_modules', SCOPE, name),
  ]) {
    if (!existsSync(dir)) continue
    const version = readVersion(dir)
    if (version !== null) {
      let reported = dir
      try {
        reported = realpathSync(dir)
      } catch {
        // An unreadable link still yields a usable version.
      }
      return { version, dir: reported }
    }
  }
  return null
}

/**
 * Discover the installed DSH runtime.
 *
 * The candidates are resolved *before* any launcher is probed, because the
 * override decides whether the `PATH` route exists at all. Probing `PATH` first
 * and discarding the result afterwards would still execute an ambient launcher
 * and would still leave its report available to the verdict, which is the
 * defect this ordering removes: under an override `cli` is `null` without
 * `probePathCli` having run, so no `PATH` observation can reach a decision.
 *
 * @param env - the environment to read.
 * @returns the runtime record, the CLI probe result (`null` when `PATH` was not
 *   probed), whether the override was exclusive, and the candidates tried.
 */
function discoverRuntime(env) {
  const { roots, source, exclusive } = runtimeCandidates(env)
  const cli = exclusive ? null : probePathCli(env)
  const tried = []

  for (const root of roots) {
    tried.push(root)
    const dsh = versionAt(root, 'dsh')
    if (dsh === null) continue
    const sidebar = versionAt(root, 'dsh-client-ui-sidebar-documentpreview')
    return {
      cli,
      tried,
      source,
      exclusive,
      runtime: {
        version: dsh.version,
        root,
        dir: dsh.dir,
        sidebarDocumentPreview: sidebar === null ? null : sidebar.version,
      },
    }
  }

  return { cli, tried, source, exclusive, runtime: null }
}

/**
 * Inspect this checkout's contract environment without deciding anything.
 *
 * The returned `problems` array is the whole verdict for the version half of the
 * gate; the caller adds the compile result.
 *
 * @param options - `root` (project directory), `env` (environment to read) and
 *   `requireRuntime` (whether a missing installation is a problem or a note).
 * @returns the collected state and the problems found.
 */
export function inspectContractEnvironment({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env,
  requireRuntime = true,
} = {}) {
  const problems = []
  const notes = []

  const manifest = readJson(join(root, 'package.json'))
  if (manifest === null) {
    return {
      root,
      manifest: null,
      problems: [`  - ${join(root, 'package.json')} is unreadable; there is nothing to check`],
      notes,
    }
  }

  const manifests = discoverPinManifests(root)
  const pins = declaredPins(manifest)

  // One release for the whole repository. Two releases of one interface inside a
  // single program is the skew that makes a slot key resolve to `never`, and a
  // second manifest is just as capable of introducing it as the root one.
  const releases = new Set()
  const releasePackages = []
  const independentPackages = []
  let releaseCount = 0
  for (const entry of manifests) {
    const partition = partitionPins(entry.pins)
    releasePackages.push(...partition.release)
    independentPackages.push(...partition.independent)
    releaseCount += partition.release.length
    for (const [name, { range, field }] of entry.pins) {
      // Every pin must be exact: a range would let two checkouts of one commit
      // compile against different declarations.
      if (!EXACT_VERSION.test(range)) {
        problems.push(
          `  - ${entry.path}/package.json: ${SCOPE}/${name} declared as "${range}" in ${field}; ` +
            'an exact version is required',
        )
      }
      if (!NON_RELEASE_PACKAGES.has(name)) releases.add(range)
    }
  }

  if (releaseCount === 0) {
    problems.push(
      `  - no release-numbered ${SCOPE} contract package is declared; the compile probe would ` +
        'resolve nothing',
    )
  }

  const releasePin = releases.size === 1 ? [...releases][0] : null
  if (releasePin === null && releaseCount > 0) {
    problems.push(
      `  - the release-numbered contract packages do not pin one DSH release: ` +
        `${[...releases].sort().join(', ')}. Mixed releases of one interface make a slot key ` +
        'resolve to `never` while every declaration still looks valid',
    )
  }

  const installedRoot = resolveNodeModules(root, root)
  const installed = installedProjectVersions(root, pins)

  if (installedRoot === null) {
    problems.push(
      `  - ${join(root, 'node_modules')} does not exist; run \`pnpm install\` in ${root} before ` +
        'this gate can compare declared pins with installed declarations',
    )
  } else {
    for (const entry of manifests) {
      const modules = resolveNodeModules(entry.dir, root) ?? installedRoot
      for (const [name, { range, field }] of entry.pins) {
        const dir = join(modules, SCOPE, name)
        const version = existsSync(dir) ? readVersion(dir) : null
        if (version === null) {
          problems.push(
            `  - ${entry.path}/package.json: ${SCOPE}/${name} declared at ${range} in ${field} but ` +
              `absent from ${modules}; re-run \`pnpm install\``,
          )
          continue
        }
        if (version !== range) {
          problems.push(
            `  - ${entry.path}/package.json: ${SCOPE}/${name} installed at ${version}, declared at ` +
              `${range}; re-run \`pnpm install\``,
          )
        }
      }
    }
  }

  const pdfjsDist = readVersion(join(root, 'node_modules', 'pdfjs-dist'))

  const discovery = discoverRuntime(env)
  const { runtime, cli, tried, source, exclusive } = discovery

  if (runtime === null) {
    const route = exclusive
      ? 'the DSH_INSTALL_NODE_MODULES override points at a directory holding no ' +
        `${SCOPE}/dsh package.json (tried ${tried.join(', ')}); the override is exclusive, so no ` +
        'other location is consulted'
      : `no DSH installation was found among ${tried.join(', ')}; set DSH_INSTALL_NODE_MODULES ` +
        "to the installation's node_modules directory"
    // An override that cannot be honoured is a problem on every route: it was
    // given deliberately, and silently ignoring it would compare the wrong
    // installation. Only an absent installation is reclassifiable, because the
    // compile contract does not need the machine's DSH to be present.
    if (requireRuntime || exclusive) problems.push(`  - ${route}`)
    else notes.push(`  - ${route}`)
  } else if (releasePin !== null && runtime.version !== releasePin) {
    problems.push(
      `  - runtime version mismatch: the installed DSH is ${runtime.version} while the contract ` +
        `packages pin ${releasePin}. Re-probe the contract against the installed runtime, or pin ` +
        'the runtime the contract describes',
    )
  }

  // A `dsh` launcher that exists but cannot report a version is a problem rather
  // than a note. The route was expected to work: its directory also supplied the
  // candidate that was compared, so an unreadable CLI means the comparison was
  // made against an installation nobody confirmed this machine actually runs.
  // Downgrading it would let the gate report PASS for an environment whose
  // load-bearing evidence is missing, which is the failure this file exists to
  // prevent. Neither this rule nor the one below it applies under an override:
  // there `cli` is `null` because `PATH` was never probed, not because the probe
  // came back empty, and an ambient launcher is not this gate's evidence.
  if (cli !== null && cli.error !== undefined) {
    problems.push(`  - a \`dsh\` launcher is on PATH but ${cli.error}`)
  }
  if (cli !== null && cli.version !== undefined && runtime !== null && cli.version !== runtime.version) {
    problems.push(
      `  - the \`dsh\` on PATH reports ${cli.version} while ${runtime.root} holds ${runtime.version}; ` +
        'the compared installation is not the one this machine runs',
    )
  }
  if (runtime !== null && runtime.sidebarDocumentPreview === null) {
    notes.push(
      '  - the discovered installation hoists no ' +
        `${SCOPE}/dsh-client-ui-sidebar-documentpreview; the project's own copy is reported instead`,
    )
  }

  return {
    root,
    manifest,
    manifests,
    pins,
    releasePackages,
    independentPackages,
    releasePin,
    installed,
    pdfjsDist,
    runtime,
    cli,
    tried,
    source,
    exclusive,
    problems,
    notes,
  }
}

/**
 * Decide whether the typecheck command actually compiles the contract probes.
 *
 * A gate that runs `tsc` on a program which excludes the probes would report a
 * green compile for files it never read, so the include patterns are read back
 * and the probe files are required to be present.
 *
 * @param root - the project root.
 * @param manifest - the parsed project manifest.
 * @returns problem strings; empty means the probes are in the program.
 */
export function inspectCompileProgram(root, manifest) {
  const problems = []
  const probes = [
    'tests/compatibility/contracts.compile.ts',
    'tests/compatibility/smoke-driver.contracts.compile.ts',
  ]
  for (const probe of probes) {
    if (!existsSync(join(root, probe))) problems.push(`  - ${probe} is missing`)
  }

  const typecheck = manifest?.scripts?.typecheck
  if (typeof typecheck !== 'string' || typecheck.trim() === '') {
    problems.push('  - package.json declares no `typecheck` script; the probes would never compile')
    return problems
  }

  const configName = /-p\s+(\S+)/.exec(typecheck)?.[1]
  if (configName === undefined) {
    problems.push(
      `  - the \`typecheck\` script is ${JSON.stringify(typecheck)}; this gate runs it as-is but ` +
        'cannot confirm which TypeScript program it compiles',
    )
    return problems
  }

  const config = readJsonc(join(root, configName))
  const include = config?.include
  if (!Array.isArray(include)) {
    problems.push(`  - ${configName} declares no \`include\` array; the compiled program is unknown`)
    return problems
  }
  const coversTests = include.some((pattern) => typeof pattern === 'string' && pattern.startsWith('tests/'))
  if (!coversTests) {
    problems.push(
      `  - ${configName} includes ${JSON.stringify(include)}, which does not cover tests/; the ` +
        'contract probes are not part of the compiled program',
    )
  }
  return problems
}

/**
 * Split a shell-free script command into its words.
 *
 * The project's own `typecheck` script is a plain argument list; quoting is
 * honoured so a path with a space would survive, but no shell expansion is
 * attempted, because this gate must not become a way to execute arbitrary shell
 * text out of `package.json`.
 *
 * @param command - the script text.
 * @returns the words, or `null` when the text uses shell syntax.
 */
function splitCommand(command) {
  const words = []
  let current = ''
  let quote = null
  for (const character of command.trim()) {
    if (quote !== null) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current !== '') words.push(current)
      current = ''
      continue
    }
    if ('|&;<>()$`\\'.includes(character)) return null
    current += character
  }
  if (quote !== null) return null
  if (current !== '') words.push(current)
  return words
}

/**
 * Resolve how the project's typecheck should be executed.
 *
 * The declared script is run as the project's own compiler with the project's own
 * arguments, but through the locally installed TypeScript binary rather than
 * through the package manager. That is the difference between a gate and an
 * install: `pnpm run` decides whether the dependency tree is up to date before it
 * runs a script, so pointed at a tree it does not recognise it installs one — a
 * side effect this gate promises never to have. The resolved command is reported,
 * so the substitution is visible rather than silent.
 *
 * @param root - the project root.
 * @param manifest - the parsed project manifest.
 * @returns `{ command, args, detail }` or `{ detail }` when no local compiler was found.
 */
function typecheckInvocation(root, manifest) {
  const script = manifest?.scripts?.typecheck
  if (typeof script !== 'string') return { detail: 'package.json declares no `typecheck` script' }
  const words = splitCommand(script)
  if (words === null || words.length === 0 || words[0] !== 'tsc') {
    return { detail: `the \`typecheck\` script is ${JSON.stringify(script)}` }
  }
  const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(compiler)) {
    return { detail: `${compiler} does not exist; run \`pnpm install\`` }
  }
  return { command: process.execPath, args: [compiler, ...words.slice(1)], detail: script }
}

/**
 * Run the project's own typecheck.
 * @param root - the project root.
 * @param manifest - the parsed project manifest.
 * @returns `{ ok, detail, status }`.
 */
function runTypecheck(root, manifest) {
  const invocation = typecheckInvocation(root, manifest)
  if (invocation.command === undefined) {
    return { ok: false, detail: `could not invoke the compiler: ${invocation.detail}`, status: null }
  }
  console.log(
    `check-dsh-contracts: compiler invocation = ${invocation.command} ` +
      invocation.args.map((arg) => JSON.stringify(arg.replace(/\\/g, '/'))).join(' '),
  )
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 900_000,
    windowsHide: true,
    env: process.env,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, detail: `could not run the compiler: ${result.error.message}`, status: null }
  }
  return { ok: result.status === 0, detail: output, status: result.status }
}

/**
 * Parse the command line.
 * @param argv - `process.argv.slice(2)`.
 * @returns the parsed options.
 */
function parseArgs(argv) {
  const options = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), typecheck: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      const value = argv[index + 1]
      if (value === undefined || value === '') {
        console.error('check-dsh-contracts: --root requires a directory argument')
        process.exit(EXIT_USAGE)
      }
      options.root = resolve(value)
      index += 1
      continue
    }
    if (arg === '--no-typecheck') {
      options.typecheck = false
      continue
    }
    console.error(`check-dsh-contracts: unknown argument ${JSON.stringify(arg)}`)
    process.exit(EXIT_USAGE)
  }
  return options
}

/**
 * Print the compatibility report and decide the exit code.
 * @param options - parsed command-line options.
 */
function main(options) {
  const state = inspectContractEnvironment({ root: options.root })
  const rootIsDirectory = existsSync(options.root) && statSync(options.root).isDirectory()
  const problems = [...state.problems]

  console.log(`check-dsh-contracts: project root = ${state.root}`)
  console.log(`check-dsh-contracts: Node version = ${process.version}`)

  if (!rootIsDirectory || state.manifest === null) {
    console.error(`check-dsh-contracts: FAIL\n${problems.join('\n')}`)
    process.exitCode = EXIT_INCONSISTENT
    return
  }

  console.log(`check-dsh-contracts: project contract release pin = ${state.releasePin ?? 'inconsistent'}`)
  console.log(
    `check-dsh-contracts: contract manifests (${state.manifests.length}) = ` +
      state.manifests
        .map((entry) => `${entry.path}/package.json (${entry.pins.size} pin(s))`)
        .join(', '),
  )
  console.log(
    `check-dsh-contracts: project contract packages (${state.pins.size}) = ` +
      [...state.pins]
        .map(([name, { range }]) => `${SCOPE}/${name}@${range}`)
        .join(', '),
  )
  const independent = [...new Set(state.independentPackages)]
  console.log(
    `check-dsh-contracts: excluded from the release pin = ` +
      (independent.length === 0
        ? '(none)'
        : independent
            .map((name) => `${SCOPE}/${name}@${state.pins.get(name)?.range ?? '?'} (independent versioning)`)
            .join(', ')),
  )
  console.log(
    `check-dsh-contracts: installed project versions = ` +
      [...state.installed].map(([name, version]) => `${SCOPE}/${name}@${version ?? 'MISSING'}`).join(', '),
  )
  console.log(`check-dsh-contracts: installed pdfjs-dist version = ${state.pdfjsDist ?? 'MISSING'}`)
  console.log(`check-dsh-contracts: runtime discovery = ${state.source}`)
  console.log(
    `check-dsh-contracts: current DSH runtime version = ${state.runtime?.version ?? 'NOT FOUND'}` +
      (state.runtime === null ? '' : ` (${state.runtime.root})`),
  )
  console.log(
    `check-dsh-contracts: runtime sidebar-documentpreview version = ` +
      `${state.runtime?.sidebarDocumentPreview ?? 'not hoisted by the installation'}`,
  )
  if (state.exclusive === true) {
    console.log('check-dsh-contracts: PATH CLI report = NOT PROBED (explicit override)')
  } else if (state.cli !== null) {
    console.log(
      `check-dsh-contracts: PATH CLI report = ` +
        `${state.cli.version ?? `unreadable (${state.cli.error})`}`,
    )
  }

  const programProblems = inspectCompileProgram(state.root, state.manifest)
  problems.push(...programProblems)

  if (options.typecheck) {
    console.log('check-dsh-contracts: running the project `typecheck` script (compiles the contract probes)')
    const result = runTypecheck(state.root, state.manifest)
    if (result.ok) {
      console.log(`check-dsh-contracts: typecheck = PASS`)
    } else {
      console.log(`check-dsh-contracts: typecheck = FAIL (exit ${result.status ?? '?'})`)
      if (result.detail !== '') console.log(result.detail)
      problems.push('  - the `typecheck` script failed; the contract probes do not compile')
    }
  } else {
    console.log('check-dsh-contracts: typecheck = SKIPPED (--no-typecheck)')
  }

  if (state.notes.length > 0) console.log(`check-dsh-contracts: notes\n${state.notes.join('\n')}`)

  if (problems.length > 0) {
    console.error(`check-dsh-contracts: FAIL\n${problems.join('\n')}`)
    process.exitCode = EXIT_INCONSISTENT
    return
  }
  console.log('check-dsh-contracts: PASS')
}

const isEntryPoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isEntryPoint) main(parseArgs(process.argv.slice(2)))
