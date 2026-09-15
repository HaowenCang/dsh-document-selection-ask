/**
 * Reproducibility guard.
 *
 * The contract environment is reproducible only while the repository stays free
 * of machine-specific paths and of install-time hooks that write outside the
 * project. Both failure modes are easy to reintroduce and silent when they are:
 * a hard-coded `C:\Users\...` path compiles on the machine that wrote it and
 * nowhere else, and a `preinstall` hook that "repairs" the user's DSH
 * installation makes `pnpm install` mutate state this project does not own.
 *
 * This spec therefore reads the repository the way a fresh clone receives it —
 * the files Git would check out, filtered by `.gitignore` and never by a
 * directory listing that happens to be complete on one machine. Anything it
 * flags is a real regression; nothing here is exempted because it is
 * inconvenient.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * This spec is the one file that must spell out the markers it looks for, so it
 * scans itself out. The exemption is not a hole: the file is checked in and its
 * own contents are reviewed, and a later assertion requires it to be present in
 * the enumeration.
 */
const SELF = 'tests/unit/reproducibility.spec.ts'

/** Text extensions a clone can be checked out from; binaries are never scanned. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.json', '.yml', '.yaml']

/** Absolute-path shapes that pin a repository artifact to one machine. */
const MACHINE_PATH_MARKERS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'Windows user profile path', pattern: /[A-Za-z]:\\Users\\/ },
  { label: 'macOS home path', pattern: /\/Users\// },
  { label: 'Linux home path', pattern: /\/home\/[a-z0-9_-]+\//i },
]

/**
 * Names of the withdrawn user-level repair mechanism. They must not survive in
 * code, configuration, or scripts; compatibility documentation explains why the
 * mechanism was removed, which is a description rather than a dependency.
 */
const FORBIDDEN_MECHANISM_NAMES = ['.dsh-module-fallback', 'DSH_LINK_NO_INSTALL_REPAIR']

/** Files allowed to describe the withdrawn mechanism in prose. */
const PROSE_ONLY_FILES = new Set(['README.md', 'README.zh.md'])

/** Documentation and record directories where prose is exempt from path scanning. */
const PROSE_ONLY_PREFIXES = ['docs/', 'AGENTS.md', 'DEEPSEEK_START_PROMPT.md', 'DEEPSEEK_TASK_PROMPT.md']

/** Install-time hooks that run inside a consumer's `pnpm install`. */
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare']

interface IgnoreRule {
  readonly matches: (candidate: string) => boolean
  readonly negated: boolean
}

/**
 * Translate one `.gitignore` pattern into a matcher over repository-relative
 * POSIX paths.
 *
 * Only the syntax this repository uses is implemented — a literal path, a
 * directory pattern, `*`, `**`, and a leading `/` — because a partial
 * implementation of the full grammar is safer than a listing that silently
 * disagrees with Git.
 * @param pattern - one non-empty, non-comment `.gitignore` line.
 * @returns the matcher for that line.
 */
function gitignoreMatcher(pattern: string): IgnoreRule {
  const negated = pattern.startsWith('!')
  const body = (negated ? pattern.slice(1) : pattern).replace(/^\//, '').replace(/\/$/, '')
  const directoryOnly = pattern.endsWith('/') || !body.includes('.')
  const escaped = body
    .split('')
    .map((character) => ('.+^${}()|[]\\'.includes(character) ? `\\${character}` : character))
    .join('')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*')
  const suffix = directoryOnly ? '(?:/.*)?' : ''
  const matcher = new RegExp(`^${escaped}${suffix}$`)
  return { negated, matches: (candidate: string) => matcher.test(candidate) }
}

/**
 * Read `.gitignore` into ordered matchers. Later lines win, as in Git.
 * @returns the matchers, in file order.
 */
function ignoreRules(): readonly IgnoreRule[] {
  const ignoreFile = join(repoRoot, '.gitignore')
  if (!existsSync(ignoreFile)) return []
  return readFileSync(ignoreFile, 'utf8')
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter((line: string) => line !== '' && !line.startsWith('#'))
    .map(gitignoreMatcher)
}

/**
 * Decide whether a repository-relative path is ignored.
 * @param path - repository-relative POSIX path.
 * @param isDirectory - whether the path names a directory.
 * @param rules - matchers from {@link ignoreRules}.
 * @returns true when Git would not check the path out.
 */
function isIgnored(path: string, isDirectory: boolean, rules: readonly IgnoreRule[]): boolean {
  let ignored = false
  for (const rule of rules) {
    if (rule.matches(path) || (isDirectory && rule.matches(`${path}/`))) ignored = !rule.negated
  }
  return ignored
}

/**
 * List every file a fresh clone would receive, with its repository-relative
 * POSIX path. `.git` is skipped rather than filtered, so its contents can never
 * be mistaken for project content.
 * @returns relative paths, sorted.
 */
function trackedFiles(): readonly string[] {
  const rules = ignoreRules()
  const found: string[] = []
  const walk = (absolute: string, prefix: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (prefix === '' && entry.name === '.git') continue
      const childPrefix = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (isIgnored(childPrefix, entry.isDirectory(), rules)) continue
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) walk(child, childPrefix)
      else if (entry.isFile()) found.push(childPrefix)
    }
  }
  walk(repoRoot, '')
  return found.sort()
}

/**
 * Decide whether a file is prose, where a machine path may legitimately be
 * quoted as an example rather than depended upon.
 * @param path - repository-relative POSIX path.
 * @returns true for documentation and records.
 */
function isProse(path: string): boolean {
  return PROSE_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix) || path === prefix)
}

/**
 * Decide whether a file's contents are text this guard should read.
 * @param path - repository-relative POSIX path.
 * @returns true when the path has a scanned extension.
 */
function isScanned(path: string): boolean {
  return SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension))
}

const files = trackedFiles()

describe('reproducibility guard', () => {
  it('enumerates the repository from Git-visible files only', () => {
    // A guard that silently scans nothing would pass forever. These files are
    // checked in, so their absence means the enumeration is broken.
    expect(files).toContain('package.json')
    expect(files).toContain('.gitignore')
    expect(files).toContain(SELF)
    expect(files).toContain('scripts/dsh-doctor.mjs')
    // `node_modules` and `lib` are ignored; if either appears, the ignore
    // handling regressed and every later scan would read build output.
    expect(files.some((path) => path.startsWith('node_modules/'))).toBe(false)
    expect(files.some((path) => path.startsWith('lib/'))).toBe(false)
    // Every entry is repository-relative, so no scan can escape the checkout.
    expect(files.every((path) => !path.startsWith('..') && !path.includes(':'))).toBe(true)
    expect(relative(repoRoot, repoRoot)).toBe('')
  })

  it('carries no machine-specific absolute paths', () => {
    const offenders: string[] = []
    for (const path of files) {
      // Prose may quote a path to explain why it is forbidden; a machine path in
      // documentation cannot break a build.
      if (path === SELF || isProse(path) || !isScanned(path)) continue
      const source = readFileSync(join(repoRoot, path), 'utf8')
      for (const { label, pattern } of MACHINE_PATH_MARKERS) {
        if (!pattern.test(source)) continue
        const line = source.split(/\r?\n/).findIndex((text: string) => pattern.test(text)) + 1
        offenders.push(`${path}:${line} contains a ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the DSH installation out of the build and install path', () => {
    const offenders: string[] = []
    for (const path of files) {
      if (path === SELF || !isScanned(path)) continue
      // Documentation explains the withdrawn mechanism; code and configuration
      // must not name it.
      if (PROSE_ONLY_FILES.has(path) || isProse(path)) continue
      const source = readFileSync(join(repoRoot, path), 'utf8')
      for (const name of FORBIDDEN_MECHANISM_NAMES) {
        if (source.includes(name)) offenders.push(`${path} references ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares no install hook that could write outside the project', () => {
    const manifest: { scripts?: Record<string, string> } = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    )
    const scripts = manifest.scripts ?? {}
    expect(INSTALL_HOOKS.filter((hook) => hook in scripts)).toEqual([])
  })

  it('pins every DSH contract dependency to one exact release', () => {
    const manifest: { devDependencies?: Record<string, string> } = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    )
    const devDependencies = manifest.devDependencies ?? {}
    const dshPackages = Object.entries(devDependencies).filter(([name]) =>
      name.startsWith('@deepseek-ai/'),
    )
    // The contract dependencies are the point of the pin; an empty list would
    // mean they were dropped and the probe compiles against nothing.
    expect(dshPackages.length).toBeGreaterThan(0)

    const releases = new Set<string>()
    for (const [name, range] of dshPackages) {
      expect(`${name}@${range}`).toMatch(/^@deepseek-ai\/[a-z0-9-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
      // Cordis is versioned independently of the DSH release train.
      if (name === '@deepseek-ai/cordis') continue
      releases.add(range)
    }
    // One release for the whole family: two releases of one interface inside a
    // single program is the skew that makes a slot key resolve to `never`.
    expect([...releases]).toHaveLength(1)
  })

  it('routes TypeScript module resolution through no external directory', () => {
    for (const path of ['tsconfig.json', 'tsconfig.client.json', 'tsconfig.build.json']) {
      if (!files.includes(path)) continue
      const config = readFileSync(join(repoRoot, path), 'utf8')
      // `paths` is the one compiler option that could point a bare specifier at
      // a directory outside this project without leaving a trace in an import.
      expect(config).not.toMatch(/"baseUrl"/)
      expect(config).not.toMatch(/"paths"\s*:/)
    }
  })

  it('records no absolute path in the lockfile', () => {
    const lock = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8')
    for (const { label, pattern } of MACHINE_PATH_MARKERS) {
      expect(lock, `pnpm-lock.yaml contains a ${label}`).not.toMatch(pattern)
    }
  })

  it('leaves the smoke profile work to a script that cannot touch a user profile', () => {
    // Task 5B brought the isolated `dsa-smoke` profile up through a project
    // script rather than by hand. Two properties keep that safe, and both are
    // cheap to lose in a later edit: the script refuses any profile but its own,
    // and the repository never writes to a profile path directly — the DSH home
    // is resolved at run time from `DSH_HOME`/`homedir()`, so no checkout carries
    // another machine's layout.
    const script = readFileSync(join(repoRoot, 'scripts', 'dsh-smoke-profile.mjs'), 'utf8')
    expect(script).toContain("const PROFILE_NAME = 'dsa-smoke'")
    expect(script).toContain('refusing to act on profile')
    expect(script).toContain("process.env.DSH_HOME ?? join(homedir(), '.dsh')")
    for (const { label, pattern } of MACHINE_PATH_MARKERS) {
      expect(script, `the smoke profile script contains a ${label}`).not.toMatch(pattern)
    }
  })

  it('publishes a doctor script in place of the removed repair hook', () => {
    const manifest: { scripts?: Record<string, string> } = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    )
    expect(manifest.scripts?.['dsh:doctor']).toBe('node scripts/dsh-doctor.mjs')
  })
})
