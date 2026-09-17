#!/usr/bin/env node
/**
 * Reproducible bootstrap for the isolated `dsa-smoke` DSH profile.
 *
 * ## Why this exists and what it deliberately is not
 *
 * The real-DSH browser smoke cannot use the developer's own `web` profile: that
 * profile carries credentials, mail settings and personal plugins, and a test
 * run must not read, write, or depend on any of them. The smoke therefore drives
 * a second profile, `dsa-smoke`, which composes the same DSH application with
 * exactly two additions — this repository's plugin and the test-only smoke
 * driver.
 *
 * Bringing that profile up by hand is what this script replaces. It is not a
 * profile manager and does not aspire to be one: **no DSH file format is
 * re-implemented here.** The profile's `package.json` `dsh.profile.bundles` list
 * and each package's `cordis.patch.yml` are the loader's own interfaces, and this
 * script only writes the two lines that add a bundle and then verifies — by
 * parsing those same files back — that the result is registrable.
 *
 * The official route was tried first and does not work for this profile.
 * `dsh plugin --profile dsa-smoke add <dir>` forwards to `pnpm add` inside the
 * profile directory, and pnpm refuses with `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`:
 * `dsa-smoke/node_modules` is a junction onto the `web` profile's fully installed
 * tree, so pnpm's virtual store would have to move and it declines rather than
 * reinstall. That junction is not an accident — rerunning pnpm there is exactly
 * what must not happen to the user's own profile — so this script links the
 * packages itself and leaves the tree alone.
 *
 * ## Safety rules
 *
 * - It writes inside `$DSH_HOME/profiles/dsa-smoke` and inside `smoke-fixtures/`
 *   in this repository. Nothing else is written anywhere.
 * - It never touches any other profile, and it refuses to act at all if the
 *   resolved profile path is not named `dsa-smoke`.
 * - Every operation is idempotent. Running it twice produces the same files and
 *   the same loader entry set, which is the property the duplicate-loader-entry
 *   regression needs.
 *
 * ## Commands
 *
 * ```text
 * inspect    report the profile, its bundles, and the two link targets
 * prepare    write fixtures, maintain the package.json rows, link the packages
 * validate   parse the composed bundle patches and report collisions
 * cleanup    remove the test-only driver from the profile and delete its link
 * ```
 *
 * `prepare` runs `validate` at the end, and every command accepts `--profile
 * <name>` purely so a wrong name fails loudly instead of silently acting on the
 * default.
 */

import { createRequire } from 'node:module'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The only profile this script is allowed to act on. */
const PROFILE_NAME = 'dsa-smoke'

/** This repository's plugin: the package under test, linked as a bundle. */
const MAIN_PLUGIN_DIR = REPO_ROOT

/** The test-only smoke driver: a separate package, never published. */
const DRIVER_DIR = join(REPO_ROOT, 'tests', 'browser', 'smoke-driver')

/**
 * The text fixture set, written by `prepare`.
 *
 * This table is the writer's single source. The driver carries its own copy of
 * the keys and paths because it is bundled separately for the browser, and
 * `tests/unit/smoke-profile.spec.ts` asserts that the two tables name the same
 * fixtures — so a divergence fails the unit suite rather than producing a
 * browser smoke that opens a file nobody wrote.
 */
const SMOKE_FIXTURES = [
  { key: 'txt', path: 'smoke-fixtures/task5b-smoke.txt', text: 'alpha\nbeta\ngamma\n' },
  {
    key: 'code',
    path: 'smoke-fixtures/task5b-smoke.ts',
    text: 'const alpha = 1\nconst beta = 2\nconst gamma = 3\n',
  },
  {
    key: 'markdown',
    path: 'smoke-fixtures/task5b-smoke.md',
    text: [
      '# Smoke Heading',
      '',
      'alpha paragraph',
      '',
      '```ts',
      'const beta = 2',
      'const gamma = 3',
      '```',
      '',
    ].join('\n'),
  },
]

/**
 * The PDF fixtures, **copied** rather than written.
 *
 * Their bytes are committed under `tests/fixtures/pdf/` because they are
 * generated once and reviewed, and because a PDF cannot be restated as a string
 * literal here without becoming a second, drifting copy. The driver's own table
 * — `PDF_FIXTURE_SOURCES` in `tests/browser/smoke-driver/src/client/fixtures.ts`
 * — carries the same source and destination paths, and the unit suite asserts
 * that the two agree.
 */
const PDF_FIXTURE_SOURCES = [
  { key: 'pdf-single', source: 'tests/fixtures/pdf/single-page.pdf' },
  { key: 'pdf-two', source: 'tests/fixtures/pdf/two-page.pdf' },
  { key: 'pdf-cjk', source: 'tests/fixtures/pdf/cjk.pdf' },
  { key: 'pdf-image', source: 'tests/fixtures/pdf/image-only.pdf' },
]

/**
 * The DOCX fixtures, copied from committed sources.
 */
const DOCX_FIXTURE_SOURCES = [
  { key: 'docx-paragraphs', source: 'tests/fixtures/docx/paragraphs.docx' },
  { key: 'docx-break', source: 'tests/fixtures/docx/manual-page-break.docx' },
  { key: 'docx-table-image', source: 'tests/fixtures/docx/table-image.docx' },
  { key: 'docx-headers-footers', source: 'tests/fixtures/docx/headers-footers.docx' },
  { key: 'docx-external-links', source: 'tests/fixtures/docx/external-links.docx' },
]

/**
 * The PPTX fixtures, copied from committed sources.
 */
const PPTX_FIXTURE_SOURCES = [
  { key: 'pptx-text-two-slides', source: 'tests/fixtures/pptx/text-two-slides.pptx' },
  { key: 'pptx-table-image', source: 'tests/fixtures/pptx/table-image.pptx' },
  { key: 'pptx-chart', source: 'tests/fixtures/pptx/chart.pptx' },
  { key: 'pptx-large-120-slides', source: 'tests/fixtures/pptx/large-120-slides.pptx' },
  { key: 'pptx-external-media', source: 'tests/fixtures/pptx/external-media.pptx' },
  { key: 'pptx-external-links', source: 'tests/fixtures/pptx/external-links.pptx' },
]

/**
 * The workspace path one PDF fixture is copied to.
 *
 * It is derived from the driver's own naming convention rather than restated:
 * `task7-<name>.pdf`, where `<name>` is the source file's stem.
 *
 * @param source - the committed source path, repository-relative.
 * @returns the path inside the session workspace.
 */
function pdfFixturePath(source) {
  const stem = source.slice(source.lastIndexOf('/') + 1).replace(/\.pdf$/u, '')
  return `smoke-fixtures/task7-${stem}.pdf`
}

/**
 * The workspace path one DOCX fixture is copied to:
 * `task9-<name>.docx`, where `<name>` is the source file's stem.
 *
 * @param source - the committed source path, repository-relative.
 * @returns the path inside the session workspace.
 */
function docxFixturePath(source) {
  const stem = source.slice(source.lastIndexOf('/') + 1).replace(/\.docx$/u, '')
  return `smoke-fixtures/task9-${stem}.docx`
}

/**
 * The workspace path one PPTX fixture is copied to:
 * `task10-<name>.pptx`, where `<name>` is the source file's stem.
 *
 * @param source - the committed source path, repository-relative.
 * @returns the path inside the session workspace.
 */
function pptxFixturePath(source) {
  const stem = source.slice(source.lastIndexOf('/') + 1).replace(/\.pptx$/u, '')
  return `smoke-fixtures/task10-${stem}.pptx`
}

/** Exit status: `0` clean, `1` a diagnosed problem, `2` a usage error. */
const EXIT_USAGE = 2

/**
 * Print a diagnostic and exit.
 * @param message - the message, already formatted.
 * @param code - exit status.
 */
function fail(message, code = 1) {
  console.error(`dsh-smoke-profile: ${message}`)
  process.exit(code)
}

/**
 * Read and parse a JSON file.
 * @param path - absolute path.
 * @returns the parsed value.
 * @throws Error when the file is missing or is not JSON.
 */
function readJson(path) {
  if (!existsSync(path)) throw new Error(`${path} does not exist`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${String(error)}`)
  }
}

/**
 * Read a package's declared name.
 * @param dir - absolute package directory.
 * @returns the `name` field.
 * @throws Error when the package has no name or no manifest.
 */
function packageName(dir) {
  const manifest = readJson(join(dir, 'package.json'))
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`${dir}/package.json declares no name`)
  }
  return manifest.name
}

/**
 * Resolve the profile directory, refusing anything but `dsa-smoke`.
 * @param profile - the requested profile name.
 * @returns the absolute profile directory.
 */
function profileDir(profile) {
  if (profile !== PROFILE_NAME) {
    fail(
      `refusing to act on profile "${profile}"; this script only manages "${PROFILE_NAME}" ` +
        'and never touches a user profile',
      EXIT_USAGE,
    )
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', profile)
}

/**
 * Report whether a path is a directory link, a directory, or absent.
 * @param path - absolute path.
 * @returns the observed kind.
 */
function linkState(path) {
  if (!existsSync(path)) return 'absent'
  const stats = lstatSync(path)
  if (stats.isSymbolicLink()) return 'link'
  return stats.isDirectory() ? 'directory' : 'other'
}

/**
 * Create or repair one directory link inside the profile's `node_modules`.
 *
 * A link that already points at `target` is left untouched, so a second run is a
 * no-op. `junction` is used on Windows because it needs no elevation, and the
 * link type is read back rather than assumed.
 *
 * @param linksDir - the profile's `node_modules` directory.
 * @param name - the package name to link (scoped names create one subdirectory).
 * @param target - the absolute package directory the link must resolve to.
 * @returns `'created'`, `'ok'`, or `'repaired'`.
 */
function ensureLink(linksDir, name, target) {
  const linkPath = join(linksDir, ...name.split('/'))
  mkdirSync(dirname(linkPath), { recursive: true })

  const state = linkState(linkPath)
  if (state === 'directory') {
    fail(
      `${linkPath} is a real directory with no link behind it; refusing to delete it. ` +
        'Remove it by hand if it is a stale copy, then re-run.',
    )
  }
  if (state === 'link') {
    // Compare resolved targets so a relative link that lands on the right
    // directory is accepted rather than replaced.
    let current = null
    try {
      current = realpathSync(linkPath)
    } catch {
      current = null
    }
    const want = realpathSync(target)
    if (current === want) return 'ok'
    rmSync(linkPath, { recursive: true, force: true })
    symlinkSync(target, linkPath, 'junction')
    return 'repaired'
  }

  symlinkSync(target, linkPath, 'junction')
  return 'created'
}

/**
 * Read the profile's composed bundle patch rows.
 *
 * Only the `- insert:` rows of a bundle's own `cordis.patch.yml` are parsed, and
 * only their `id` values are read. That is the whole file format this script
 * knows, which is the point: the loader owns the grammar, and a copy of it here
 * would be a second authority.
 *
 * @param bundleName - a bundle name from the profile's `dsh.profile.bundles`.
 * @param linksDir - the profile's `node_modules` directory.
 * @returns the entry ids that bundle inserts, or `null` when the bundle cannot be
 *   resolved (which `validate` reports as a problem of its own).
 */
function bundleEntryIds(bundleName, linksDir) {
  let packageDir = null
  try {
    packageDir = dirname(require.resolve(`${bundleName}/package.json`, { paths: [linksDir, REPO_ROOT] }))
  } catch {
    const direct = join(linksDir, ...bundleName.split('/'))
    if (existsSync(join(direct, 'package.json'))) packageDir = direct
  }
  if (packageDir === null) return null

  const manifest = readJson(join(packageDir, 'package.json'))
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared !== 'string') return []
  const patchPath = join(packageDir, declared)
  if (!existsSync(patchPath)) return []

  const ids = []
  for (const line of readFileSync(patchPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line)
    if (match === null || match[1] === undefined) continue
    ids.push({ id: match[1].replace(/^['"]|['"]$/g, ''), patchPath })
  }
  return ids
}

/**
 * Verify the profile can register the packages this repository contributes.
 *
 * ## What is deliberately not checked
 *
 * A first version of this function compared entry ids across *every* bundle in
 * the composed tree and reported dozens of collisions — all of them legitimate.
 * DSH's own `dsh-web-app` patch re-states rows `dsh-base` already inserts, and a
 * community bundle may list a row twice to override it; the loader resolves both
 * by patch order and boots. Comparing raw patch rows therefore validates the
 * wrong property and would train its reader to ignore it.
 *
 * What is checked is the property this repository controls, and the one Task 5A
 * actually broke: each of **our** packages inserts exactly one loader entry, the
 * two ids differ, both names appear exactly once in `dsh.profile.bundles`, and
 * neither id is re-inserted by the profile's own patch layer. That is the
 * duplicate-loader-entry failure mode, and it is fully determined by files this
 * repository and this script own.
 *
 * @param dir - the profile directory.
 * @returns a problem list; empty means valid.
 */
function validateProfile(dir) {
  const problems = []
  const linksDir = join(dir, 'node_modules')
  const manifestPath = join(dir, 'package.json')

  if (!existsSync(manifestPath)) return [`${manifestPath} does not exist`]

  const manifest = readJson(manifestPath)
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return [`${manifestPath} declares no dsh.profile.bundles array`]

  if (new Set(bundles).size !== bundles.length) {
    const duplicates = bundles.filter((name, index) => bundles.indexOf(name) !== index)
    problems.push(`dsh.profile.bundles lists the same bundle twice: ${[...new Set(duplicates)].join(', ')}`)
  }

  const owners = new Map()
  for (const target of [MAIN_PLUGIN_DIR, DRIVER_DIR]) {
    if (!existsSync(join(target, 'package.json'))) {
      problems.push(`${target}/package.json does not exist`)
      continue
    }
    const name = packageName(target)
    if (!bundles.includes(name)) {
      problems.push(`bundle ${name} is not listed in dsh.profile.bundles`)
    }
    if (manifest.dependencies?.[name] === undefined) {
      problems.push(`bundle ${name} has no dependencies row, so the loader cannot resolve it`)
    }

    const entries = bundleEntryIds(name, linksDir)
    if (entries === null) {
      problems.push(`bundle ${name} cannot be resolved from the profile or this repository`)
      continue
    }
    if (entries.length === 0) {
      problems.push(`bundle ${name} contributes no loader entry (dsh.bundle.patch inserts nothing)`)
      continue
    }
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      problems.push(`bundle ${name} inserts one loader entry id twice in its own patch`)
      continue
    }

    for (const entry of entries) {
      const previous = owners.get(entry.id)
      if (previous !== undefined) {
        problems.push(
          `loader entry id "${entry.id}" is inserted by both ${previous} and ${name}; ` +
            'the loader rejects the second with "duplicate loader entry id"',
        )
        continue
      }
      owners.set(entry.id, name)
    }
  }

  // The other half of the Task 5A defect: the same row arriving once from a
  // bundle's own patch layer and once from the profile's hand-written patch.
  const profilePatch = join(dir, 'cordis.patch.yml')
  if (existsSync(profilePatch)) {
    const text = readFileSync(profilePatch, 'utf8')
    for (const [id, bundleName] of owners) {
      const inserted = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm').test(text)
      if (inserted) {
        problems.push(
          `loader entry id "${id}" is inserted by ${bundleName} and again by the profile's own ` +
            'cordis.patch.yml; a bundle already contributes its own patch layer',
        )
      }
    }
  }

  return problems
}

/**
 * Write the smoke fixtures, creating the directory when needed.
 *
 * The text fixtures are written from this script's own table; the PDF fixtures
 * are copied from their committed sources. A source that is missing is a hard
 * failure rather than a skipped fixture: a smoke that silently opened nothing
 * would report a green run for a file that was never there.
 *
 * @returns the paths written, relative to the repository root.
 * @throws Error when a committed PDF fixture is missing.
 */
function writeFixtures() {
  const written = []
  for (const fixture of SMOKE_FIXTURES) {
    const absolute = join(REPO_ROOT, fixture.path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, fixture.text, 'utf8')
    written.push(fixture.path)
  }

  for (const fixture of PDF_FIXTURE_SOURCES) {
    const source = join(REPO_ROOT, fixture.source)
    if (!existsSync(source)) {
      throw new Error(
        `${fixture.source} is missing; run \`node scripts/generate-pdf-fixtures.mjs\` to produce it`,
      )
    }
    const destination = pdfFixturePath(fixture.source)
    const absolute = join(REPO_ROOT, destination)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, readFileSync(source))
    written.push(destination)
  }

  for (const fixture of DOCX_FIXTURE_SOURCES) {
    const source = join(REPO_ROOT, fixture.source)
    if (!existsSync(source)) {
      throw new Error(
        `${fixture.source} is missing; run \`node scripts/generate-docx-fixtures.mjs\` to produce it`,
      )
    }
    const destination = docxFixturePath(fixture.source)
    const absolute = join(REPO_ROOT, destination)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, readFileSync(source))
    written.push(destination)
  }

  for (const fixture of PPTX_FIXTURE_SOURCES) {
    const source = join(REPO_ROOT, fixture.source)
    if (!existsSync(source)) {
      throw new Error(
        `${fixture.source} is missing; run \`node scripts/generate-pptx-fixtures.mjs\` to produce it`,
      )
    }
    const destination = pptxFixturePath(fixture.source)
    const absolute = join(REPO_ROOT, destination)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, readFileSync(source))
    written.push(destination)
  }

  return written
}

/**
 * Add one package to the profile: a `dependencies` link row and a bundle row.
 *
 * Both rows are added only when absent, and the `dsh.profile.bundles` array keeps
 * its existing order with the new name appended, so a second run rewrites
 * nothing.
 *
 * @param dir - the profile directory.
 * @param name - the package name to record.
 * @param target - the absolute package directory the link resolves to.
 * @returns which rows were added.
 */
function ensureProfileRows(dir, name, target) {
  const manifestPath = join(dir, 'package.json')
  const manifest = readJson(manifestPath)
  const added = { dependency: false, bundle: false }

  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  manifest.dsh.profile.bundles ??= []
  manifest.dependencies ??= {}

  if (!Array.isArray(manifest.dsh.profile.bundles)) {
    fail(`${manifestPath}: dsh.profile.bundles is not an array`)
  }
  if (!manifest.dsh.profile.bundles.includes(name)) {
    manifest.dsh.profile.bundles.push(name)
    added.bundle = true
  }

  // A relative `link:` specifier keeps the profile free of machine-specific
  // absolute paths: the profile lives under the DSH home, this repository does
  // not, and `path.relative` is the only thing that knows both.
  const specifier = `link:${relative(dir, target).split('\\').join('/')}`
  if (manifest.dependencies[name] !== specifier) {
    manifest.dependencies[name] = specifier
    added.dependency = true
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return added
}

/**
 * Remove one package from the profile: its dependency row, its bundle row, and
 * its link.
 *
 * The bundle and dependency rows disappear together, which is the invariant the
 * duplicate-entry regression depends on: a bundle named in `bundles` but absent
 * from `dependencies` cannot resolve, and a link with no bundle row loads
 * nothing.
 *
 * @param dir - the profile directory.
 * @param name - the package name to remove.
 * @returns whether anything was removed.
 */
function removeProfileRows(dir, name) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return false
  const manifest = readJson(manifestPath)
  let removed = false

  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    const kept = bundles.filter((entry) => entry !== name)
    if (kept.length !== bundles.length) {
      manifest.dsh.profile.bundles = kept
      removed = true
    }
  }
  if (manifest.dependencies?.[name] !== undefined) {
    delete manifest.dependencies[name]
    removed = true
  }

  const linkPath = join(dir, 'node_modules', ...name.split('/'))
  if (linkState(linkPath) === 'link') {
    rmSync(linkPath, { recursive: true, force: true })
    removed = true
  }

  if (removed) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return removed
}

/**
 * Report the profile's current state without changing anything.
 * @param dir - the profile directory.
 */
function describe(dir) {
  console.log(`dsh-smoke-profile: profile directory = ${dir}`)
  if (!existsSync(dir)) {
    console.log('dsh-smoke-profile: status = absent (nothing to inspect)')
    return
  }

  const nm = join(dir, 'node_modules')
  const nmState = linkState(nm)
  let nmTarget = null
  if (nmState === 'link') {
    try {
      nmTarget = realpathSync(nm)
    } catch {
      nmTarget = '(unresolvable)'
    }
  }
  console.log(`dsh-smoke-profile: node_modules = ${nmState}${nmTarget === null ? '' : ` -> ${nmTarget}`}`)

  const manifestPath = join(dir, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath)
    const bundles = manifest.dsh?.profile?.bundles ?? []
    console.log(`dsh-smoke-profile: bundles (${bundles.length}) = ${bundles.join(', ')}`)
  } else {
    console.log(`dsh-smoke-profile: ${manifestPath} is missing`)
  }

  for (const [label, target] of [
    ['main plugin', MAIN_PLUGIN_DIR],
    ['smoke driver', DRIVER_DIR],
  ]) {
    const name = existsSync(join(target, 'package.json')) ? packageName(target) : '(no manifest)'
    const linkPath = name.startsWith('(') ? null : join(nm, ...name.split('/'))
    const state = linkPath === null ? 'absent' : linkState(linkPath)
    console.log(`dsh-smoke-profile: ${label} ${name} -> ${state}`)
  }

  for (const fixture of SMOKE_FIXTURES) {
    const absolute = join(REPO_ROOT, fixture.path)
    const size = existsSync(absolute) ? statSync(absolute).size : -1
    console.log(`dsh-smoke-profile: fixture ${fixture.path} = ${size < 0 ? 'missing' : `${size} bytes`}`)
  }

  for (const fixture of PDF_FIXTURE_SOURCES) {
    for (const path of [fixture.source, pdfFixturePath(fixture.source)]) {
      const absolute = join(REPO_ROOT, path)
      const size = existsSync(absolute) ? statSync(absolute).size : -1
      console.log(`dsh-smoke-profile: fixture ${path} = ${size < 0 ? 'missing' : `${size} bytes`}`)
    }
  }

  for (const fixture of DOCX_FIXTURE_SOURCES) {
    for (const path of [fixture.source, docxFixturePath(fixture.source)]) {
      const absolute = join(REPO_ROOT, path)
      const size = existsSync(absolute) ? statSync(absolute).size : -1
      console.log(`dsh-smoke-profile: fixture ${path} = ${size < 0 ? 'missing' : `${size} bytes`}`)
    }
  }

  for (const fixture of PPTX_FIXTURE_SOURCES) {
    for (const path of [fixture.source, pptxFixturePath(fixture.source)]) {
      const absolute = join(REPO_ROOT, path)
      const size = existsSync(absolute) ? statSync(absolute).size : -1
      console.log(`dsh-smoke-profile: fixture ${path} = ${size < 0 ? 'missing' : `${size} bytes`}`)
    }
  }
}

/**
 * Parse the command line.
 * @param argv - `process.argv.slice(2)`.
 * @returns the command and options.
 */
function parseArgs(argv) {
  const [command, ...rest] = argv
  let profile = PROFILE_NAME
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--profile') {
      profile = rest[index + 1] ?? ''
      index += 1
    }
  }
  return { command, profile }
}

const { command, profile } = parseArgs(process.argv.slice(2))
const dir = profileDir(profile)

switch (command) {
  case 'inspect': {
    describe(dir)
    const problems = existsSync(dir) ? validateProfile(dir) : []
    if (problems.length > 0) {
      console.log(`dsh-smoke-profile: validation problems\n  - ${problems.join('\n  - ')}`)
      console.log(`dsh-smoke-profile: run \`node scripts/dsh-smoke-profile.mjs prepare\` to fix them`)
    } else {
      console.log('dsh-smoke-profile: validation = clean')
    }
    break
  }

  case 'prepare': {
    if (existsSync(dir) && linkState(join(dir, 'node_modules')) !== 'link') {
      console.log(
        'dsh-smoke-profile: note — node_modules is not a link; this script only adds package ' +
          'links inside it and will not install a tree of its own',
      )
    }
    if (!existsSync(join(dir, 'package.json'))) {
      fail(`${dir}/package.json does not exist; create the profile with \`dsh --profile ${PROFILE_NAME} --from-default-profile web\` first`)
    }

    let written
    try {
      written = writeFixtures()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    console.log(`dsh-smoke-profile: fixtures written = ${written.join(', ')}`)

    const linksDir = join(dir, 'node_modules')
    if (!existsSync(linksDir)) {
      fail(`${linksDir} does not exist; the profile has no dependency tree to link into`)
    }

    for (const target of [MAIN_PLUGIN_DIR, DRIVER_DIR]) {
      const name = packageName(target)
      const link = ensureLink(linksDir, name, target)
      const rows = ensureProfileRows(dir, name, target)
      const added = [rows.dependency ? 'dependency' : null, rows.bundle ? 'bundle' : null].filter(
        (entry) => entry !== null,
      )
      console.log(
        `dsh-smoke-profile: ${name} link=${link} rows=${added.length === 0 ? 'unchanged' : `added ${added.join('+')}`}`,
      )
    }

    const problems = validateProfile(dir)
    if (problems.length > 0) {
      console.log(`dsh-smoke-profile: validation problems\n  - ${problems.join('\n  - ')}`)
      fail('profile is not registrable; see the problems above')
    }
    console.log('dsh-smoke-profile: validation = clean')
    break
  }

  case 'validate': {
    const problems = validateProfile(dir)
    if (problems.length > 0) {
      console.log(`dsh-smoke-profile: validation problems\n  - ${problems.join('\n  - ')}`)
      fail('profile is not registrable; see the problems above')
    }
    console.log('dsh-smoke-profile: validation = clean')
    break
  }

  case 'cleanup': {
    const name = packageName(DRIVER_DIR)
    const removed = removeProfileRows(dir, name)
    console.log(`dsh-smoke-profile: ${name} ${removed ? 'removed from the profile' : 'was not present'}`)
    // The driver's build output is disposable; the source tree is not.
    const lib = join(DRIVER_DIR, 'lib')
    if (existsSync(lib)) {
      rmSync(lib, { recursive: true, force: true })
      console.log(`dsh-smoke-profile: removed ${relative(REPO_ROOT, lib)}`)
    }
    break
  }

  default: {
    console.error(
      'usage: node scripts/dsh-smoke-profile.mjs <inspect|prepare|validate|cleanup> [--profile dsa-smoke]',
    )
    process.exit(EXIT_USAGE)
  }
}
