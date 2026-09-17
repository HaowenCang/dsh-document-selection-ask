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
  readonly key:
    | 'txt'
    | 'code'
    | 'markdown'
    | 'pdf-single'
    | 'pdf-two'
    | 'pdf-cjk'
    | 'pdf-image'
    | 'docx-paragraphs'
    | 'docx-break'
    | 'docx-table-image'
    | 'docx-headers-footers'
    | 'docx-external-links'
  /** Control label, ASCII so the smoke locates it independently of the UI locale. */
  readonly label: string
  /** Path relative to the repository root, which is the Session's workspace. */
  readonly path: string
  /** Exact file contents, for the fixtures the bootstrap writes; absent for a copied one. */
  readonly text?: string
  /**
   * The right-Sidebar **tab kind** `openResource` should name, or `undefined` to
   * let the tab registry rank the types that claim the address.
   *
   * This is a statement about which *tab type* opens the address, and nothing
   * about how the file is read. The two are separate contracts in rc.1: the tab
   * kind decides which panel occupies the column, while the document preview
   * decides its own content mode from the rank of the **renderer definition** it
   * selects — and the PDF renderer registers `loading: 'bytes-complete'`, so the
   * preview reads the complete file and hands the body a `Uint8Array`. Nothing
   * the driver passes can make a PDF be read as text.
   *
   * Every fixture therefore names the product's document preview, and the reason
   * is measured rather than a preference. On this machine's profiles
   * `dsh-better-sidebar` takes over **every** `dsh-resource://file/**` address: it
   * registers an editor at `priority: 'extension'` with that glob and
   * `canOpen: parseFileAddress(address) !== undefined`, which outranks the
   * document preview's own `fallback` band and is registered later, so it wins
   * the tie. A bare `openResource` for any file — text or PDF — lands in that
   * plugin's editor, whose own fetch answers `HTTP 400`, and no document preview
   * is mounted at all. The probes recorded exactly that for both a `.txt` and a
   * `.pdf`.
   */
  readonly tabKind?: string
}

/**
 * The fixtures, with their paths and contents fixed by the smoke contract.
 *
 * The Markdown fixture is written with `\n` escapes rather than a template
 * literal so both the paragraph and the fenced block are visible in review and
 * cannot be altered by an editor that re-indents the file. The PDF entries carry
 * no `text`: their bytes live in `tests/fixtures/pdf/`, they are committed rather
 * than generated per run, and the profile bootstrap copies them into the
 * session's workspace — a binary written from a string literal here would be a
 * second, drifting copy of a file that already exists.
 */
export const SMOKE_FIXTURES: readonly SmokeFixture[] = [
  {
    key: 'txt',
    label: 'Open smoke TXT',
    path: 'smoke-fixtures/task5b-smoke.txt',
    text: 'alpha\nbeta\ngamma\n',
    tabKind: 'text',
  },
  {
    key: 'code',
    label: 'Open smoke Code',
    path: 'smoke-fixtures/task5b-smoke.ts',
    text: 'const alpha = 1\nconst beta = 2\nconst gamma = 3\n',
    tabKind: 'text',
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
    tabKind: 'text',
  },
  {
    key: 'pdf-single',
    label: 'Open PDF single',
    path: 'smoke-fixtures/task7-single-page.pdf',
    tabKind: 'text',
  },
  {
    key: 'pdf-two',
    label: 'Open PDF two pages',
    path: 'smoke-fixtures/task7-two-page.pdf',
    tabKind: 'text',
  },
  {
    key: 'pdf-cjk',
    label: 'Open PDF cjk',
    path: 'smoke-fixtures/task7-cjk.pdf',
    tabKind: 'text',
  },
  {
    key: 'pdf-image',
    label: 'Open PDF image only',
    path: 'smoke-fixtures/task7-image-only.pdf',
    tabKind: 'text',
  },
  {
    key: 'docx-paragraphs',
    label: 'Open DOCX paragraphs',
    path: 'smoke-fixtures/task9-paragraphs.docx',
    tabKind: 'text',
  },
  {
    key: 'docx-break',
    label: 'Open DOCX page break',
    path: 'smoke-fixtures/task9-manual-page-break.docx',
    tabKind: 'text',
  },
  {
    key: 'docx-table-image',
    label: 'Open DOCX table image',
    path: 'smoke-fixtures/task9-table-image.docx',
    tabKind: 'text',
  },
  {
    key: 'docx-headers-footers',
    label: 'Open DOCX headers footers',
    path: 'smoke-fixtures/task9-headers-footers.docx',
    tabKind: 'text',
  },
  {
    key: 'docx-external-links',
    label: 'Open DOCX external links',
    path: 'smoke-fixtures/task9-external-links.docx',
    tabKind: 'text',
  },
]

/**
 * The DOCX fixtures, by key: the committed source file and the workspace name it
 * is copied to.
 */
export const DOCX_FIXTURE_SOURCES: readonly { readonly key: SmokeFixture['key']; readonly source: string }[] = [
  { key: 'docx-paragraphs', source: 'tests/fixtures/docx/paragraphs.docx' },
  { key: 'docx-break', source: 'tests/fixtures/docx/manual-page-break.docx' },
  { key: 'docx-table-image', source: 'tests/fixtures/docx/table-image.docx' },
  { key: 'docx-headers-footers', source: 'tests/fixtures/docx/headers-footers.docx' },
  { key: 'docx-external-links', source: 'tests/fixtures/docx/external-links.docx' },
]

/**
 * The PDF fixtures, by key: the committed source file and the workspace name it
 * is copied to.
 *
 * The profile bootstrap writes from this table, and `tests/unit/smoke-profile.spec.ts`
 * asserts that it and `SMOKE_FIXTURES` name the same files — so a divergence
 * fails the unit suite rather than producing a browser smoke that opens a file
 * nobody copied.
 */
export const PDF_FIXTURE_SOURCES: readonly { readonly key: SmokeFixture['key']; readonly source: string }[] = [
  { key: 'pdf-single', source: 'tests/fixtures/pdf/single-page.pdf' },
  { key: 'pdf-two', source: 'tests/fixtures/pdf/two-page.pdf' },
  { key: 'pdf-cjk', source: 'tests/fixtures/pdf/cjk.pdf' },
  { key: 'pdf-image', source: 'tests/fixtures/pdf/image-only.pdf' },
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
