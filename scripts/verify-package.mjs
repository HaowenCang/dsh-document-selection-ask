#!/usr/bin/env node
/**
 * Release gate for one packed tarball.
 *
 * ## Why this is a separate script
 *
 * `scripts/verify.mjs` is strictly read-only, deterministic and total: it reads
 * files, prints a report and sets an exit code. Inspecting a real tarball cannot be
 * any of those things without lying about it — it needs an artifact that only
 * `pnpm pack` produces, it needs somewhere to extract it, and the extraction writes
 * to disk. Folding that into `pnpm verify` would either make the static gate depend
 * on a build step or make it silently skip, so the pack-shaped check lives here and
 * carries its own contract.
 *
 * ## Contract
 *
 * - **Read-only inside the repository.** This script never creates, modifies or
 *   deletes anything under the repository root, and it never invokes a packer. The
 *   tarball it inspects must already exist; producing one is the caller's step.
 * - **Offline.** No registry, no network, no clock, no environment variable decides
 *   a verdict. The only inputs are the tarball's own bytes.
 * - **Bounded and self-cleaning.** The tarball is extracted into a directory this
 *   script creates under the operating system's temporary directory and removes
 *   before exiting, including on failure.
 * - **Total.** Every check prints a line, and a check that cannot run is a failure
 *   rather than a skip. The listing is read from the tarball's own tar index, so a
 *   missing entry is named as such rather than inferred from an extraction that
 *   quietly produced less.
 * - **Bounded scope.** It checks the packaging contract this project states in
 *   `package.json` and in `README.md`: the required files are present, the entries
 *   that must not ship are absent, every declared entry point exists inside the
 *   package, and the shipped README's relative links resolve within the tarball.
 *   It does not evaluate the browser bundle, does not run the plugin, and cannot
 *   say whether DSH will load the package — that is what the real-application
 *   acceptance pass is for.
 *
 * ## Usage
 *
 * ```text
 * node scripts/verify-package.mjs [path/to/dsh-document-selection-ask-<version>.tgz]
 * ```
 *
 * With no argument the newest `dsh-document-selection-ask-*.tgz` in the repository
 * root is inspected, because a release check runs immediately after a pack and the
 * newest artifact is the one under review. An explicit path is never second-guessed.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root: this file's own parent. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The package name every artifact this script accepts must carry. */
const PACKAGE_NAME = 'dsh-document-selection-ask'

/** The directory name a npm tarball wraps its contents in. */
const PACKAGE_PREFIX = 'package/'

/**
 * Files the tarball must contain.
 *
 * The three documents are here because the packaged `README.md` links them by
 * relative path: a tarball without them ships a README whose links break for
 * every reader who does not have the repository.
 */
const REQUIRED_FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.mjs',
  'lib/client.js',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'docs/renderer-support.md',
  'docs/security.md',
  'docs/compatibility.md',
]

/**
 * Path shapes the tarball must not contain.
 *
 * The runtime-asset shapes are the ones this project's own architecture forbids:
 * the PDF.js worker, the PDF.js asset families and the Duke sheets WASM are all
 * embedded in `lib/client.js`, and the XLSX worker is constructed from a `blob:`
 * over that embedded source, so a side file with any of these names would be a
 * second delivery path nobody reviewed or a dead entry.
 */
const FORBIDDEN_SHAPES = [
  { label: 'test tree', pattern: /(^|\/)tests\// },
  { label: 'smoke fixture tree', pattern: /(^|\/)smoke-fixtures\// },
  { label: 'Playwright report', pattern: /(^|\/)playwright-report\// },
  { label: 'Playwright results', pattern: /(^|\/)test-results\// },
  { label: 'coverage output', pattern: /(^|\/)coverage\// },
  { label: 'version-control directory', pattern: /(^|\/)\.git\// },
  { label: 'installed dependency tree', pattern: /(^|\/)node_modules\// },
  { label: 'side WASM binary', pattern: /\.wasm$/i },
  { label: 'side PDF worker script', pattern: /pdf\.worker/i },
  { label: 'side XLSX worker script', pattern: /xlsx-worker/i },
  { label: 'side PDF.js asset', pattern: /\.(?:bcmap|pfb)$/i },
  { label: 'source map', pattern: /\.map$/i },
  { label: 'packed artifact', pattern: /\.tgz$/i },
  { label: 'image or screenshot', pattern: /\.(?:png|jpe?g|gif|webp|bmp|tiff?|avif)$/i },
  { label: 'recorded media', pattern: /\.(?:mp4|webm|mov|avi)$/i },
  { label: 'log file', pattern: /\.log$/i },
  { label: 'archive', pattern: /\.(?:zip|tar|gz|7z)$/i },
  { label: 'credential or environment file', pattern: /(^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|crt|cer)$/i },
  { label: 'maintainer status record', pattern: /(^|\/)docs\/STATUS\.md$/ },
  { label: 'developer-only testing guide', pattern: /(^|\/)docs\/testing\.md$/ },
  { label: 'developer-only acceptance procedure', pattern: /(^|\/)docs\/manual-acceptance\.md$/ },
  { label: 'absolute or drive-rooted path', pattern: /(^|\/)[A-Za-z]:\// },
]

/** Findings, as flat one-line strings; the report prints them under their check. */
const findings = []

/**
 * Record one finding.
 * @param check - the check's short name.
 * @param detail - what was found, in one sentence.
 */
function fail(check, detail) {
  findings.push({ check, detail })
}

/**
 * Print a check's verdict.
 * @param check - the check's short name.
 * @param passed - whether it passed.
 * @param detail - the evidence line printed either way.
 */
function verdict(check, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${check}: ${detail}`)
}

/**
 * Read the tarball's own tar index.
 *
 * The listing is parsed from the archive rather than from the extracted tree, so a
 * file that failed to extract is still reported as present or absent by the
 * archive's own record. Only the two entry types npm emits are handled — a regular
 * file and a directory — and an entry type this parser does not recognize is
 * reported rather than ignored, because a silently skipped entry is how a forbidden
 * file would travel unnoticed. The ustar/PAX `prefix` field is honoured, which is
 * how npm writes a path longer than 100 bytes.
 *
 * @param bytes - the whole tarball.
 * @returns `{ entries, unrecognized }`, both arrays of POSIX paths.
 */
function readTarIndex(bytes) {
  // npm writes a gzipped tar. The index has to be read from the decompressed
  // stream; parsing the compressed bytes as tar headers produces garbage names,
  // which is a failure mode worth stating because it looks like a broken archive
  // rather than a broken reader.
  const archive = gunzipSync(bytes)
  const entries = []
  const unrecognized = []
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    // A tar block with no name is the end-of-archive marker: two zero blocks.
    if (header.every((byte) => byte === 0)) break
    const readString = (start, length) => {
      const field = header.subarray(start, start + length)
      const end = field.indexOf(0)
      return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
    }
    const name = readString(0, 100)
    const prefix = readString(345, 155)
    const sizeField = readString(124, 12).trim()
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8)
    const typeFlag = String.fromCharCode(header[156])
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (typeFlag === '0' || typeFlag === '\u0000') entries.push(path)
    else if (typeFlag === '5') entries.push(`${path.replace(/\/$/, '')}/`)
    else unrecognized.push(`${path} (type ${JSON.stringify(typeFlag)})`)
    if (!Number.isFinite(size) || size < 0) break
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return { entries, unrecognized }
}

/**
 * Decide whether a declared target is present in the tarball.
 *
 * A target is present when the archive carries the file itself. A target that names
 * a directory is not accepted as satisfied by the directory entry: every entry
 * point this package declares is a file, and accepting a directory would let a
 * manifest point at a path the loader cannot read.
 *
 * @param entries - the archive's paths, with the `package/` prefix.
 * @param target - the target as written in `package.json`, `./` and all.
 * @returns true when the archive carries that file.
 */
function targetIsShipped(entries, target) {
  const relative = target.replace(/^\.\//, '')
  return entries.includes(`${PACKAGE_PREFIX}${relative}`)
}

/**
 * Collect the entry points `package.json` declares.
 * @param manifest - the parsed shipped manifest.
 * @returns `{ where, value }` pairs, in declaration order.
 */
function declaredTargets(manifest) {
  const targets = []
  const add = (where, value) => {
    if (typeof value === 'string') targets.push({ where, value })
  }
  add('main', manifest.main)
  add('types', manifest.types)
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === 'string') add(`exports["${subpath}"]`, target)
    else if (target !== null && typeof target === 'object') {
      for (const [condition, value] of Object.entries(target)) add(`exports["${subpath}"].${condition}`, value)
    }
  }
  add('dsh.bundle.patch', manifest.dsh?.bundle?.patch)
  return targets
}

/**
 * Collect the relative markdown link targets in a document.
 *
 * Only link and image targets are collected, only `./`-less relative ones (anything
 * with a scheme, a fragment-only target or a root-relative path is skipped), and the
 * fragment and query are stripped before the path is returned. An absolute path is
 * returned as-is so the caller can report it as the defect it is.
 *
 * @param text - the markdown source.
 * @returns the link targets, in file order, deduplicated.
 */
function relativeLinkTargets(text) {
  const found = new Set()
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? ''
    if (target === '' || target.startsWith('#') || target.startsWith('/')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    found.add(target.split('#')[0].split('?')[0])
  }
  return [...found]
}

/**
 * Locate the tarball to inspect.
 *
 * An explicit argument is used exactly as given and is not second-guessed. With no
 * argument, the newest matching artifact in the repository root is chosen, and its
 * modification time is reported, because "which tarball did this pass?" is the
 * first question a release record has to answer.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns the absolute tarball path, or `null` when none was found.
 */
function resolveTarball(argv) {
  const explicit = argv.find((argument) => !argument.startsWith('--'))
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) return resolve(process.cwd(), explicit)
    return explicit
  }
  const candidates = readdirSync(ROOT)
    .filter((name) => name.startsWith(`${PACKAGE_NAME}-`) && name.endsWith('.tgz'))
    .map((name) => ({ name, path: join(ROOT, name), mtime: statSync(join(ROOT, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
  if (candidates.length === 0) return null
  console.log(`verify-package: no path given, inspecting the newest tarball in the repository root`)
  return candidates[0].path
}

/**
 * Run every check, print the report, and set the exit code.
 * @param tarball - the absolute path of the tarball to inspect.
 */
function inspect(tarball) {
  const stat = statSync(tarball)
  console.log(`verify-package: tarball = ${tarball}`)
  console.log(`verify-package: bytes = ${stat.size}`)

  const { entries, unrecognized } = readTarIndex(readFileSync(tarball))

  const outsidePackage = entries.filter((entry) => !entry.startsWith(PACKAGE_PREFIX))
  verdict(
    'archive layout',
    entries.length > 0 && outsidePackage.length === 0,
    entries.length === 0
      ? 'the tar index is empty, so this script could not read the archive'
      : outsidePackage.length === 0
        ? `all ${entries.length} entries are under ${PACKAGE_PREFIX}`
        : `entries outside ${PACKAGE_PREFIX}: ${outsidePackage.join(', ')}`,
  )
  if (entries.length === 0) fail('archive layout', 'no entry could be read from the tar index')

  verdict(
    'entry types',
    unrecognized.length === 0,
    unrecognized.length === 0 ? 'every entry is a regular file or a directory' : `unrecognized entries: ${unrecognized.join(', ')}`,
  )
  for (const entry of unrecognized) fail('entry types', `unrecognized tar entry ${entry}`)

  const relative = entries.map((entry) => entry.slice(PACKAGE_PREFIX.length)).filter((entry) => entry !== '')
  const files = new Set(relative.filter((entry) => !entry.endsWith('/')))

  const missing = REQUIRED_FILES.filter((required) => !files.has(required))
  verdict(
    'required files',
    missing.length === 0,
    missing.length === 0 ? `all ${REQUIRED_FILES.length} required files are present` : `missing: ${missing.join(', ')}`,
  )
  for (const name of missing) fail('required files', `the tarball does not carry ${name}`)

  const typeDeclarations = relative.filter((entry) => entry.startsWith('lib/types/') && entry.endsWith('.d.ts'))
  verdict(
    'type declarations',
    typeDeclarations.length > 0,
    `${typeDeclarations.length} declaration file(s) under lib/types/`,
  )
  if (typeDeclarations.length === 0) fail('type declarations', 'the tarball carries no lib/types/**/*.d.ts file')

  const forbidden = []
  for (const entry of relative) {
    for (const { label, pattern } of FORBIDDEN_SHAPES) {
      if (pattern.test(entry)) forbidden.push(`${entry} (${label})`)
    }
  }
  verdict('forbidden entries', forbidden.length === 0, forbidden.length === 0 ? 'none of the forbidden shapes are present' : forbidden.join('; '))
  for (const entry of forbidden) fail('forbidden entries', `the tarball carries ${entry}`)

  const extracted = mkdtempSync(join(tmpdir(), 'dsa-verify-package-'))
  try {
    extract(tarball, extracted)
    const shippedManifestPath = join(extracted, PACKAGE_PREFIX, 'package.json')
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(shippedManifestPath, 'utf8'))
    } catch (error) {
      verdict('shipped manifest', false, `package/package.json is not readable JSON: ${error instanceof Error ? error.message : String(error)}`)
      fail('shipped manifest', 'the shipped package.json could not be parsed')
    }
    if (manifest === null) {
      // The three checks below depend on the shipped manifest, and a check that
      // cannot run is a failure rather than a skip. Printing nothing for them
      // would make the report shorter exactly when it matters most, so each one
      // states its own verdict instead of being skipped by an enclosing branch.
      for (const check of ['package identity', 'declared entry points', 'documented files allowlist']) {
        verdict(check, false, 'package/package.json is not readable JSON, so this check could not run')
        fail(check, 'the shipped package.json could not be parsed, so this check could not run')
      }
    } else {
      const identity = manifest.name === PACKAGE_NAME
      verdict(
        'package identity',
        identity,
        identity ? `${manifest.name}@${manifest.version}` : `name = ${JSON.stringify(manifest.name)}, expected ${PACKAGE_NAME}`,
      )
      if (!identity) fail('package identity', `the shipped package is named ${JSON.stringify(manifest.name)}`)

      const targets = declaredTargets(manifest)
      const absent = targets.filter(({ value }) => !targetIsShipped(entries, value))
      verdict(
        'declared entry points',
        targets.length > 0 && absent.length === 0,
        targets.length === 0
          ? 'the shipped manifest declares no main, types, exports or dsh.bundle.patch'
          : absent.length === 0
            ? `all ${targets.length} declared targets are inside the archive`
            : `not in the archive: ${absent.map(({ where, value }) => `${where} = ${value}`).join(', ')}`,
      )
      for (const { where, value } of absent) fail('declared entry points', `${where} = ${value} is absent from the tarball`)

      const documented = ['docs/renderer-support.md', 'docs/security.md', 'docs/compatibility.md']
      const unlisted = documented.filter((name) => !(manifest.files ?? []).includes(name))
      verdict(
        'documented files allowlist',
        unlisted.length === 0,
        unlisted.length === 0 ? 'the shipped manifest names all three user documents' : `not named in files: ${unlisted.join(', ')}`,
      )
      for (const name of unlisted) fail('documented files allowlist', `the shipped manifest does not name ${name} in its files allowlist`)
    }

    const readmePath = join(extracted, PACKAGE_PREFIX, 'README.md')
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null
    if (readme === null) {
      verdict('shipped README links', false, 'package/README.md is absent, so its links cannot be checked')
      fail('shipped README links', 'package/README.md is absent')
    } else {
      const broken = []
      for (const target of relativeLinkTargets(readme)) {
        const normalised = posix.normalize(target)
        if (normalised.startsWith('..') || isAbsolute(normalised) || /^[A-Za-z]:/.test(normalised)) {
          broken.push(`${target} (leaves the package root)`)
          continue
        }
        if (!files.has(normalised)) broken.push(`${target} (not in the tarball)`)
      }
      verdict(
        'shipped README links',
        broken.length === 0,
        broken.length === 0 ? 'every relative link resolves inside the tarball' : broken.join('; '),
      )
      for (const entry of broken) fail('shipped README links', `package/README.md links to ${entry}`)
    }

    const advisory = relative.filter((entry) => entry.endsWith('.d.ts'))
    console.log(`verify-package: ${files.size} file(s), ${advisory.length} of them TypeScript declarations`)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

/**
 * Extract a tarball with the platform's own `tar`.
 *
 * A hand-written extractor would be a second, less reviewed implementation of the
 * one format this script reads; the platform already ships one, and gzip plus tar
 * are on every supported platform (`bsdtar` on Windows, `gnutar`/`bsdtar`
 * elsewhere). The extraction target is a fresh temporary directory this script
 * created, and `-C` is passed so the archive's own paths are the only thing that
 * decides where inside it each entry lands.
 *
 * @param tarball - the absolute tarball path.
 * @param destination - the empty directory to extract into.
 */
function extract(tarball, destination) {
  const result = spawnSync('tar', ['-xzf', tarball, '-C', destination], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) {
    throw new Error(`tar could not be executed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = result.stderr === null ? '' : result.stderr.toString('utf8').trim()
    throw new Error(`tar exited with ${result.status}${stderr === '' ? '' : `: ${stderr}`}`)
  }
}

/** Exit status: `0` all checks passed, `1` at least one failed, `2` a usage error. */
const EXIT_FAILURE = 1
const EXIT_USAGE = 2

/**
 * Run the gate.
 */
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/verify-package.mjs [path/to/<name>-<version>.tgz]')
    return
  }
  const tarball = resolveTarball(argv)
  if (tarball === null) {
    console.error(`verify-package: no ${PACKAGE_NAME}-*.tgz found in ${ROOT}; run \`pnpm pack\` first`)
    process.exitCode = EXIT_USAGE
    return
  }
  if (!existsSync(tarball)) {
    console.error(`verify-package: tarball not found: ${tarball}`)
    process.exitCode = EXIT_USAGE
    return
  }
  try {
    inspect(tarball)
  } catch (error) {
    fail('inspector', `the inspection itself threw: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`verify-package: inspection failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const failed = findings.length
  if (failed === 0) {
    console.log('verify-package: PASS — every packaging check passed')
    return
  }
  console.error(`verify-package: FAIL — ${failed} finding${failed === 1 ? '' : 's'}`)
  for (const finding of findings) console.error(`  - ${finding.check}: ${finding.detail}`)
  process.exitCode = EXIT_FAILURE
}

main()
