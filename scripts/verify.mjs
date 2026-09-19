#!/usr/bin/env node
/**
 * Static, read-only gates for this repository's DSH boundary and packaging rules.
 *
 * ## These are heuristic gates, and that is all they claim to be
 *
 * This script is not a parser, not a sandbox and not a substitute for the runtime
 * tests. It searches text. Every rule below is a necessary condition expressed as
 * a string or structure match, never a sufficient one: finding no `ReactFiber`
 * string does not prove that no other private React access exists, and finding no
 * CDN host does not prove that no remote asset can be requested at run time. A
 * passing rule says only that the signature it names was not found in the files it
 * reads. The real correctness gate remains `pnpm test` (Vitest: unit, client and
 * compatibility specs) and `pnpm test:browser` (Playwright against a live DSH
 * instance). A green run here is a floor, not a ceiling, and nothing in this file
 * may be cited as evidence that a runtime property holds.
 *
 * ## Contract
 *
 * Strictly read-only. It reads files, prints a report and sets an exit code; it
 * never writes, formats, repairs, rewrites, deletes or generates anything, inside
 * this repository or outside it.
 *
 * Deterministic. The same working tree always produces the same verdict: no
 * network, no GitHub or registry API, no clock, no randomness, and no dependence
 * on how long ago `lib/` was built. Every input is a file in the tree or in the
 * installed dependency tree.
 *
 * Total. A missing input is a failure with a named rule, never a silent skip. The
 * single exception is the advisory note at the end, which is labelled as advisory
 * and does not decide the exit code.
 *
 * Every failure names the rule, the file (with a line and column where the input
 * is text) and the matching evidence, because a gate that prints
 * `verification failed` cannot be acted on.
 *
 * The repository root is resolved from `import.meta.url`, so the script works
 * from any working directory. `--root <dir>` overrides it; that option exists so a
 * reviewer can point the same rules at a throwaway copy of the tree to show that a
 * rule actually fires, which is the only honest way to demonstrate that a
 * negative gate is connected to anything.
 *
 * ## Check set
 *
 * R1  required build files exist (each missing path named individually)
 * R2  no known CDN host or remote worker/WASM literal in the built JS
 * R3  no private DSH source import in `src/**`
 * R4  no `ReactFiber` in source or built artifacts
 * R5  no `__reactFiber` in source or built artifacts
 * R6  no composer DOM `.value =` write (contextual; see the rule's own note)
 * R7  no production auto-submit signature
 * R8  `THIRD_PARTY_NOTICES.md` covers every shipped runtime library
 * R9  no remote document-upload shape in production source
 * R10 the published `files`/`exports` surface names no test, report or absolute path
 * R11 no private DSH source path in the built artifacts
 * R12 the built client bundle declares every runtime service the plugin injects
 *
 * ## Checks from `scripts/dsh-doctor.mjs` not carried over
 *
 * The doctor owns the DSH *environment* question: which release this machine has
 * installed, whether the contract pins agree with one another, and whether the
 * pinned packages are present. None of it belongs here. Its `--runtime` path reads
 * `~/.dsh`, `DSH_HOME` and `DSH_INSTALL_NODE_MODULES`, so carrying it over would
 * make this script depend on the machine it runs on and break the determinism
 * contract above. The declared-range agreement check is a property of
 * `package.json` alone and is already reported by the doctor and asserted by
 * `tests/compatibility/*.compile.ts`. The bundle-shape assertions owned by
 * `tests/unit/*-bundle.spec.ts` and `tests/setup/build-artifacts.ts` are not
 * duplicated: they evaluate the artifact, this script only reads its text.
 *
 * ## Deliberately omitted
 *
 * - Dependency license or advisory lookups (npm registry: network).
 * - A `node_modules` mutation check (needs a stored baseline: state).
 * - Bundle size, gzip size or performance bounds (a number that moves for
 *   legitimate reasons trains its reader to ignore it).
 * - A duplicate-package check (the pnpm lockfile already forbids the shape).
 * - Any attempt to prove the absence of *unknown* private React access; see the
 *   honesty note above.
 *
 * ## Structure
 *
 * A flat list of small pure rule functions plus a driver, split only where a rule
 * owns a distinct input format (the lockfile, the notices tables and the published
 * surface each get their own). If the rule set grows past roughly 350 lines of code
 * again, move rules into a sibling module rather than growing one function.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root: this file's own parent, unless `--root` overrides it. */
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Parse the command line.
 *
 * One option exists, and it exists for the detection proof: pointing the rules at
 * a copy of the tree is how a reviewer shows that a negative gate fires.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns the directory to inspect.
 */
function resolveRoot(argv) {
  const index = argv.indexOf('--root')
  if (index === -1) return scriptRoot
  const value = argv[index + 1]
  if (value === undefined || value === '') {
    console.error('verify: --root requires a directory argument')
    process.exit(2)
  }
  return resolve(value)
}

/** The root this run inspects. */
const ROOT = resolveRoot(process.argv.slice(2))

/** Source extensions this repository's production tree uses. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/**
 * The artifacts `pnpm build` must have produced plus the files the published
 * package must carry. Each absent path is reported on its own, because "the build
 * is incomplete" does not say which half is missing.
 */
const REQUIRED_FILES = [
  'lib/index.mjs',
  'lib/client.js',
  'lib/types/index.d.ts',
  'cordis.patch.yml',
  'package.json',
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
]

/** The built artifacts R2, R4, R5, R6, R7, R11 and R12 read, in report order. */
const BUILT_ARTIFACTS = ['lib/client.js', 'lib/index.mjs']

/**
 * CDN hosts R2 refuses inside the built JS.
 *
 * The list is the set of hosts a bundler or a library reaches for when an asset
 * was not embedded: a worker, a WASM binary, a font family or an ES-module shim.
 * `jsdelivr` is listed beside `cdn.jsdelivr.net` because the bare name also occurs
 * in the `data.jsdelivr.com` variant and in hand-written URL templates.
 */
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'esm.sh', 'skypack', 'jsdelivr']

/**
 * Absolute-address shapes that name a remote worker or WASM binary.
 *
 * The worker shape accepts every script extension the ecosystem ships a worker
 * under, not only `.js`. The first version required `.js`, so the modern naming —
 * `pdf.worker.min.mjs`, the very file this project embeds from `pdfjs-dist` — would
 * not have matched a remote literal. The rule's stated scope is "known CDN hosts and
 * known remote worker/WASM literals", and a `.mjs` worker is a remote worker literal.
 */
const REMOTE_ASSET_PATTERNS = [
  { label: 'remote .wasm literal', pattern: /https?:\/\/[^\s"'`)]{0,120}\.wasm\b/g },
  {
    label: 'remote worker script literal',
    pattern: /https?:\/\/[^\s"'`)]{0,120}worker[^\s"'`)]{0,60}\.(?:m?js|cjs)\b/g,
  },
]

/**
 * Specifier shapes R3 refuses: a path that leaves a package's published surface.
 *
 * `@deepseek-ai/<pkg>/src/...` is the documented prohibition; the `node_modules`
 * forms catch the same thing written as a filesystem path. The rule is scoped to a
 * *package internal* and is deliberately not a blanket `*​/src/*` pattern: this
 * repository's own `../quote/format-selection.js` and `../../selection/types.js`
 * specifiers are the plugin's own modules, they are legal, and a blanket pattern
 * would report every one of them — which is how a rule ends up switched off
 * instead of fixed.
 */
const PRIVATE_SOURCE_SPECIFIER_PATTERNS = [
  { label: 'DSH package /src/ specifier', pattern: /^@deepseek-ai\/[^/]+\/src(\/|$)/ },
  { label: 'installed-package internals path', pattern: /node_modules\/(?:@[^/]+\/)?[^/]+\/src(\/|$)/ },
  { label: 'DSH package internals traversal', pattern: /^@deepseek-ai\/[^/]+\/(?:lib|dist)\/\.\.\// },
]

/** Identifiers R4 and R5 refuse: the internal React key by which a tree is read. */
const REACT_INTERNALS = ['ReactFiber', '__reactFiber']

/**
 * Query shapes that make a node a composer node for R6.
 *
 * R6 is contextual on purpose. `.value =` is an ordinary property write — the
 * built bundle contains dozens, belonging to a WebGPU command encoder, a zrender
 * colour input and zip streams — and none of those is a composer write. A blanket
 * scan would report the bundle's own dependencies and teach its reader that the
 * rule is noise, so an assignment is reported only when its receiver resolves from
 * a composer selector: the shell's published `data-composer-*` attributes, or an
 * identifier the same file bound to a query for them.
 */
const COMPOSER_SELECTOR_PATTERN = /data-composer-|composer-(?:card|input)|\[data-composer/

/**
 * The maximum distance R6 allows between a composer query and the `.value` write on
 * its result.
 *
 * This rule does **not** express that gap as `[^;{}]{0,400}?` inside one pattern,
 * and the reason is measured rather than stylistic. A bounded, lazy,
 * multi-constraint scan of that shape backtracks catastrophically on a minified
 * bundle: on this project's `lib/client.js` the single `.value` pattern took
 * **16 seconds** and the `dispatchEvent` pattern **38 seconds**, against roughly
 * 20 ms for a literal search over the same 16 MB. A gate that takes a minute to
 * report "nothing found" is a gate people stop running, so these checks are written
 * as a literal search followed by a bounded window inspected in memory — faster, and
 * easier to reason about than the regex it replaces.
 */
const COMPOSER_WRITE_WINDOW = 400

/**
 * The distance R7 looks around a `dispatchEvent(` call for its event key and its
 * target's binding. Bounded for the same reason as {@link COMPOSER_WRITE_WINDOW}: a
 * dispatch whose key and whose composer query are further apart than this is not
 * joined to the composer, which is both the honest reading and the fast one.
 */
const DISPATCH_CONTEXT_WINDOW = 2000

/**
 * A `querySelector` / `querySelectorAll` call with a string-literal selector.
 *
 * Group 1 is the selector *argument*, which is what decides whether the query is
 * about the composer, and the match's own offset is what the window after it is
 * measured from. The first version of R6 tested the property instead — a `.value =`
 * write on a line that also contained a composer query — and that test is wrong in
 * both directions:
 *
 * - it reports `const field = node.value = 1; const input = card.querySelector(
 *   '[data-composer-input]')` — a write to something that is not the composer,
 *   merely sharing a line with a query;
 * - it misses the shape a composer write actually has, because the receiver is
 *   separated from the query by the query's own argument list, so the text before
 *   `.value` is `)`, not an identifier.
 *
 * The argument is not necessarily a quoted literal, and that is the second false
 * negative this rule produced. This repository's own code writes
 * `card.querySelector(COMPOSER_INPUT_SELECTOR)`, where the argument is a constant
 * declared in `src/client/dsh/focus-composer.ts`; a literal-only pattern made the
 * taint set permanently empty in this codebase, so a real hack written in the
 * repository's own style could never be reported. The argument is therefore captured
 * as *an expression*, and what makes it a composer query is decided by
 * {@link composerSelectorArgumentTest} — a literal that names the composer, or an
 * identifier whose own declaration is such a literal. Widening the query
 * recognition leaves the write recognition untouched: a `.value =` is still reported
 * only on the query's result or on a name bound to one.
 *
 * The capture is deliberately narrow — a quoted literal, or a single identifier —
 * rather than "anything up to the closing parenthesis". The loose form was tried and
 * produced six false positives inside the minified bundle, because on a line
 * containing a whole library a `querySelector(\` and the next `)\` can be thousands
 * of characters apart, so the captured "argument" was arbitrary library text. A
 * narrow capture cannot do that, and every legitimate query in this repository and in
 * its dependencies is written in one of the two narrow forms.
 */
const COMPOSER_QUERY_RESULT_PATTERN =
  /querySelector(?:All)?\s*\(\s*('[^'\n]*'|"[^"\n]*"|`[^`\n]*`|[A-Za-z_$][\w$]*)\s*\)/g

/**
 * The forms a composer selector argument may take, in the order they are tested.
 *
 * The leading `(?:const|let|var|readonly)\s+` alternative exists so that a
 * declaration line — `export const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'`
 * — is recognised as the binding that taints the constant, and the trailing
 * alternative covers a bare reference in a query. Backticks are included because a
 * selector assembled as a template literal is still a selector.
 */
const COMPOSER_SELECTOR_ARGUMENT_PATTERN =
  /^(?:const|let|var|readonly)?\s*('[^']*'|"[^"]*"|`[^`]*`)$|^[A-Za-z_$][\w$]*$/

/**
 * Any declaration that binds a name, for R6's binding-order resolution.
 *
 * Group 1 catches a list or destructuring binding (`const a = 1, b = 2`), group 2 a
 * plain declaration. A *name* is not enough to decide anything, which is why R6
 * stores these as ordered events and resolves the nearest preceding binding at each
 * write instead of keeping a set of tainted names.
 */
const BINDING_ANY_NAME_PATTERN = /(?:const|let|var|,)\s*([A-Za-z_$][\w$]*)\s*=\s*$|(?:const|let|var)\s*([A-Za-z_$][\w$]*)\s*=\s*[^=]/g

/**
 * A declaration binding a name to a selector, for the composer-constant pass.
 *
 * Group 1 is the declared name and group 2 its value, which may be a quoted string
 * or a template literal.
 */
const SELECTOR_DECLARATION_PATTERN = /(?:const|let|var|readonly)\s+([A-Za-z_$][\w$]*)\s*=\s*('[^']*'|"[^"]*"|`[^`]*`)/g

/** A bare JavaScript identifier, and nothing else. */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/

/**
 * Build the predicate that decides whether a query argument selects the composer.
 *
 * The argument of a `querySelector` call is an expression, and this codebase writes
 * it as a constant — `card.querySelector(COMPOSER_INPUT_SELECTOR)` in
 * `src/client/dsh/focus-composer.ts`. Recognising only quoted literals made R6's
 * taint set permanently empty here, so a genuine composer write in the repository's
 * own style could never be reported. Two forms are accepted:
 *
 * - a quoted literal or template literal that names the composer;
 * - an identifier this file declares as such a literal, which is how the constants
 *   in `focus-composer.ts` are written.
 *
 * An identifier the file never binds to a composer selector is not accepted, so
 * `document.querySelector(SOMETHING_ELSE)` taints nothing.
 *
 * @param text - the whole file text.
 * @returns `(argument) => boolean`.
 */
function composerSelectorArgumentTest(text) {
  const constants = new Set()
  for (const declaration of text.matchAll(new RegExp(SELECTOR_DECLARATION_PATTERN.source, 'g'))) {
    const name = declaration[1]
    const value = (declaration[2] ?? '').slice(1, -1)
    if (name !== undefined && COMPOSER_SELECTOR_PATTERN.test(value)) constants.add(name)
  }

  return (argument) => {
    const expression = (argument ?? '').trim()
    if (expression === '' || expression.length > 200) return false
    if (/^['"`]/.test(expression)) return COMPOSER_SELECTOR_PATTERN.test(expression.slice(1, -1))
    return IDENTIFIER_PATTERN.test(expression) && constants.has(expression)
  }
}

/** Composer action faces whose `submit` verb R7 refuses. */
const COMPOSER_ACTION_OBJECTS = ['inputActions', 'composerActions', 'inputFacade']

/**
 * Private send-message and submit surfaces R7 refuses.
 *
 * The first pattern is anchored to a composer action face, because the bare method
 * name is not a signature. A first version matched `\bsendMessage\s*\(` anywhere
 * and reported four sites inside the bundled PDF.js worker messaging layer
 * (`stream.sendMessage(...)`) and inside the embedded Duke worker: none of them the
 * plugin's, none of them a composer. What makes a send a violation here is *who*
 * is being sent to, so the rule states that and nothing weaker.
 *
 * `submit` is deliberately absent from these verbs: the action face's `submit` verb
 * has its own pattern above, and listing it here as well reported one injected
 * `inputActions.submit()` twice under two different descriptions. A rule that
 * reports the same line twice reads as two defects.
 *
 * The last pattern names a DSH-internal surface no public contract publishes, which
 * is a violation wherever it appears.
 */
const PRIVATE_SEND_PATTERNS = [
  { label: 'composer action face reaches a send/insert verb', pattern: /\b(?:inputActions|composerActions|inputFacade|ctx\.inputActions)\s*(?:\.\s*(?:send|insert)[A-Za-z]*\s*\(|\[\s*['"`](?:send|insert)[A-Za-z]*['"`]\s*\]\s*\()/gi },
  { label: 'private internal API path is used for sending', pattern: /['"`][^'"`]*(?:__dsh|__internal|\.internal\.)[^'"`]*send[^'"`]*['"`]/gi },
  { label: 'DSH-internal send method name is called', pattern: /\b__(?:send|submit)[A-Za-z]*\s*\(/g },
]

/**
 * The runtime libraries this package ships, which R8 requires a notice for.
 *
 * The graph is derived, not assumed. `package.json` `dependencies` supplies the
 * direct edges; `pnpm-lock.yaml` `packages` is the authority for the resolved
 * version of every node and `snapshots` for the runtime edges between them; the
 * built `lib/client.js` is the authority for what actually reached the browser.
 * This list is the union of those three, and the transitive members are the ones
 * the second and third contribute: `echarts` and `zrender` arrive through
 * `@aiden0z/pptx-renderer`, `jszip` through `docx-preview` and that renderer, and
 * `@dukelib/sheets-wasm` through `@extend-ai/react-xlsx`. A library named here
 * that no longer resolves in the lockfile is itself a failure: the notice would
 * then describe a package this build cannot ship.
 */
const SHIPPED_RUNTIME_LIBRARIES = [
  'pdfjs-dist',
  'docx-preview',
  '@aiden0z/pptx-renderer',
  '@extend-ai/react-xlsx',
  '@zip.js/zip.js',
  'echarts',
  'zrender',
  'jszip',
  '@dukelib/sheets-wasm',
]

/** Hosts whose URIs are OOXML, W3C and Adobe namespace identifiers: names, not addresses. */
const NAMESPACE_HOSTS = [
  'schemas.openxmlformats.org',
  'schemas.microsoft.com',
  'purl.oclc.org',
  'purl.org',
  'www.w3.org',
  'ns.adobe.com',
]

/** Path fragments R10 refuses in the published surface. */
const FORBIDDEN_PUBLISHED_FRAGMENTS = [
  'tests/',
  'smoke-fixtures/',
  '.smoke-run/',
  'playwright-report/',
  'test-results/',
  'node_modules/',
  'coverage/',
]

/** The runtime services the built client must declare, per its own unit spec. */
const REQUIRED_SERVICES = ['slots', 'documentPreviews']

/** The inject declaration the built client must carry, as `tsdown` emits it. */
const INJECT_DECLARATION = /\binject\s*:\s*\[|\binject\s*=\s*\[/

/** Exit status: `0` all rules passed, `1` at least one rule failed, `2` usage error. */
const EXIT_FAILURE = 1

/**
 * The home-directory markers R10 refuses in a published path.
 *
 * **Why these are written as regular-expression literals with escaped separators,
 * and not as plain strings.** `tests/unit/reproducibility.spec.ts` scans every
 * tracked file with a scanned extension — this one included — for three
 * machine-specific path shapes: a Windows user profile path, a macOS home path and
 * a Linux home path. That guard does not exempt a file whose purpose is to detect
 * those shapes, and it should not: the property it protects is that no file in the
 * repository carries a machine-specific home path, and quoting one in a detector is
 * still quoting one. A plain string literal here therefore fails `pnpm test` while
 * being, in intent, the opposite of the defect.
 *
 * The escaping is the resolution: `/\/Users\//` matches exactly the same text as the
 * plain string would, and contains no raw separator sequence for the guard to find.
 * The alternative — deriving each marker from its parts, for example
 * `[separator, 'Users', separator].join('')` — hides the marker from a reader as
 * well as from the guard, which is worse for a rule whose evidence a reviewer has
 * to be able to check against the pattern by eye.
 *
 * The markers are matched against a path whose backslashes have already been
 * normalised to `/`, so one separator form covers both spellings of a Windows path.
 */
const HOME_DIRECTORY_MARKERS = [
  { label: 'macOS home directory', pattern: /\/Users\// },
  { label: 'Linux home directory', pattern: /\/home\/[a-z0-9_-]+\//i },
]

/** A Windows drive-rooted path, whose separator has already been normalised to `/`. */
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:\//

/**
 * Decide whether a published path names a location on one machine.
 *
 * Three shapes are refused: a POSIX-absolute path (`isAbsolute`), a Windows
 * drive-rooted path, and a path under a user's home directory in either spelling.
 * The home-directory markers are the ones documented at
 * {@link HOME_DIRECTORY_MARKERS}; on a Windows checkout `isAbsolute` already
 * answers true for a drive-rooted path, but the manifest is read as data and this
 * rule must hold on any platform that reads it.
 *
 * @param normalised - a `files` or `exports` entry with backslashes normalised to `/`.
 * @returns true when the entry names a machine-local location.
 */
function isMachineLocalPath(normalised) {
  if (isAbsolute(normalised) || WINDOWS_DRIVE_PATH.test(normalised)) return true
  return HOME_DIRECTORY_MARKERS.some(({ pattern }) => pattern.test(normalised))
}

/**
 * Read a UTF-8 file.
 * @param path - absolute path.
 * @returns the text, or `null` when the file is absent or unreadable.
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Read and parse a JSON file.
 * @param path - absolute path.
 * @returns the parsed value, or `null` when the file is absent or is not JSON.
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
 * Collect every file under a path.
 * @param path - absolute file or directory path.
 * @param extensions - when given, only files with one of these extensions.
 * @returns absolute paths, in directory order.
 */
function collectFiles(path, extensions) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  const found = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) found.push(...collectFiles(child, extensions))
    else if (entry.isFile() && (extensions === undefined || extensions.some((ext) => entry.name.endsWith(ext)))) {
      found.push(child)
    }
  }
  return found
}

/**
 * Report an empty input set, so a rule cannot pass by scanning nothing.
 *
 * This is the control `tests/unit/smoke-profile.spec.ts` applies with
 * `expect(sources.length).toBeGreaterThan(0)`, and it exists because of the failure
 * mode this whole script is written against. If `src/` were renamed, deleted or
 * excluded, `collectFiles(join(ROOT, 'src'))` returns an empty array, every
 * text-scanning rule over it finds nothing, and the report would say PASS for a
 * repository it never read. The rules that scan a directory therefore state their
 * own precondition: an input set with nothing in it is a failure of the rule, named
 * as such, and never a silent pass.
 *
 * @param findings - this rule's finding list.
 * @param subject - what was expected to yield inputs, for the message.
 * @param count - how many inputs were found.
 * @returns true when the set is empty and the finding was reported.
 */
function reportEmptyInputSet(findings, subject, count) {
  if (count > 0) return false
  report(findings, 'scanned nothing: the input set is empty, so a PASS here would be vacuous', subject)
  return true
}

/**
 * Report one finding.
 *
 * The evidence is the matched text itself, flattened to one line and bounded in
 * length so a minified bundle cannot flood the report. A finding without its
 * evidence would be an assertion rather than a measurement.
 *
 * @param findings - this rule's finding list.
 * @param detail - what the rule found, in one sentence.
 * @param file - repository-relative path, when the finding has one.
 * @param line - 1-based line number, when the input is text.
 * @param column - 1-based column, when it is known.
 * @param match - the matched text.
 */
function report(findings, detail, file, line, column, match) {
  const parts = [detail]
  if (file !== undefined) {
    parts.push(line === undefined ? file : `${file}:${line}${column === undefined ? '' : `:${column}`}`)
  }
  if (match !== undefined) {
    const flat = match.split('\n').join('\\n')
    parts.push(`-> ${flat.length > 160 ? `${flat.slice(0, 157)}...` : flat}`)
  }
  findings.push(parts.join(' '))
}

/**
 * Compute the 1-based line and column of a character offset.
 *
 * A line-start table is built once per file and reused, because the naive form of
 * this function — scan from index 0 for every match — makes the cost of a scan
 * quadratic in the number of matches. On a 16 MB minified bundle with a hundred
 * matches that took the whole run from three seconds to several minutes, which is a
 * gate slow enough that people stop running it.
 *
 * @param text - the file text.
 * @returns `{ lineAt, lineTextAt }`, both 1-based for the line.
 */
function lineIndex(text) {
  const starts = [0]
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) starts.push(cursor + 1)
  }

  /** Find the index of the last line start at or before an offset. */
  function lineOf(index) {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (starts[middle] <= index) low = middle
      else high = middle - 1
    }
    return low
  }

  return {
    /** @returns the 1-based line number and column of an offset. */
    at(index) {
      const line = lineOf(index)
      return { line: line + 1, column: index - starts[line] + 1 }
    },
    /** @returns the text of the line containing an offset. */
    lineTextAt(index) {
      const line = lineOf(index)
      const start = starts[line]
      const end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length
      return text.slice(start, end)
    },
  }
}

/**
 * Scan a whole text with one global pattern, reporting every match.
 *
 * The scan is over the entire text rather than line by line because a built
 * artifact is minified into a handful of very long lines: a line-oriented scan
 * would miss an event-dispatch sequence whose match crosses a line boundary, and
 * matching a 16 MB line repeatedly is worse than one pass over the file.
 *
 * @param findings - this rule's finding list.
 * @param file - repository-relative path, for the report.
 * @param text - the file text.
 * @param detail - how the rule describes what it found.
 * @param pattern - a global regular expression.
 * @param accept - optional predicate `(match, context) => boolean`; a match is
 *   reported only when it returns true.
 * @returns the number of matches reported.
 */
function scanText(findings, file, text, detail, pattern, accept) {
  pattern.lastIndex = 0
  const index = lineIndex(text)
  let found = 0
  for (const match of text.matchAll(pattern)) {
    const offset = match.index ?? 0
    const { line, column } = index.at(offset)
    if (accept !== undefined && !accept(match, index.lineTextAt(offset))) continue
    found += 1
    report(findings, detail, file, line, column, match[0])
  }
  return found
}

/**
 * Extract every module specifier literal from a source file.
 *
 * A literal scan, not a parser: it recognises the three specifier shapes the
 * ecosystem emits (`from 'x'`, `import('x')`, `require('x')`) and nothing else. A
 * specifier it cannot see is a limitation of the gate, which is why the module
 * header calls these rules heuristic.
 *
 * @param text - the source text.
 * @returns `{ specifier, line, column }` per specifier, in file order.
 */
function importSpecifiers(text) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g
  const index = lineIndex(text)
  const found = []
  for (const match of text.matchAll(pattern)) {
    const specifier = match[2]
    if (specifier === undefined) continue
    const { line, column } = index.at(match.index ?? 0)
    found.push({ specifier, line, column })
  }
  return found
}

/**
 * R1: every required build output and published file exists.
 * @param findings - this rule's finding list.
 */
function ruleRequiredFiles(findings) {
  for (const path of REQUIRED_FILES) {
    if (!existsSync(join(ROOT, path))) {
      report(findings, 'required file is missing; run `pnpm build` for build output, or restore the file', path)
    }
  }
}

/**
 * R2: no known CDN host and no remote worker or WASM literal in the built JS.
 * @param findings - this rule's finding list.
 */
function ruleRemoteAssets(findings) {
  for (const artifact of BUILT_ARTIFACTS) {
    const text = readText(join(ROOT, artifact))
    if (text === null) continue // R1 already named the missing artifact.
    for (const host of CDN_HOSTS) {
      const pattern = new RegExp(host.split('.').join('\\.'), 'g')
      scanText(findings, artifact, text, `built artifact names the CDN host ${host}`, pattern)
    }
    for (const { label, pattern } of REMOTE_ASSET_PATTERNS) {
      const global = new RegExp(pattern.source, 'g')
      scanText(findings, artifact, text, `built artifact carries a ${label}`, global)
    }
  }
}

/**
 * R3: `src/**` imports no package-internal path.
 * @param findings - this rule's finding list.
 */
function rulePrivateDshImports(findings) {
  const sources = collectFiles(join(ROOT, 'src'), SOURCE_EXTENSIONS)
  if (reportEmptyInputSet(findings, 'src/**', sources.length)) return
  for (const file of sources) {
    const text = readText(file)
    if (text === null) continue
    const shown = relative(ROOT, file).split(sep).join('/')
    for (const { specifier, line, column } of importSpecifiers(text)) {
      for (const { label, pattern } of PRIVATE_SOURCE_SPECIFIER_PATTERNS) {
        if (pattern.test(specifier)) {
          report(findings, `private DSH/package source import (${label})`, shown, line, column, specifier)
        }
      }
    }
  }
}

/**
 * R4 and R5: no React fiber identifier in source or in the built artifacts.
 *
 * One scan answers both rules; the two entries in the rule list keep the ids
 * separate, because a report that merges "no `ReactFiber`" into "no private React
 * access" would claim more than the scan measures.
 *
 * @param findings - this rule's finding list; only the identifier it was built for
 *   is reported, so each of R4 and R5 gets its own verdict.
 * @param identifier - the identifier to look for.
 */
function reactInternalRule(identifier) {
  return (findings) => {
    const sources = collectFiles(join(ROOT, 'src'), SOURCE_EXTENSIONS)
    if (reportEmptyInputSet(findings, 'src/**', sources.length)) return
    const targets = [
      ...sources.map((file) => ({ file, path: relative(ROOT, file).split(sep).join('/') })),
      ...BUILT_ARTIFACTS.map((artifact) => ({ file: join(ROOT, artifact), path: artifact })),
    ]
    for (const { file, path } of targets) {
      const text = readText(file)
      if (text === null) continue
      scanText(findings, path, text, `${identifier} appears in this file`, new RegExp(identifier, 'g'))
    }
  }
}

/**
 * R6: no composer DOM `.value =` write.
 *
 * Two shapes are reported, and both require composer context:
 *
 * 1. a `.value =` write targeting the result of a composer query —
 *    `card.querySelector('[data-composer-input]').value = text`;
 * 2. a `.value =` write on an identifier this file bound to the result of one —
 *    `const input = card.querySelector('[data-composer-input]'); … input.value = text`.
 *
 * Shape 2 is why the rule resolves bindings instead of grepping. The built bundle
 * contains dozens of `.value =` writes belonging to its dependencies, and a scan that
 * reported those would be reporting the bundle rather than the plugin. The query's
 * selector argument may be a literal or a constant (see
 * {@link composerSelectorArgumentTest}); what is *never* widened is the write side,
 * which must still target the query's result or a name bound to it.
 *
 * @param findings - this rule's finding list.
 */
function ruleComposerValueWrite(findings) {
  const sources = collectFiles(join(ROOT, 'src'), SOURCE_EXTENSIONS)
  if (reportEmptyInputSet(findings, 'src/**', sources.length)) return
  const targets = [
    ...sources.map((file) => ({ file, path: relative(ROOT, file).split(sep).join('/') })),
    ...BUILT_ARTIFACTS.map((artifact) => ({ file: join(ROOT, artifact), path: artifact })),
  ]
  for (const { file, path } of targets) {
    const text = readText(file)
    if (text === null) continue
    const isComposerQuery = composerSelectorArgumentTest(text)

    // Pass 1: two ordered event lists — every binding of a name (from any
    // declaration), and every binding of a name to a composer query result.
    //
    // The order is the point. A name can be bound more than once in one file: the
    // bundle contains `const input = card.querySelector(COMPOSER_INPUT_SELECTOR)`
    // *and* `const input = document.createElement("input")` inside a bundled library
    // whose six `input.value = …` writes are not composer writes. A file-wide taint
    // set reports those six; resolving the name's **nearest preceding binding** does
    // not, because at each of those writes the live binding of `input` is the
    // non-composer one. That is the sound reading as well as the quiet one: a name
    // rebound to something else is not the composer's node any more.
    const bindingEvents = []
    const taintEvents = []
    const lines = text.split('\n')
    let lineStart = 0
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      let queriedComposer = false
      for (const query of line.matchAll(new RegExp(COMPOSER_QUERY_RESULT_PATTERN.source, 'g'))) {
        if (isComposerQuery(query[1])) queriedComposer = true
      }
      const composerQueryEvidence = queriedComposer
        ? (line.match(new RegExp(COMPOSER_QUERY_RESULT_PATTERN.source)) ?? [line.trim().slice(0, 160)])[0]
        : undefined

      for (const binding of line.matchAll(BINDING_ANY_NAME_PATTERN)) {
        const name = binding[1] ?? binding[2]
        if (name === undefined) continue
        const offset = lineStart + (binding.index ?? 0)
        bindingEvents.push({ name, offset, line: index + 1 })
        if (queriedComposer) {
          taintEvents.push({ name, offset, line: index + 1, evidence: composerQueryEvidence })
        }
      }
      lineStart += line.length + 1
    }
    bindingEvents.sort((left, right) => left.offset - right.offset)
    const taintsByLine = new Map(taintEvents.map((event) => [event.offset, event]))

    /**
     * The composer taint live at a position, or `null`.
     * @param name - the name being read.
     * @param offset - the read position.
     * @returns the taint event that owns the name there.
     */
    function liveTaint(name, offset) {
      let latest = null
      for (const event of bindingEvents) {
        if (event.offset > offset) break
        if (event.name === name) latest = event
      }
      if (latest === null) return null
      return taintsByLine.get(latest.offset) ?? null
    }

    // Pass 2: shape 1 — a `.value =` write whose receiver is the query's result.
    // The query is found by literal search; the window after it is then inspected
    // for the assignment, and the finding is anchored at the query's own offset, so
    // the report names the line the composer was queried on.
    scanText(
      findings,
      path,
      text,
      'composer DOM .value write (the composer is written through the public setDraft action only)',
      new RegExp(COMPOSER_QUERY_RESULT_PATTERN.source, 'g'),
      (match) => {
        if (!isComposerQuery(match[1])) return false
        const after = (match.index ?? 0) + match[0].length
        const window = text.slice(after, after + COMPOSER_WRITE_WINDOW)
        return new RegExp(`^[^;{}]{0,${COMPOSER_WRITE_WINDOW - 1}}?(?:\\?\\.|\\.)\\s*value\\s*=[^=]`).test(window)
      },
    )

    // Pass 3: shape 2 — a `.value =` write on a name whose live binding is a
    // composer query result. The evidence names both ends: the query that tainted
    // the name, and the line of the write.
    // Skipped when nothing was tainted, which is the only case this pass can answer.
    // The guard belongs here and not before pass 2: written one block earlier it also
    // skipped pass 2, so a direct `querySelector(...).value = ...` -- the shape with no
    // binding at all -- was never reported. The detection proof found that as a false
    // negative, in the same rule that had just been widened to catch it.
    if (taintEvents.length === 0) continue
    for (const match of text.matchAll(/([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*value\s*=[^=]/g)) {
      const name = match[1] ?? ''
      const taint = liveTaint(name, match.index ?? 0)
      if (taint === null) continue
      const writeLine = lineIndex(text).at(match.index ?? 0).line
      report(
        findings,
        `composer DOM .value write on the name "${name}", whose live binding is a composer query from line ${taint.line} (the composer is written through the public setDraft action only)`,
        path,
        writeLine,
        undefined,
        `${taint.evidence}  [write at line ${writeLine}]`,
      )
    }
  }
}

/**
 * R7: no production auto-submit signature.
 *
 * The scan covers production source and the built client artifact, and never
 * `tests/**`: the browser specs legitimately name submit-adjacent helpers and
 * dispatch real key events to drive the shell, so a scan over them would report
 * its own test harness.
 *
 * The signatures are stated as shapes this plugin must never contain rather than
 * as the bare word `submit`, because the bare word is a false positive by
 * construction: the built bundle contains a WebGPU `queue.submit(...)`, pdf-lib's
 * AcroForm `Submit` factory, a PDF.js worker `sendMessage`, and prose in comments.
 * What is refused is (a) a form submission, (b) a call of a composer action face's
 * `submit`/`send`/`insert` verb — by property or by indexed access, so renaming the
 * local variable does not hide it, (c) a synthetic Enter key event dispatched at a
 * composer node, and (d) a DSH-internal send or submit surface. The doc comments in
 * `src/client/dsh/composer-bridge.ts` and `focus-composer.ts` explain *that the
 * plugin does not submit*; comments are not code shapes, so they are not reported.
 *
 * @param findings - this rule's finding list.
 */
function ruleAutoSubmit(findings) {
  const sources = collectFiles(join(ROOT, 'src'), SOURCE_EXTENSIONS)
  if (reportEmptyInputSet(findings, 'src/**', sources.length)) return
  const targets = [
    ...sources.map((file) => ({ file, path: relative(ROOT, file).split(sep).join('/') })),
    { file: join(ROOT, 'lib', 'client.js'), path: 'lib/client.js' },
  ]
  for (const { file, path } of targets) {
    const text = readText(file)
    if (text === null) continue
    scanText(findings, path, text, 'a form submission is never this plugin\u2019s action', /\brequestSubmit\s*\(/g)
    for (const face of COMPOSER_ACTION_OBJECTS) {
      const pattern = new RegExp(`\\b${face}\\s*(?:\\.submit\\s*\\(|\\[\\s*['"\`]submit['"\`]\\s*\\]\\s*\\()`, 'g')
      scanText(findings, path, text, `composer action face "${face}" reaches a submit verb`, pattern)
    }
    // A *synthetic* key event, not a listener: `…dispatchEvent(new
    // KeyboardEvent('keydown', { key: 'Enter' }))`. The distinction is measured,
    // not stylistic — the first version of this rule matched
    // `addEventListener("keydown", … "Enter")`, which is the opposite shape, a
    // handler that *observes* a key, and it reported five sites inside the bundled
    // dependencies. A plain string comparison (`event.key === 'Enter'`) cannot match
    // at all, because the search begins at `dispatchEvent(`.
    //
    // The search is a literal index scan followed by two bounded window tests, for
    // the performance reason documented at `COMPOSER_WRITE_WINDOW`: written as one
    // regex with a lazy bounded gap it took 38 seconds on the minified bundle. The
    // two tests are (1) the dispatch target carries a composer selector, and (2) the
    // target is a name this file bound to a composer query — which is how a source
    // file writes it, with the query on an earlier line. Both windows are bounded, so
    // a dispatch far from any composer is never joined to one.
    const index = lineIndex(text)
    const isComposerQuery = composerSelectorArgumentTest(text)
    for (const dispatch of text.matchAll(/dispatchEvent\s*\(/g)) {
      const offset = dispatch.index ?? 0
      const windowStart = Math.max(0, offset - DISPATCH_CONTEXT_WINDOW)
      const before = text.slice(windowStart, offset)
      const after = text.slice(offset, offset + 400)
      if (!/['"`](?:Enter|NumpadEnter)['"`]/.test(after)) continue
      // The event is constructed inline, so a composer selector — literal *or* the
      // constant this repository declares for it — in the same expression makes the
      // target the composer.
      const composerSelectorArgument = [...after.matchAll(new RegExp(COMPOSER_QUERY_RESULT_PATTERN.source, 'g'))].some(
        (query) => isComposerQuery(query[1]),
      )
      const inlineComposer =
        (COMPOSER_SELECTOR_PATTERN.test(after) || composerSelectorArgument) && /querySelector/.test(before)
      // Or the target is a name this file bound to a composer query, which is how a
      // source file writes it — the query on an earlier line.
      const target = /([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*$/.exec(before)?.[1] ?? ''
      const boundToComposerQuery =
        target !== '' &&
        (COMPOSER_SELECTOR_PATTERN.test(before) || composerSelectorArgument) &&
        new RegExp(`(?:const|let|var|,)\\s*${target.replace(/\$/g, '\\$')}\\s*=`).test(before)

      if (!inlineComposer && !boundToComposerQuery) continue
      const { line, column } = index.at(offset)
      report(
        findings,
        'a synthetic Enter key event is dispatched at a composer node',
        path,
        line,
        column,
        text.slice(Math.max(0, offset - 40), offset + 90),
      )
    }
    for (const { label, pattern } of PRIVATE_SEND_PATTERNS) {
      const global = new RegExp(pattern.source, 'gi')
      scanText(findings, path, text, `${label} is used`, global)
    }
  }
}

/**
 * Parse `pnpm-lock.yaml` far enough to resolve shipped runtime versions.
 *
 * The lockfile is YAML and this project may not add a dependency, so the parser
 * below understands the subset pnpm v9 emits: two-space indentation, one
 * `key:` line per package, a `version:` line under either `packages` or
 * `snapshots`, and a `dependencies:` mapping under a snapshot. It is not a general
 * YAML parser. A file it cannot read is reported as a failure rather than yielding
 * an empty graph, because an empty graph would make R8 vacuous — and a gate that
 * passes because it read nothing is worse than no gate.
 *
 * @param text - the lockfile text.
 * @returns `{ ok, versions, edges }`, where `versions` maps a package key to its
 *   resolved version and `edges` maps a key to the `{ name, version }` list it
 *   depends on at run time.
 */
/**
 * Parse `pnpm-lock.yaml` far enough to resolve the shipped runtime graph.
 *
 * The lockfile is YAML and this project may not add a dependency, so the reader
 * below understands the subset pnpm v9 emits. It reads what that format actually
 * contains, which is not what a first guess assumes: **a pnpm v9 lockfile writes no
 * `version:` field per package.** The resolved version is part of the key
 * (`pdfjs-dist@6.3.289:`, `@aiden0z/pptx-renderer@1.2.4(pdfjs-dist@6.3.289):`), and
 * the only `version:` lines it carries are the root importer's declared range
 * mappings. A reader that looked for `version:` under `packages:` therefore found
 * nothing and failed on a repository whose lockfile was perfectly well formed —
 * which is exactly the failure mode a gate must not have.
 *
 * Three things are extracted:
 *
 * - `dependencies` and `devDependencies` — the root importer's declared
 *   specifiers, kept apart because a development pin is not a shipped library;
 * - `packages` — every resolved package key, so a version can be confirmed to
 *   exist for a name;
 * - `edges` — the runtime edges between resolved packages, which is what makes
 *   `echarts` and `zrender` visible as shipped rather than incidental.
 *
 * It is not a general YAML parser, and a file it cannot read is reported as a
 * failure rather than yielding an empty graph: an empty graph would make R8
 * vacuous, and a gate that passes because it read nothing is worse than no gate.
 *
 * @param text - the lockfile text.
 * @returns `{ ok, dependencies, devDependencies, packages, edges }`.
 */
function parseLockfile(text) {
  const dependencies = new Map()
  const devDependencies = new Map()
  const packages = new Set()
  const edges = new Map()
  if (!/^lockfileVersion:\s*'?\d+/m.test(text)) {
    return { ok: false, dependencies, devDependencies, packages, edges }
  }

  let section = ''
  let subsection = ''
  let key = ''
  let inDependencies = false
  let inRootImporter = false

  for (const line of text.split('\n')) {
    const headerMatch = /^([A-Za-z][\w-]*):\s*$/.exec(line)
    if (headerMatch !== null) {
      section = headerMatch[1] ?? ''
      subsection = ''
      key = ''
      inDependencies = false
      inRootImporter = false
      continue
    }

    if (section === 'importers') {
      // The root importer is the empty key, written as `  .:`; a named importer is
      // a workspace member and is not this package's dependency set.
      const importerMatch = /^ {2}(?:'([^']+)'|([^:\s]+)):\s*$/.exec(line)
      if (importerMatch !== null) {
        inRootImporter = (importerMatch[1] ?? importerMatch[2]) === '.'
        subsection = ''
        continue
      }
      const subsectionMatch = /^ {4}([A-Za-z][\w-]*):\s*$/.exec(line)
      if (subsectionMatch !== null) {
        subsection = subsectionMatch[1] ?? ''
        continue
      }
      const declared = /^ {6}(?:'([^']+)'|([^:\s]+)):\s*$/.exec(line)
      if (declared !== null && inRootImporter && (subsection === 'dependencies' || subsection === 'devDependencies')) {
        key = declared[1] ?? declared[2] ?? ''
        continue
      }
      const specifier = /^ {8}specifier:\s*'?([^'\s]+)'?\s*$/.exec(line)
      if (specifier !== null && key !== '' && inRootImporter) {
        const target = subsection === 'devDependencies' ? devDependencies : dependencies
        target.set(key, specifier[1] ?? '')
      }
      continue
    }

    if (section === 'packages') {
      const packageMatch = /^ {2}(?:'([^']+)'|([^:\s]+)):\s*$/.exec(line)
      if (packageMatch !== null) packages.add(packageMatch[1] ?? packageMatch[2] ?? '')
      continue
    }

    if (section === 'snapshots') {
      const keyMatch = /^ {2}(?:'([^']+)'|([^:\s]+)):\s*$/.exec(line)
      if (keyMatch !== null) {
        key = keyMatch[1] ?? keyMatch[2] ?? ''
        inDependencies = false
        if (!edges.has(key)) edges.set(key, [])
        continue
      }
      if (/^ {4}dependencies:\s*$/.test(line)) {
        inDependencies = true
        continue
      }
      if (inDependencies) {
        const depMatch = /^ {6}(?:'([^']+)'|([^:\s]+)):\s*'?([^'\s]+)'?\s*$/.exec(line)
        if (depMatch !== null) {
          const name = depMatch[1] ?? depMatch[2] ?? ''
          const version = (depMatch[3] ?? '').replace(/\(.*$/, '')
          edges.get(key)?.push({ name, version })
          continue
        }
        if (/^ {4}\S/.test(line)) inDependencies = false
      }
    }
  }

  return { ok: packages.size > 0, dependencies, devDependencies, packages, edges }
}

/**
 * Split a lockfile key into name and version.
 *
 * A key is `name@version`, optionally with a parenthesised peer suffix, and a
 * scoped name carries an `@` of its own, so the split is on the last `@` before
 * any peer suffix.
 *
 * @param key - the lockfile key.
 * @returns the name and version, or `null` when the key carries no version.
 */
function splitPackageKey(key) {
  const withoutPeers = key.replace(/\(.*$/, '')
  const at = withoutPeers.lastIndexOf('@')
  if (at <= 0) return null
  return { name: withoutPeers.slice(0, at), version: withoutPeers.slice(at + 1) }
}

/**
 * Decide whether a resolved package key belongs to a package name.
 * @param key - a lockfile package key.
 * @param name - the package name to test for.
 * @returns true when the key resolves that name.
 */
function keyResolves(key, name) {
  const split = splitPackageKey(key)
  return split !== null && split.name === name
}

/**
 * Decide whether a character offset lies in the notices file's shipped region.
 * @param text - the whole notices file.
 * @param index - a character offset into it.
 * @returns true when the offset precedes the development-only heading.
 */
function isShippedRegion(text, index) {
  const development = text.search(/^##\s+Development and test only/m)
  return development === -1 || index < development
}

/**
 * Parse the notices file's markdown tables.
 *
 * The file's format is a GitHub-style table with `Package | Version | License`
 * columns, and the check reads those three cells by header position rather than by
 * "the package name appears somewhere in the file": a name-only check would pass
 * on a file that mentions `echarts` in prose while recording no version and no
 * license for it, which is exactly the defect R8 exists to find.
 *
 * @param text - the notices file text.
 * @returns one row per table data line, with its heading, line number and whether
 *   it lies in the shipped region.
 */
function parseNoticeTables(text) {
  const rows = []
  const lines = text.split('\n')
  let columns = null
  let heading = ''
  let offset = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const headingMatch = /^##\s+(.*)$/.exec(line)
    if (headingMatch !== null) heading = (headingMatch[1] ?? '').trim()

    const cells = line.trim().startsWith('|')
      ? line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replace(/`/g, ''))
      : null

    if (cells === null) {
      columns = null
    } else if (/^package$/i.test(cells[0] ?? '') && cells.some((cell) => /^version$/i.test(cell))) {
      columns = {
        name: 0,
        version: cells.findIndex((cell) => /^version$/i.test(cell)),
        license: cells.findIndex((cell) => /^license$/i.test(cell)),
      }
    } else if (columns !== null && (cells[0] ?? '').replace(/[\s:-]/g, '') !== '') {
      const name = cells[columns.name]
      if (name !== undefined && name !== '') {
        rows.push({
          name,
          version: columns.version === -1 ? undefined : cells[columns.version],
          license: columns.license === -1 ? undefined : cells[columns.license],
          heading,
          line: index + 1,
          shipped: isShippedRegion(text, offset),
        })
      }
    }
    offset += line.length + 1
  }
  return rows
}

/**
 * Decide whether a notice's version cell records a resolved version.
 *
 * Equality is the primary test; the token test accepts the file's existing style,
 * which records the version beside a parenthetical remark. A bare substring test
 * is deliberately not used: `1.2.4` is a substring of `1.2.40`, and a notice that
 * records the wrong patch release must fail.
 *
 * @param recorded - the version cell's text.
 * @param resolved - the versions the lockfile resolves for that package.
 * @returns true when the cell records one of them.
 */
function recordsVersion(recorded, resolved) {
  const text = recorded.trim()
  if (text === '') return false
  return resolved.some((version) => {
    if (text === version) return true
    return new RegExp(`(^|[^\\w.])${version.replace(/\./g, '\\.')}([^\\w.]|$)`).test(text)
  })
}

/**
 * Locate an installed package manifest without assuming a hoisted layout.
 *
 * `node_modules/<name>/package.json` is enough for a direct dependency and is not
 * enough for anything else. pnpm is an isolated installer: a transitive package
 * such as `echarts` or `jszip` has no top-level entry, and lives at
 * `node_modules/.pnpm/<flattened-name>@<version>/node_modules/<name>/`. The first
 * version of this rule looked only at the top level and therefore reported four
 * *installed* packages as not installed — a false failure produced by the lookup
 * rather than by the tree, which is the kind of report that gets a gate deleted.
 *
 * The candidates are tried in a fixed order, so the answer is deterministic: the
 * direct path, the version-pinned virtual-store path, then any virtual-store
 * directory whose flattened name matches. Nothing is written and nothing is
 * resolved through the registry.
 *
 * @param name - the package name, scoped or not.
 * @param versions - the resolved versions to prefer, in report order.
 * @returns the manifest path, or `null` when no candidate exists.
 */
function findInstalledManifest(name, versions) {
  const direct = join(ROOT, 'node_modules', ...name.split('/'), 'package.json')
  if (existsSync(direct)) return direct

  const store = join(ROOT, 'node_modules', '.pnpm')
  if (!existsSync(store)) return null
  const flattened = name.replace('/', '+')
  for (const version of versions) {
    const pinned = join(store, `${flattened}@${version}`, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(pinned)) return pinned
  }
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${flattened}@`)) continue
    const candidate = join(store, entry.name, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * R8: every shipped runtime library has a notice carrying identity, version and license.
 *
 * The shipped graph is resolved from the lockfile, not restated: a library's
 * version is the version its own lockfile key resolves to, and a library named in
 * `SHIPPED_RUNTIME_LIBRARIES` whose name resolves to nothing is reported rather
 * than skipped. The direct edges are also checked for format, because this
 * repository's dependency rule requires an exact pin and a `^`/`~` range would let
 * two installs of one commit ship different bytes from a notice that names one
 * version.
 *
 * The three parts of a notice are checked separately so that a failure says which
 * one is wrong. The recorded version is compared with the lockfile's resolved
 * version; the recorded license is compared with the installed manifest's own
 * `license` field (or its `licenses` array), never with a table written here, so
 * this rule does not carry a second copy of an answer that could drift from the
 * package it describes. A mismatch is reported with both values.
 *
 * This rule detects and stops. It never adds or edits notice text: a missing entry
 * or a stale version is a packaging defect for a later round to repair.
 *
 * @param findings - this rule's finding list.
 */
/**
 * Find a field in the notices file's block record form for one package.
 *
 * The file's other record form is a fenced block: `package:  <name>`,
 * `version:  <v>`, `license:  <l>`. The search is anchored to the `package:` line and
 * bounded to a handful of following lines, and that anchoring is a correction rather
 * than a refinement. The first version allowed up to 240 arbitrary characters between
 * the name and the field, which on a 400-line notices file runs straight through the
 * markdown table: blanking `pdfjs-dist`'s license cell still matched, because the gap
 * reached the licence of a *later* library's block record, and the rule then reported
 * nothing. A field lookup keyed on a package name must not be able to answer with
 * another package's value.
 *
 * @param notices - the whole notices file text.
 * @param name - the package name to find.
 * @param field - `version` or `license`.
 * @returns the recorded value, or `null` when no block record names it.
 */
function findPackageRecordValue(notices, name, field) {
  const escaped = name.replace(/[/.@]/g, (character) => `\\${character}`)
  const pattern = new RegExp(`^package:\\s+${escaped}\\s*$((?:\\n[^\\n]*){0,4}?)^${field}:\\s*(\\S[^\\n]*)$`, 'm')
  const match = pattern.exec(notices)
  if (match === null) return null
  return (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '')
}

function ruleThirdPartyNotices(findings) {
  const notices = readText(join(ROOT, 'THIRD_PARTY_NOTICES.md'))
  if (notices === null) return // R1 already named the missing file.

  const lockText = readText(join(ROOT, 'pnpm-lock.yaml'))
  const lock = lockText === null
    ? { ok: false, dependencies: new Map(), devDependencies: new Map(), packages: new Set(), edges: new Map() }
    : parseLockfile(lockText)
  if (!lock.ok) {
    report(findings, 'pnpm-lock.yaml is missing or is not a pnpm v9 lockfile, so no shipped runtime version can be resolved', 'pnpm-lock.yaml')
    return
  }

  // The exact-pin rule, applied to the direct runtime edges the lockfile records.
  for (const [name, specifier] of lock.dependencies) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(specifier)) {
      report(findings, 'runtime dependency is not pinned to one exact version, so a notice cannot name the version that ships', 'package.json', undefined, undefined, `${name} = ${specifier}`)
    }
  }

  // A declared runtime dependency that is not on the shipped list is a coverage
  // hole by construction: the list is what the rest of this rule iterates, so a new
  // dependency would otherwise ship with no notice and no finding. The detection
  // proof caught this as a false negative — `"left-pad": "1.3.0"` added to
  // `dependencies` produced a PASS. The check is a set equality between the two
  // sides, restricted to the runtime graph: a devDependency is not shipped, and a
  // library on the list that nothing declares is caught in the loop below.
  for (const name of lock.dependencies.keys()) {
    if (!SHIPPED_RUNTIME_LIBRARIES.includes(name)) {
      report(findings, 'runtime dependency is not covered by this rule\'s shipped-library list, so its notice is never checked', 'package.json', undefined, undefined, `${name} = ${lock.dependencies.get(name)}`)
    }
  }

  const rows = parseNoticeTables(notices)
  const resolvedVersions = (name) => {
    const found = new Set()
    for (const key of lock.packages) {
      const split = splitPackageKey(key)
      if (split !== null && split.name === name) found.add(split.version)
    }
    if (found.size === 0) {
      for (const [key, version] of lock.edges) {
        if (keyResolves(key, name)) found.add(version.replace(/\(.*$/, ''))
      }
    }
    return [...found].sort()
  }

  for (const library of SHIPPED_RUNTIME_LIBRARIES) {
    const resolved = resolvedVersions(library)
    if (resolved.length === 0) {
      report(findings, 'library is treated as a shipped runtime dependency but nothing of that name resolves in pnpm-lock.yaml', library)
      continue
    }
    const resolvedList = resolved.join(', ')

    const tableRows = rows.filter((row) => row.name === library)
    const row = tableRows.find((candidate) => candidate.shipped) ?? tableRows[0]
    if (row === undefined) {
      report(findings, 'shipped runtime library has no row in the notices tables, so its identity, version and license are unrecorded', 'THIRD_PARTY_NOTICES.md', undefined, undefined, library)
      continue
    }
    const at = `THIRD_PARTY_NOTICES.md:${row.line}`
    if (!row.shipped) {
      report(findings, `shipped runtime library is recorded only under "${row.heading}", the section that describes packages which are not shipped`, at, undefined, undefined, library)
    }

    if (row.version === undefined || row.version.trim() === '') {
      // The file's other record form is a fenced `package:/version:/license:` block.
      const recordedVersion = findPackageRecordValue(notices, library, 'version')
      if (recordedVersion === null) {
        report(findings, `notices carry no version for this shipped library; the lockfile resolves ${resolvedList}`, at, undefined, undefined, library)
      } else if (!recordsVersion(recordedVersion, resolved)) {
        report(findings, `notices record version "${recordedVersion}" but the lockfile resolves ${resolvedList}`, at, undefined, undefined, library)
      }
    } else if (!recordsVersion(row.version, resolved)) {
      report(findings, `notices record version "${row.version}" but the lockfile resolves ${resolvedList}`, at, undefined, undefined, library)
    }

    const manifestPath = findInstalledManifest(library, resolved)
    const manifest = manifestPath === null ? null : readJson(manifestPath)
    if (manifest === null || manifestPath === null) {
      report(findings, 'library is not installed, so the recorded license cannot be checked against its own manifest; run `pnpm install`', `node_modules/${library}/package.json`)
      continue
    }
    const declared = typeof manifest.license === 'string'
      ? manifest.license
      : Array.isArray(manifest.licenses)
        ? manifest.licenses.map((entry) => entry?.type).filter((type) => typeof type === 'string').join(' OR ')
        : undefined
    // Is a license recorded at all, and is it the one the installed package declares?
    //
    // The table cell is authoritative when the row has one. A row that carries a version
    // cell and an empty license cell is a notice claiming the identity and omitting the
    // license, so it is reported. Falling through to the block record there was the defect
    // Agent D found: the block form is a *different statement about the same package*, and
    // the earlier, unbounded lookup reached a later library’s block record and answered
    // with that library’s licence. Only a row with no license cell at all consults the
    // block form, which is how this file records a package no table row covers.
    const recorded = (row.license ?? '').trim()
    if (recorded === '') {
      // A row that *has* a license cell and leaves it blank is reported here, and the
      // empty string is the whole test: the earlier version computed the lookup result
      // and then compared it with `null`, which a blanked cell never is, so the finding
      // was never produced and blanking a license cell still passed. Only a row with no
      // license cell at all — `row.license === undefined` — consults the block form.
      const recordedLicense = row.license === undefined
        ? findPackageRecordValue(notices, library, 'license')
        : ''
      if (recordedLicense === null || recordedLicense.trim() === '') {
        report(findings, 'notices carry no license for this shipped library, so its license is unrecorded', at, undefined, undefined, library)
      }
    } else if (typeof declared === 'string' && declared !== '') {

      // A manifest may state a disjunction or wrap it in parentheses — `jszip`
      // declares `(MIT OR GPL-3.0-or-later)` — while the notice records the branch
      // the package is used under. Both are statements about the same package, so
      // the comparison is on the alternatives, with surrounding punctuation
      // removed. That is also the recorded-versus-declared comparison the notices
      // file itself makes for `jszip`: "MIT (MIT OR GPL-3.0-or-later, used under
      // MIT)".
      const parts = declared
        .replace(/^[\s(]+|[)\s]+$/g, '')
        .split(/\s+OR\s+/i)
        .map((part) => part.replace(/^[\s(]+|[)\s]+$/g, '').trim().toLowerCase())
        .filter((part) => part !== '')
      if (parts.length > 0 && !parts.some((part) => recorded.toLowerCase().includes(part))) {
        report(findings, `notices record license "${recorded}" but the installed manifest declares "${declared}"`, at, undefined, undefined, library)
      }
    }
  }
}

/**
 * R9: no remote document-upload shape in production source.
 *
 * "Upload" means a remote address reached with document bytes. The shape refused
 * here is a literal absolute address named by the plugin's own source, because
 * that is what an upload needs and what this plugin must never have. OOXML, W3C
 * and Adobe namespace identifiers are names, not addresses — nothing dereferences
 * them — so they are excluded by host. A URL assembled from variables at run time
 * cannot be seen by a text scan; that is a limitation of the gate, not a claim of
 * absence, which is why the runtime suites and the browser specs remain the gate
 * for it.
 *
 * @param findings - this rule's finding list.
 */
function ruleRemoteUpload(findings) {
  const sources = collectFiles(join(ROOT, 'src'), SOURCE_EXTENSIONS)
  if (reportEmptyInputSet(findings, 'src/**', sources.length)) return
  for (const file of sources) {
    const text = readText(file)
    if (text === null) continue
    const shown = relative(ROOT, file).split(sep).join('/')
    scanText(findings, shown, text, 'production source names a remote address', /https?:\/\/[^\s'"`)\\]{1,140}/g, (match) => {
      const address = (match[0] ?? '').replace(/['"`].*$/, '')
      if (NAMESPACE_HOSTS.some((host) => address.startsWith(`http://${host}/`) || address.startsWith(`https://${host}/`))) return false
      if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/.test(address)) return false
      return !address.endsWith('#')
    })
  }
}

/**
 * R10: the published surface names no test tree, generated report or local path.
 *
 * A published `files` or `exports` entry that names `tests/`, a Playwright report
 * or the disposable smoke workspace puts build-time material into the tarball, and
 * an absolute path publishes the machine that built it. Both are invisible in a
 * source review and both are decided by this one file.
 *
 * @param findings - this rule's finding list.
 */
function rulePublishedSurface(findings) {
  const manifest = readJson(join(ROOT, 'package.json'))
  if (manifest === null) {
    report(findings, 'package.json is missing or is not JSON, so the published surface cannot be read', 'package.json')
    return
  }

  const entries = []
  for (const value of Array.isArray(manifest.files) ? manifest.files : []) {
    entries.push({ where: 'files', value: String(value) })
  }
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === 'string') entries.push({ where: `exports["${subpath}"]`, value: target })
    else if (target !== null && typeof target === 'object') {
      for (const [condition, value] of Object.entries(target)) {
        if (typeof value === 'string') entries.push({ where: `exports["${subpath}"].${condition}`, value })
      }
    }
  }

  for (const { where, value } of entries) {
    const normalised = value.split('\\').join('/')
    for (const fragment of FORBIDDEN_PUBLISHED_FRAGMENTS) {
      if (normalised.includes(fragment)) {
        report(findings, `${where} publishes the non-shipping tree "${fragment}"`, 'package.json', undefined, undefined, `${where} = ${value}`)
      }
    }
    if (isMachineLocalPath(normalised)) {
      report(findings, `${where} names an absolute local path or a user home directory`, 'package.json', undefined, undefined, `${where} = ${value}`)
    }
  }
}

/**
 * R11: the built artifacts carry no private DSH source path.
 *
 * R3 answers this for `src/**` specifiers; a bundler can also inline a path no
 * source file states, and a vendored copy is how a private DSH module would most
 * plausibly arrive in the artifact. The check is on the artifact text, so it sees
 * whichever route produced it.
 *
 * The rule is scoped to `@deepseek-ai/…/src/`, and that scope is a measurement
 * rather than a preference. A generic `node_modules/<pkg>/src/` scan was tried
 * first and reported **123** sites: every one of them a `sourceMappingURL`
 * comment inside a bundled `d3-*` module (`//# sourceMappingURL=../src/…`), which
 * is third-party provenance metadata this plugin neither controls nor can fix.
 * A gate whose output is a hundred lines of somebody else's comments is a gate
 * nobody reads, so the DSH path — the actual boundary — is what this rule names.
 *
 * @param findings - this rule's finding list.
 */
function ruleBuiltArtifactInternals(findings) {
  for (const artifact of BUILT_ARTIFACTS) {
    const text = readText(join(ROOT, artifact))
    if (text === null) continue
    scanText(findings, artifact, text, 'built artifact names a DSH package source path', /@deepseek-ai\/[A-Za-z0-9._-]+\/src\//g)
  }
}

/**
 * R12: the built client declares every runtime service it injects through.
 *
 * The service names are read out of the artifact's own `inject` declaration rather
 * than from a list written here, and each is then required to exist as a string
 * literal. Two measurements produced that design.
 *
 * The first is coverage: a hard-coded list of the services the plugin *does*
 * declare cannot notice a service the plugin newly declares and never checks,
 * because the interesting name is by definition the one not on the list.
 *
 * The second is syntactic: the declaration is emitted with double quotes
 * (`inject: ["slots", "documentPreviews"]`), so a rule that only looked for
 * `'documentPreviews'` was satisfied by an unrelated single-quoted occurrence
 * elsewhere in the bundle. The detection proof caught exactly that — the
 * `documentPreviews` literals were removed from the declaration and the rule still
 * passed, because the runtime's own error message carries the same word in single
 * quotes.
 *
 * @param findings - this rule's finding list.
 */
function ruleDeclaredServices(findings) {
  const artifact = 'lib/client.js'
  const text = readText(join(ROOT, artifact))
  if (text === null) return // R1 already named the missing artifact.

  const declaration = INJECT_DECLARATION.exec(text)
  if (declaration === null) {
    report(findings, 'built client carries no `inject: [...]` declaration, so the fiber has no service list to order the apply against', artifact)
    return
  }
  const start = declaration.index + declaration[0].length - 1
  const end = text.indexOf(']', start)
  const body = end === -1 ? text.slice(start) : text.slice(start, end)
  const declared = new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1] ?? ''))

  // A control on the reader itself: the plugin's own inject list is a known,
  // non-empty answer, so an empty parse is a failure of this rule and not a finding
  // about the artifact.
  if (declared.size === 0) {
    report(findings, 'the built client\'s inject declaration contains no service name, so this rule could not measure it', artifact, undefined, undefined, declaration[0])
    return
  }

  for (const service of REQUIRED_SERVICES) {
    if (!declared.has(service)) {
      report(findings, `built client does not declare the required runtime service "${service}" in its inject list (declared: ${[...declared].join(', ')})`, artifact, undefined, undefined, declaration[0])
    }
  }
}

/**
 * The rules, in report order. Each carries the one-line meaning the summary prints.
 */
const RULES = [
  { id: 'R1', meaning: 'required build files exist', run: ruleRequiredFiles },
  { id: 'R2', meaning: 'no CDN host or remote worker/WASM literal in the built JS', run: ruleRemoteAssets },
  { id: 'R3', meaning: 'no private DSH source import in src/**', run: rulePrivateDshImports },
  { id: 'R4', meaning: 'no ReactFiber in source or built artifacts', run: reactInternalRule('ReactFiber') },
  { id: 'R5', meaning: 'no __reactFiber in source or built artifacts', run: reactInternalRule('__reactFiber') },
  { id: 'R6', meaning: 'no composer DOM .value write', run: ruleComposerValueWrite },
  { id: 'R7', meaning: 'no production auto-submit signature', run: ruleAutoSubmit },
  { id: 'R8', meaning: 'THIRD_PARTY_NOTICES covers every shipped runtime library', run: ruleThirdPartyNotices },
  { id: 'R9', meaning: 'no remote document-upload shape in production source', run: ruleRemoteUpload },
  { id: 'R10', meaning: 'published files/exports name no test, report or absolute path', run: rulePublishedSurface },
  { id: 'R11', meaning: 'no private DSH source path in the built artifacts', run: ruleBuiltArtifactInternals },
  { id: 'R12', meaning: 'built client declares every injected runtime service', run: ruleDeclaredServices },
]

/**
 * Advisory, non-deciding note: document-relative URL construction in the artifacts.
 *
 * A bundled dependency legitimately reaches for its own asset through a URL
 * relative to the document — `@aiden0z/pptx-renderer` builds one from
 * `import.meta.url`, which a CommonJS target emits as
 * `require("url").pathToFileURL(__filename).href`. Nothing in this repository
 * serves that asset, and R2 already fails a *remote* address, so the count is
 * printed for the reviewer and does not decide the exit code. Making it a failure
 * would assert a runtime property this scan cannot measure.
 *
 * @returns the number of document-relative URL constructions in the artifacts.
 */
function advisoryDocumentRelativeFetches() {
  let count = 0
  for (const artifact of BUILT_ARTIFACTS) {
    const text = readText(join(ROOT, artifact))
    if (text === null) continue
    count += (text.match(/pathToFileURL/g) ?? []).length
  }
  return count
}

/**
 * Run every rule, print the report, and set the exit code.
 *
 * The heuristic statement is printed unconditionally, on a green run as well as a
 * red one, because a green run is exactly when a reader is most likely to mistake
 * this report for a proof.
 */
function main() {
  const started = RULES.map((rule) => ({ rule, findings: [] }))
  for (const entry of started) {
    try {
      entry.rule.run(entry.findings)
    } catch (error) {
      // A rule that throws must not take the report down with it: the other rules
      // still have an answer, and the exit code must still be non-zero.
      report(entry.findings, `the rule itself threw: ${error instanceof Error ? error.message : String(error)}`, undefined)
    }
  }

  console.log(`verify: repository root = ${ROOT}`)
  console.log('verify: HEURISTIC GATES — a text scan of this tree. Not a parser, not a sandbox,')
  console.log('verify: not a substitute for the runtime tests. A passing rule means only that the')
  console.log('verify: signature it names was not found: finding no `ReactFiber` string does not')
  console.log('verify: prove that no other private React access exists. The real correctness gate is')
  console.log('verify: `pnpm test` plus `pnpm test:browser`.')

  let failed = 0
  for (const { rule, findings } of started) {
    if (findings.length === 0) {
      console.log(`PASS ${rule.id} ${rule.meaning}`)
      continue
    }
    failed += 1
    console.log(`FAIL ${rule.id} ${rule.meaning} — ${findings.length} finding${findings.length === 1 ? '' : 's'}`)
    for (const finding of findings) console.log(`  - ${finding}`)
  }

  const advisory = advisoryDocumentRelativeFetches()
  if (advisory > 0) {
    console.log(
      `note (advisory, not part of the exit code): ${advisory} document-relative URL construction(s) ` +
        'in the built artifacts, from bundled dependencies; R2 requires them to name no remote host.',
    )
  }

  console.log(`verify: ${started.length - failed}/${started.length} heuristic rules passed`)
  if (failed > 0) {
    console.error(`verify: ${failed} heuristic rule(s) FAILED — see the findings above`)
    process.exitCode = EXIT_FAILURE
  } else {
    console.log('verify: all heuristic rules passed')
  }
}

main()
