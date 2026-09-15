/**
 * The fixtures the real-DSH preview smoke opens, and the resource addresses
 * that name them.
 *
 * The addresses are built here rather than inside the component so the rule the
 * smoke depends on is stated once, in a pure function: a fixture is named by a
 * **session-scoped** `dsh-resource://file/` address, which is the only form the
 * resource model resolves against a Session's workspace root. An absolute
 * address would also load, but it would carry no session, and the Ask overlay
 * refuses a selection whose address names a session other than its own — so an
 * absolute fixture would render and then be silently unquotable.
 *
 * The grammar is the one DSH publishes:
 * `dsh-resource://file/session/<sessionId>/<path>`, every id and path segment
 * component-encoded. This module builds that address directly instead of
 * importing DSH's own `sessionFileAddress` for one measured reason: the helper
 * lives in `@deepseek-ai/dsh-util-workspace-path`, a **host-side** package, and a
 * browser bundle cannot require it — the DSH web module table seeds only the
 * platform singletons (`react`, `react-dom`, `@deepseek-ai/cordis`), so a
 * `require` of that package inside a client bundle throws at materialization.
 * The driver is test infrastructure and a three-segment address is not a parser,
 * so restating the grammar is cheaper than a build-time inline of a host module.
 * `tests/unit/smoke-profile.spec.ts` asserts the built address against the
 * fixture names this module lists, so a divergence fails the unit suite rather
 * than the browser smoke.
 */

/**
 * One fixture: the file the driver opens and the sample text the smoke selects.
 *
 * The sample text is part of the driver's own declaration because the browser
 * spec and the fixture writer must agree on it, and the fixture writer is the
 * only other place it appears.
 */
export interface SmokeFixture {
  /** Stable key; also the value of the control's `data-dsa-smoke-open`. */
  readonly key: 'txt' | 'code' | 'markdown'
  /** Control label, ASCII so the smoke locates it independently of the UI locale. */
  readonly label: string
  /** Path relative to the repository root, which is the Session's workspace. */
  readonly path: string
  /** Exact file contents, written by the smoke bootstrap. */
  readonly text: string
}

/**
 * The three fixtures, with their contents fixed by the Task 5B contract.
 *
 * The Markdown fixture is written with `\n` escapes rather than a template
 * literal so both the paragraph and the fenced block are visible in review and
 * cannot be altered by an editor that re-indents the file.
 */
export const SMOKE_FIXTURES: readonly SmokeFixture[] = [
  {
    key: 'txt',
    label: 'Open smoke TXT',
    path: 'smoke-fixtures/task5b-smoke.txt',
    text: 'alpha\nbeta\ngamma\n',
  },
  {
    key: 'code',
    label: 'Open smoke Code',
    path: 'smoke-fixtures/task5b-smoke.ts',
    text: 'const alpha = 1\nconst beta = 2\nconst gamma = 3\n',
  },
  {
    key: 'markdown',
    label: 'Open smoke Markdown',
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
 * Build the session-scoped resource address of one fixture.
 *
 * @param sessionId - the Session whose workspace root resolves the path; the
 * value the session-scoped `conversation.input.overlay` slot publishes.
 * @param path - repository-relative fixture path.
 * @returns the `dsh-resource://file/session/<sessionId>/<path>` address, with
 * every segment component-encoded.
 * @throws RangeError when either argument is empty, which would produce an
 * address no provider can resolve.
 */
export function smokeFixtureAddress(sessionId: string, path: string): string {
  if (sessionId === '') {
    throw new RangeError('A smoke fixture address needs a session id')
  }
  if (path === '') {
    throw new RangeError('A smoke fixture address needs a path')
  }

  const segments = path.split('/').map((segment) => encodeURIComponent(segment))
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${segments.join('/')}`
}
