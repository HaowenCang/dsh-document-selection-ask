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
 * - **Nothing is handed to an extractor before this script's own safety gate has
 *   passed.** The archive is parsed in-process first, and the platform `tar` is
 *   invoked only when the tar index parses, every member names a regular file or a
 *   directory, and every member path is a `package/`-relative POSIX path with no
 *   traversal, no absolute form and no Windows path shape. An archive that fails
 *   any of those three is rejected here, by this script, without asking `tar`
 *   whether it happens to agree — "the platform tool would probably refuse it" is
 *   not an implementation of this contract. The extractor invocation count is
 *   printed so a caller can see whether it ran.
 * - **Bounded and self-cleaning.** Extraction happens only after that gate passes,
 *   into a directory this script creates under the operating system's temporary
 *   directory and removes before exiting, including on failure. When the gate fails
 *   no temporary directory is created at all.
 * - **Total.** Every check prints a line, and a check that cannot run is a failure
 *   rather than a skip. A check that needs an extraction prints its own
 *   `extraction was not attempted because archive preflight failed` verdict instead
 *   of disappearing from the report. The listing is read from the tarball's own tar
 *   index, so a missing entry is named as such rather than inferred from an
 *   extraction that quietly produced less.
 * - **Bounded scope.** It checks the packaging contract this project states in
 *   `package.json` and in `README.md`: the required files are present, the entries
 *   that must not ship are absent, every declared entry point exists inside the
 *   package, the packaged prose carries no machine-local absolute path, and the
 *   shipped README's relative links resolve within the tarball. It does not
 *   evaluate the browser bundle, does not run the plugin, and cannot say whether
 *   DSH will load the package — that is what the real-application acceptance pass
 *   is for.
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

/**
 * Path shapes a packaged prose file must not carry.
 *
 * The release contract says the packaged documents describe the package, not the
 * machine the package was built on, so a drive-rooted path or a user's home
 * directory is a defect in the document even when the path it names is harmless.
 * Both patterns are deliberately narrow: the negative lookbehind keeps a URL
 * scheme (`https://`, whose `s:/` would otherwise look like a drive) and a
 * URL path segment out of the match, and neither pattern fires on package-relative
 * paths, on `<placeholder>` forms or on ordinary prose. A test fixture's
 * provenance is not exempt — how a fixture was produced is a fact worth recording,
 * but the absolute path it happened to live at on one machine is not.
 */
const MACHINE_PATH_SHAPES = [
  { label: 'drive-rooted path', pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/ },
  { label: 'POSIX home directory path', pattern: /(?<![A-Za-z0-9])\/(?:home|Users)\/[A-Za-z0-9._-]+\// },
]

/**
 * The packaged prose this script audits for machine-local paths.
 *
 * The list is the package's own user-facing text rather than every shipped file:
 * `package.json` legitimately carries a `file:` specifier, and the JavaScript
 * artifacts are build output, not documents.
 *
 * @param relative - the package-relative paths the archive carries.
 * @returns the paths to audit, in archive order.
 */
function textAuditTargets(relative) {
  const selected = relative.filter(
    (path) => path === 'README.md' || path === 'THIRD_PARTY_NOTICES.md' || /^docs\/[^/]+\.md$/.test(path),
  )
  return [...new Set(selected)].sort()
}

/**
 * The checks that read only the tar index.
 *
 * They are listed by name so that a run which cannot reach them still reports each
 * one, because a check that silently disappears from the report is
 * indistinguishable from a check that passed.
 */
const INDEX_CHECKS = [
  'archive layout',
  'entry types',
  'entry path safety',
  'required files',
  'type declarations',
  'forbidden entries',
  'packaged text paths',
]

/**
 * The checks that need an extracted tree, and therefore need the archive preflight
 * to have passed first.
 */
const EXTRACTION_CHECKS = [
  'shipped manifest',
  'package identity',
  'declared entry points',
  'documented files allowlist',
  'shipped README links',
]

/** The three checks whose conjunction authorizes an extraction. */
const PREFLIGHT_CHECKS = ['archive layout', 'entry types', 'entry path safety']

/** Findings, as flat one-line strings; the report prints them under their check. */
const findings = []

/**
 * How many times the platform extractor was invoked in this run.
 *
 * Printed as a report line rather than kept private, because "this script rejected
 * the archive itself" and "this script asked `tar` and `tar` refused" are different
 * claims and the report should not leave a reader guessing which one it is making.
 */
let extractorInvocations = 0

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
 * Print a FAIL verdict and record it, for a check that could not run.
 * @param check - the check's short name.
 * @param reason - why the check could not run.
 */
function unreachable(check, reason) {
  verdict(check, false, reason)
  fail(check, reason)
}

/**
 * Read one NUL-terminated tar header field.
 *
 * The returned `embeddedNul` flag reports whether non-zero bytes follow the
 * terminator inside the fixed-width field. A name with an embedded NUL is a name
 * whose true end differs between readers, which is exactly the ambiguity a path
 * check must not silently accept, so it is surfaced rather than truncated away.
 *
 * @param header - the 512-byte header block.
 * @param start - the field's offset.
 * @param length - the field's width.
 * @returns `{ text, embeddedNul }`.
 */
function readField(header, start, length) {
  const field = header.subarray(start, start + length)
  const end = field.indexOf(0)
  const text = field.subarray(0, end === -1 ? field.length : end).toString('utf8')
  const tail = end === -1 ? field.subarray(field.length) : field.subarray(end + 1)
  return { text, embeddedNul: tail.some((byte) => byte !== 0) }
}

/**
 * Read the tarball's own tar index, with each member's payload range.
 *
 * The listing is parsed from the archive rather than from the extracted tree, so a
 * file that failed to extract is still reported as present or absent by the
 * archive's own record, and so the path safety gate below can run before anything
 * is handed to an extractor. Only the two entry types npm emits are classified as
 * shippable — a regular file and a directory — and every other type flag is kept
 * with its own name so the report can say which one it was. The ustar/PAX `prefix`
 * field is honoured, which is how npm writes a path longer than 100 bytes.
 *
 * @param bytes - the whole tarball.
 * @returns `{ archive, members, terminated, indexProblem }`, where `archive` is the
 *   decompressed byte range the member payloads index into.
 */
function readTarIndex(bytes) {
  // npm writes a gzipped tar. The index has to be read from the decompressed
  // stream; parsing the compressed bytes as tar headers produces garbage names,
  // which is a failure mode worth stating because it looks like a broken archive
  // rather than a broken reader.
  const archive = gunzipSync(bytes)
  const members = []
  let offset = 0
  let terminated = false
  let indexProblem = null
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    // A tar block with no name is the end-of-archive marker: two zero blocks.
    if (header.every((byte) => byte === 0)) {
      terminated = true
      break
    }
    const nameField = readField(header, 0, 100)
    const prefixField = readField(header, 345, 155)
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim()
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8)
    const typeFlag = String.fromCharCode(header[156])
    const path = prefixField.text === '' ? nameField.text : `${prefixField.text}/${nameField.text}`
    if (!Number.isFinite(size) || size < 0) {
      indexProblem = `the size field of ${JSON.stringify(path)} is not an octal number: ${JSON.stringify(sizeField)}`
      break
    }
    const dataStart = offset + 512
    members.push({
      path,
      typeFlag,
      type: typeFlag === '0' || typeFlag === '\u0000' ? 'file' : typeFlag === '5' ? 'directory' : 'other',
      embeddedNul: nameField.embeddedNul || prefixField.embeddedNul,
      dataStart,
      dataEnd: dataStart + size,
      size,
    })
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return { archive, members, terminated, indexProblem }
}

/**
 * Decide whether one archive member's path is safe to hand to an extractor.
 *
 * The rules are the archive-member contract for a npm tarball and they are checked
 * on the raw recorded path, before and independently of any normalisation, because
 * `package/../../outside` satisfies a raw `package/` prefix test while resolving
 * outside the package. Normalisation is then applied as a second, independent
 * condition rather than as the only one.
 *
 * @param member - one member from the tar index.
 * @returns the violations, each a short noun phrase; empty when the path is safe.
 */
function pathSafetyProblems(member) {
  const raw = member.path
  if (raw === '') return ['an empty member name']
  const problems = []
  if (member.embeddedNul) problems.push('a NUL byte inside the name field')
  if (raw.includes('\\')) problems.push('a backslash, which is not a path separator in a npm tarball')
  if (raw.startsWith('/')) problems.push('an absolute POSIX path')
  if (/^[A-Za-z]:/.test(raw)) problems.push('a drive-rooted path')
  const components = raw.replace(/\/+$/, '').split('/')
  if (components.includes('..')) problems.push('a ".." component')
  if (components.includes('.')) problems.push('a "." component')
  if (components.some((component) => component === '')) problems.push('an empty path component')
  // The normalisation rule is applied only to a member that claims to be inside
  // the package. A member that never claims that is a layout defect, reported as
  // one by the `archive layout` check, and repeating it here would report one
  // defect twice under two names.
  if (raw.startsWith(PACKAGE_PREFIX)) {
    const normalized = posix.normalize(raw)
    if (!normalized.startsWith(PACKAGE_PREFIX)) {
      problems.push(`a normalised form ${JSON.stringify(normalized)} that leaves ${PACKAGE_PREFIX}`)
    }
  }
  return problems
}

/**
 * Return the payload bytes one member records.
 * @param archive - the decompressed archive.
 * @param member - one member from the tar index.
 * @returns the bytes as UTF-8 text, or `null` when the range lies outside the archive.
 */
function memberText(archive, member) {
  if (member.dataEnd > archive.length || member.dataStart > member.dataEnd) return null
  return archive.subarray(member.dataStart, member.dataEnd).toString('utf8')
}

/**
 * Decide whether a declared target is present in the tarball.
 *
 * A target is present when the archive carries the file itself. A target that names
 * a directory is not accepted as satisfied by the directory entry: every entry
 * point this package declares is a file, and accepting a directory would let a
 * manifest point at a path the loader cannot read.
 *
 * @param files - the archive's package-relative file paths.
 * @param target - the target as written in `package.json`, `./` and all.
 * @returns true when the archive carries that file.
 */
function targetIsShipped(files, target) {
  const relative = target.replace(/^\.\//, '')
  return files.has(relative)
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

  let index = null
  try {
    index = readTarIndex(readFileSync(tarball))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    unreachable('archive layout', `the archive could not be read as a gzipped tar: ${detail}`)
    for (const check of INDEX_CHECKS.slice(1)) unreachable(check, 'the tar index could not be read, so this check could not run')
  }

  if (index === null) {
    for (const check of EXTRACTION_CHECKS) unreachable(check, 'extraction was not attempted because archive preflight failed')
    console.log(`verify-package: extractor invocations = ${extractorInvocations}`)
    return
  }

  const { archive, members, terminated, indexProblem } = index

  const outsidePackage = members.filter((member) => !member.path.startsWith(PACKAGE_PREFIX))
  if (members.length === 0) {
    unreachable('archive layout', 'the tar index is empty, so this script could not read the archive')
  } else if (indexProblem !== null) {
    unreachable('archive layout', `the tar index could not be read past one member: ${indexProblem}`)
  } else if (!terminated) {
    unreachable('archive layout', `the archive carries ${members.length} member(s) but no end-of-archive marker, so it is truncated`)
  } else if (outsidePackage.length > 0) {
    unreachable(
      'archive layout',
      `entries outside ${PACKAGE_PREFIX}: ${outsidePackage.map((member) => JSON.stringify(member.path)).join(', ')}`,
    )
  } else {
    verdict('archive layout', true, `the tar index parses to ${members.length} member(s), all under ${PACKAGE_PREFIX}`)
  }

  const typed = members.filter((member) => member.type !== 'other')
  const otherTypes = members.filter((member) => member.type === 'other')
  verdict(
    'entry types',
    otherTypes.length === 0,
    otherTypes.length === 0
      ? `every entry is a regular file or a directory (${typed.length} entries)`
      : `entries this package contract does not allow: ${otherTypes
          .map((member) => `${JSON.stringify(member.path)} (type ${JSON.stringify(member.typeFlag)})`)
          .join(', ')}`,
  )
  for (const member of otherTypes) {
    const named =
      member.typeFlag === '2'
        ? 'a symbolic link'
        : member.typeFlag === '1'
          ? 'a hard link'
          : member.typeFlag === '3' || member.typeFlag === '4'
            ? 'a device node'
            : member.typeFlag === '6'
              ? 'a FIFO'
              : `the type flag ${JSON.stringify(member.typeFlag)}`
    fail('entry types', `${member.path} is ${named}; this package ships regular files and directories only`)
  }

  const unsafe = members
    .map((member) => ({ member, problems: pathSafetyProblems(member) }))
    .filter(({ problems }) => problems.length > 0)
  verdict(
    'entry path safety',
    unsafe.length === 0,
    unsafe.length === 0
      ? `every member is a ${PACKAGE_PREFIX}-relative POSIX path with no traversal, absolute or Windows form`
      : `unsafe member path(s): ${unsafe.map(({ member, problems }) => `${JSON.stringify(member.path)} — ${problems.join('; ')}`).join(' | ')}`,
  )
  for (const { member, problems } of unsafe) {
    fail('entry path safety', `the archive member ${JSON.stringify(member.path)} carries ${problems.join('; ')}`)
  }

  // The gate. Every check below this point either reads the index (safe regardless)
  // or needs an extraction (permitted only when all three preflight checks passed).
  const safeToExtract = PREFLIGHT_CHECKS.every((check) => !findings.some((finding) => finding.check === check))

  const safeMembers = members.filter((member) => member.path.startsWith(PACKAGE_PREFIX) && pathSafetyProblems(member).length === 0)
  const relative = safeMembers
    .map((member) => ({ ...member, relative: member.path.slice(PACKAGE_PREFIX.length) }))
    .filter((member) => member.relative !== '')
  const files = new Set(relative.filter((member) => member.type === 'file').map((member) => member.relative))

  const missing = REQUIRED_FILES.filter((required) => !files.has(required))
  verdict(
    'required files',
    missing.length === 0,
    missing.length === 0 ? `all ${REQUIRED_FILES.length} required files are present` : `missing: ${missing.join(', ')}`,
  )
  for (const name of missing) fail('required files', `the tarball does not carry ${name}`)

  const typeDeclarations = [...files].filter((entry) => entry.startsWith('lib/types/') && entry.endsWith('.d.ts'))
  verdict(
    'type declarations',
    typeDeclarations.length > 0,
    `${typeDeclarations.length} declaration file(s) under lib/types/`,
  )
  if (typeDeclarations.length === 0) fail('type declarations', 'the tarball carries no lib/types/**/*.d.ts file')

  const forbidden = []
  for (const entry of files) {
    for (const { label, pattern } of FORBIDDEN_SHAPES) {
      if (pattern.test(entry)) forbidden.push(`${entry} (${label})`)
    }
  }
  verdict('forbidden entries', forbidden.length === 0, forbidden.length === 0 ? 'none of the forbidden shapes are present' : forbidden.join('; '))
  for (const entry of forbidden) fail('forbidden entries', `the tarball carries ${entry}`)

  // The packaged-text audit reads member payloads straight out of the decompressed
  // archive, so it does not depend on an extraction and still runs for an archive
  // whose preflight failed.
  const audited = textAuditTargets([...files])
  const pathFindings = []
  for (const target of audited) {
    const member = relative.find((entry) => entry.relative === target)
    if (member === undefined) continue
    const text = memberText(archive, member)
    if (text === null) {
      pathFindings.push(`${target} (the recorded payload range lies outside the archive)`)
      continue
    }
    const lines = text.split(/\r?\n/)
    for (const [number, line] of lines.entries()) {
      for (const { label, pattern } of MACHINE_PATH_SHAPES) {
        const match = pattern.exec(line)
        if (match === null) continue
        pathFindings.push(`${target}:${number + 1} carries ${label} ${JSON.stringify(match[0])}`)
      }
    }
  }
  verdict(
    'packaged text paths',
    pathFindings.length === 0,
    pathFindings.length === 0
      ? `${audited.length} packaged document(s) carry no drive-rooted or home-directory path`
      : pathFindings.join('; '),
  )
  for (const finding of pathFindings) fail('packaged text paths', `packaged document ${finding}`)

  if (!safeToExtract) {
    for (const check of EXTRACTION_CHECKS) unreachable(check, 'extraction was not attempted because archive preflight failed')
    console.log(`verify-package: extractor invocations = ${extractorInvocations}`)
    return
  }

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
        unreachable(check, 'package/package.json is not readable JSON, so this check could not run')
      }
    } else {
      verdict('shipped manifest', true, 'package/package.json parses as JSON')
      const identity = manifest.name === PACKAGE_NAME
      verdict(
        'package identity',
        identity,
        identity ? `${manifest.name}@${manifest.version}` : `name = ${JSON.stringify(manifest.name)}, expected ${PACKAGE_NAME}`,
      )
      if (!identity) fail('package identity', `the shipped package is named ${JSON.stringify(manifest.name)}`)

      const targets = declaredTargets(manifest)
      const absent = targets.filter(({ value }) => !targetIsShipped(files, value))
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
      unreachable('shipped README links', 'package/README.md is absent, so its links cannot be checked')
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

    const advisory = [...files].filter((entry) => entry.endsWith('.d.ts'))
    console.log(`verify-package: ${files.size} file(s), ${advisory.length} of them TypeScript declarations`)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
  console.log(`verify-package: extractor invocations = ${extractorInvocations}`)
}

/**
 * Extract a tarball with the platform's own `tar`.
 *
 * This function runs only after the preflight gate above has accepted the archive.
 * It is deliberately not a security boundary: the safety decision was made in
 * `pathSafetyProblems` from the tar index, before this call, so no part of this
 * script relies on `tar`'s own traversal handling for its verdict.
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
  extractorInvocations += 1
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
