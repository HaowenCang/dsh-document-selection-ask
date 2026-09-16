/**
 * Real DSH TextPreview smoke: the document preview is opened by DSH itself,
 * through a public client-plugin navigation call, and the whole Ask flow is then
 * observed against the preview DSH produced.
 *
 * ## What makes this different from `ask-flow.spec.ts`
 *
 * The earlier suite renders preview markup into a live page. That proved the
 * plugin's own behaviour 鈥?selection capture, geometry, focus, the composer
 * write 鈥?but it never proved that the **real** preview produces the DOM the
 * adapter reads. This suite does not render any preview markup at all. It clicks
 * a control the test-only companion plugin contributes, that control calls
 * `ctx.sidebarRight.openResource(address)` 鈥?the published navigation service 鈥? * and every `data-textpreview-*` node below is then produced by
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` itself.
 *
 * The two suites are reported separately for that reason, and only this one is
 * the Task 5B gate.
 *
 * ## The instance
 *
 * `DSH_SMOKE_URL` names a running DSH web instance carrying this plugin, the
 * test-only driver and the generated fixtures. The spec is skipped without it, so
 * `pnpm test:browser` stays usable on a machine with no DSH installed. Bring one
 * up with:
 *
 * ```text
 * pnpm build && pnpm smoke:driver
 * pnpm smoke:profile prepare
 * dsh --profile dsa-smoke --port 50111 --no-open
 * DSH_SMOKE_URL='http://127.0.0.1:50111/?token=鈥? pnpm test:browser
 * ```
 *
 * ## The defect this suite recorded, and how Task 5C closed it
 *
 * Task 5B recorded a live defect here. With the right column expanded the Ask
 * button was present, styled and on screen, but `document.elementFromPoint` at
 * its own centre returned an element inside the document preview and a real
 * pointer click was refused: the composer's floating overlay lived in a lower
 * stacking context than the right column, so no `z-index` on the plugin's own
 * elements could raise it.
 *
 * The consequence for Task 5B was that the ask assertions triggered the button
 * **programmatically** rather than through a pointer click. Task 5C moved the
 * visible surface to `shell.overlay`, the frame's own root-scoped floating layer,
 * and that workaround is deleted here: every case below presses the button with an
 * ordinary Playwright click, which runs the actionability check and performs a
 * real hit test. The defect case still exists, inverted, as the regression guard —
 * see `keeps the Ask button reachable while the right column is expanded`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The composer's editable surface, verified against rc.1. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The product preview's own attributes; none of these is written by any test. */
const PREVIEW_STATE = '[data-textpreview-state]'
const PREVIEW_BODY = '[data-textpreview-body]'
const PREVIEW_LINE = '[data-textpreview-line]'
const PREVIEW_RENDERER = 'data-document-preview'
const CODE_CONTENT = '[data-code-block-content]'
const CODE_LINE = `${CODE_CONTENT} pre .line`

/** The right column the preview is drawn inside. */
const RIGHT_COLUMN = '[data-rightbar-col]'

/** Renderer identities as the product registers them. */
const PLAIN_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'
const MARKDOWN_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'
const CODE_RENDERER = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'

/** The Ask button's accessible name and the question line an appended block ends with. */
const ASK_LABEL = '\u8be2\u95ee DeepSeek'
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** A draft the reader typed before selecting, which the ask must preserve. */
const EXISTING_DRAFT = 'existing draft'

/** The fixture keys this suite drives. */
type FixtureKey = 'txt' | 'code' | 'markdown'

/**
 * Read the fixture table out of the bootstrap script.
 *
 * The fixture files are generated, so their contents are not in git, and
 * restating them here would be a second source of truth for the same bytes. The
 * bootstrap script holds the one table, so this spec reads the table's own
 * literal text back out of it and asserts the file on disk against it. That turns
 * "the fixture DSH read is the fixture the smoke expects" into an assertion
 * rather than an assumption.
 *
 * @returns one entry per fixture, in table order.
 */
function fixtureTable(): readonly { key: string; path: string; text: string }[] {
  const source = readFileSync(join(repoRoot, 'scripts', 'dsh-smoke-profile.mjs'), 'utf8')
  const table = source.slice(source.indexOf('const SMOKE_FIXTURES = ['))
  const start = table.indexOf('[')
  let depth = 0
  let end = -1
  for (let index = start; index < table.length; index += 1) {
    if (table[index] === '[' || table[index] === '{') depth += 1
    if (table[index] === ']' || table[index] === '}') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  if (end < 0) throw new Error('scripts/dsh-smoke-profile.mjs has no closed SMOKE_FIXTURES table')

  // Evaluate the literal with the ordinary expression reader. It is a data
  // literal, and importing the script would run its command switch.
  const evaluate = new Function(`return ${table.slice(start, end + 1)}`)
  const entries = evaluate() as { key: string; path: string; text: string }[]
  if (entries.length === 0) throw new Error('the smoke fixture table is empty')
  return entries
}

/** The fixtures, read back from the writer. */
const TABLE = fixtureTable()

/**
 * One fixture, with its expected text read from the writer's own table.
 * @param key - the fixture key.
 * @returns the path and the exact text the writer was told to write.
 */
function fixture(key: FixtureKey): { path: string; text: string } {
  const found = TABLE.find((entry) => entry.key === key)
  if (found === undefined) throw new Error(`scripts/dsh-smoke-profile.mjs declares no ${key} fixture`)
  return { path: found.path, text: found.text }
}

/**
 * Open the DSH shell and wait for the composer and the driver's control.
 *
 * The composer is the anchor: the driver's control occupies a session-scoped
 * slot, so it only exists once a session is on screen.
 *
 * The workspace is then pointed at this repository. A `dsh-resource://file/
 * session/<id>/<path>` address resolves against the Session's workspace root, and
 * the instance keeps whichever workspace its last user selected — a run against
 * the wrong root fails with `workspace-file/not-found` for every fixture, which
 * reads like a renderer defect rather than a setup one. The routine is shared
 * with the Task 7 PDF suite; see `tests/browser/helpers/shell.ts`.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one fixture through the test-only driver's public navigation call, and
 * wait for the product preview to finish loading it.
 *
 * @param page - the browser page.
 * @param key - the fixture key.
 * @returns the resource address the preview published for itself.
 */
async function openFixture(page: Page, key: FixtureKey): Promise<string> {
  const target = fixture(key)
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  // The preview only publishes `data-textpreview-state` once it has an address;
  // before that the shell is still mounting the column.
  const root = page.locator(`${PREVIEW_STATE}[data-textpreview-url]`).first()
  await expect(root).toHaveAttribute('data-textpreview-state', 'text', { timeout: 30_000 })

  const address = await root.getAttribute('data-textpreview-url')
  expect(address, 'the preview must publish the address it opened').not.toBeNull()
  expect(address).toContain(target.path)
  await expect(page.locator(PREVIEW_BODY).first()).toBeVisible({ timeout: 30_000 })
  return address ?? ''
}

/**
 * Select a run of rows: press inside the first row, then shift-click the end of
 * the last one.
 *
 * A single drag across rows is unreliable here, and the reason is measured rather
 * than guessed. Shiki renders each line as a block-level `.line` whose box spans
 * the whole code block, so a row's leading edge is *outside* its own glyphs; a
 * drag anchored there snaps to the nearest character, and the probes recorded a
 * two-row drag that selected only the second row. Anchoring inside the first
 * row's first token and extending with a real Shift+click produces exactly the
 * run, in both the highlighted-code and the plain-renderer shapes.
 *
 * The gesture stays a real one: a real press, a real key held down, a real click
 * at the target. Nothing selects programmatically.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @returns the selected text as the browser reports it.
 */
async function selectRows(
  page: Page,
  rows: Locator,
  fromIndex: number,
  toIndex: number,
): Promise<string> {
  const firstToken = rows.nth(fromIndex).locator('span').first()
  const start = (await firstToken.count()) > 0 ? await firstToken.boundingBox() : await rows.nth(fromIndex).boundingBox()
  if (start === null) throw new Error('the first row to select has no box')

  const lastRow = rows.nth(toIndex)
  const lastTokens = lastRow.locator('span')
  const tokenCount = await lastTokens.count()
  const end =
    tokenCount > 0 ? await lastTokens.nth(tokenCount - 1).boundingBox() : await lastRow.boundingBox()
  if (end === null) throw new Error('the last row to select has no box')

  // The anchor press: inside the first row's own text. The offset is one pixel
  // from the token's leading edge — far enough to be a real point inside the
  // glyph run, close enough that the caret cannot land past its first character.
  await page.mouse.move(start.x + 1, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(200)

  // The extension: a real Shift press held across a real click.
  await page.keyboard.down('Shift')
  await page.mouse.move(end.x + Math.max(1, end.width - 1), end.y + end.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(900)
  return page.evaluate(() => document.getSelection()?.toString() ?? '')
}

/**
 * Select a run of rows and require the gesture to have taken exactly them.
 *
 * The retry is not a workaround for the plugin. The document column animates in
 * when the shell reveals it, and a drag anchored while it is still moving lands
 * on a different glyph than the one it aimed at — the probes recorded a
 * one-character selection where the row's whole text was intended. A single
 * `boundingBox()` read cannot tell a settled box from a moving one, so the case
 * retries the same real gesture, with a longer settle each time, until the
 * browser reports the run. Each attempt re-reads the box, and the final attempt's
 * answer is what the caller sees, so a genuine failure still fails.
 *
 * Nothing here selects programmatically: every attempt is a real press, a real
 * held Shift key and a real click.
 *
 * @param page - the browser page.
 * @param rows - the rows, in document order.
 * @param fromIndex - the first row to include.
 * @param toIndex - the last row to include.
 * @param expected - the text the gesture must have selected.
 * @returns the selected text as the browser reports it.
 */
async function selectExpectedRows(
  page: Page,
  rows: Locator,
  fromIndex: number,
  toIndex: number,
  expected: string,
): Promise<string> {
  let selected = ''
  for (const settle of [0, 800, 1600]) {
    if (settle > 0) await page.waitForTimeout(settle)
    selected = await selectRows(page, rows, fromIndex, toIndex)
    if (selected === expected) return selected
  }
  return selected
}

/**
 * One part of an appended block, as this suite asserts it.
 *
 * `exact` is for every part the contract fixes to the character: the provenance
 * line, the separator, the question suffix. `prefixOf` is for a selected line,
 * where a real drag across rendered text can take less than the whole line 鈥?a
 * Shiki row renders as several token spans 鈥?but must still take a non-empty
 * leading run of it.
 */
type DraftPart = { readonly exact: string } | { readonly prefixOf: string }

/**
 * Assert that a draft is exactly the appended block, part by part.
 *
 * A byte-for-byte comparison would be the wrong assertion here, for two measured
 * reasons.
 *
 * The composer is a Lexical contenteditable, and what it publishes as the draft
 * is the clipboard projection of that document: the block's newlines are not part
 * of the string, so the whole block arrives as one run of text. The parts are
 * therefore matched in order against the raw string, and the assertion that
 * nothing follows the last part is what keeps the check tight.
 *
 * And a drag across rendered text selects what the renderer draws. A row of
 * highlighted code is several spans, so the gesture can take `const beta =` where
 * the source line is `const beta = 2`. What the smoke has to prove is the
 * provenance and the shape of the block, not that a fractional drag landed on the
 * last character of a line; each case asserts its own selection extent where it
 * reads it.
 *
 * @param actual - the draft as the composer publishes it.
 * @param parts - the block's parts, in order.
 */
function expectDraftBlock(actual: string, parts: readonly DraftPart[]): void {
  let cursor = 0
  for (const part of parts) {
    if ('exact' in part) {
      const index = actual.indexOf(part.exact, cursor)
      expect(index, `the draft must contain ${JSON.stringify(part.exact)} at offset ${cursor}`).toBe(cursor)
      cursor += part.exact.length
      continue
    }

    const remaining = actual.slice(cursor)
    let length = 0
    while (length < part.prefixOf.length && remaining[length] === part.prefixOf[length]) length += 1
    expect(length, `the draft must carry a leading run of ${JSON.stringify(part.prefixOf)}`).toBeGreaterThan(0)
    cursor += length
  }

  expect(actual.slice(cursor), 'the block must end where the contract says it does').toBe('')
}

/**
 * Read the composer's rendered draft text.
 * @param page - the browser page.
 * @returns the draft text.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('[data-composer-input]')?.textContent ?? '')
}

/** Everything a case reports about the ask it just performed. */
interface AskOutcome {
  /** The draft as the composer holds it after the ask. */
  readonly draft: string
  /** Transcript rows before and after, which must be equal. */
  readonly turnsBefore: number
  readonly turnsAfter: number
  /** Whether focus was in the composer's editable surface afterwards. */
  readonly focusedAfter: boolean
  /** Whether the button retired, which a successful ask does. */
  readonly askGone: boolean
}

/**
 * Press the Ask button with a real pointer click and collect what the composer
 * did.
 *
 * The click is an ordinary Playwright `locator.click()`, which runs the
 * actionability check and performs a real hit test at the element's centre. It is
 * the point of Task 5C: while the button lived inside the composer, the expanded
 * right column painted over it and the browser refused this exact call. `force`,
 * `dispatchEvent` and an in-page `.click()` are deliberately absent, so a
 * regression that puts the button back under the column fails here rather than
 * passing on a bypass.
 *
 * @param page - the browser page.
 * @returns the outcome.
 */
async function pressAsk(page: Page): Promise<AskOutcome> {
  const turnsBefore = await page.locator('[data-chat-turn]').count()
  await page.locator(ASK_BUTTON).first().click({ timeout: 8000 })
  await page.waitForTimeout(1500)

  const draft = await readDraft(page)
  const focusedAfter = await page.evaluate(
    () => document.activeElement?.getAttribute('data-composer-input') !== null,
  )
  // A send would append a transcript row within this window; the count is read
  // late enough that a real submission could not hide behind the wait.
  await page.waitForTimeout(1800)
  const turnsAfter = await page.locator('[data-chat-turn]').count()

  return { draft, turnsBefore, turnsAfter, focusedAfter, askGone: (await page.locator(ASK_BUTTON).count()) === 0 }
}

/**
 * Type a draft into the composer, replacing whatever was there.
 * @param page - the browser page.
 * @param text - the draft to type.
 */
async function typeDraft(page: Page, text: string): Promise<void> {
  await page.locator(COMPOSER_INPUT).first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  if (text !== '') await page.keyboard.type(text)
  await page.waitForTimeout(700)
}

test.describe('real DSH 0.1.5-rc.1 TextPreview smoke', () => {
  test('mounts the product preview for a fixture DSH opened itself', async ({ page }) => {
    await openShell(page)

    const address = await openFixture(page, 'txt')

    // The preview is the product's own plain renderer, and its address names the
    // session-scoped fixture the driver asked for.
    await expect(page.locator(PREVIEW_STATE).first()).toHaveAttribute(PREVIEW_RENDERER, PLAIN_RENDERER)
    expect(address).toMatch(/^dsh-resource:\/\/file\/session\/[^/]+\/smoke-fixtures\/task5b-smoke\.txt$/)

    // The plain renderer publishes one row per source line, numbered from 1.
    await expect(page.locator(PREVIEW_LINE)).toHaveCount(3)
    await expect(page.locator('[data-textpreview-line="1"]')).toHaveText('alpha')
    await expect(page.locator('[data-textpreview-line="2"]')).toHaveText('beta')
    await expect(page.locator('[data-textpreview-line="3"]')).toHaveText('gamma')

    // The body's own text is the fixture's text: the file DSH read is the file
    // the bootstrap wrote.
    const bodyText = await page.locator(PREVIEW_BODY).first().innerText()
    expect(bodyText.replace(/\s+/g, ' ').trim()).toBe(fixture('txt').text.replace(/\s+/g, ' ').trim())
  })

  test('quotes the real TXT preview line 2 with exact provenance, keeping the draft and never sending', async ({
    page,
  }) => {
    await openShell(page)
    await openFixture(page, 'txt')

    await typeDraft(page, EXISTING_DRAFT)
    const selected = await selectExpectedRows(page, page.locator(PREVIEW_LINE), 1, 1, 'beta')
    expect(selected).toBe('beta')

    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(ASK_BUTTON).first()).toHaveText(ASK_LABEL)

    const outcome = await pressAsk(page)

    // The exact block the contract specifies, with the file name and the source
    // line the renderer's own row attribute proved.
    expectDraftBlock(outcome.draft, [
      { exact: EXISTING_DRAFT },
      { exact: '> [\u6765\u6e90\uff1atask5b-smoke.txt\uff0c\u7b2c 2 \u884c]' },
      { exact: '> beta' },
      { exact: QUESTION_SUFFIX },
    ])
    expect(outcome.turnsAfter).toBe(outcome.turnsBefore)
    expect(outcome.focusedAfter).toBe(true)
    expect(outcome.askGone).toBe(true)
  })

  test('quotes the real code preview rows 2-3 with exact provenance', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'code')

    await expect(page.locator(PREVIEW_STATE).first()).toHaveAttribute(PREVIEW_RENDERER, CODE_RENDERER)

    // The code renderer's own rows: one highlighted line per source line, inside
    // its own code-block viewport.
    const rows = page.locator(CODE_LINE)
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(1)).toHaveText('const beta = 2')
    await expect(rows.nth(2)).toHaveText('const gamma = 3')

    await typeDraft(page, '')
    const selected = await selectRows(page, rows, 1, 2)
    expect(selected).toContain('const beta = 2')
    expect(selected).toContain('const gamma = 3')

    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    const outcome = await pressAsk(page)

    expectDraftBlock(outcome.draft, [
      { exact: '> [\u6765\u6e90\uff1atask5b-smoke.ts\uff0c\u7b2c 2\u20133 \u884c]' },
      { prefixOf: '> const beta = 2' },
      { prefixOf: '> const gamma = 3' },
      { exact: QUESTION_SUFFIX },
    ])
    expect(outcome.turnsAfter).toBe(outcome.turnsBefore)
    expect(outcome.focusedAfter).toBe(true)
  })

  test('quotes a real Markdown preview paragraph with file-only provenance', async ({ page }) => {
    await openShell(page)
    await openFixture(page, 'markdown')

    await expect(page.locator(PREVIEW_STATE).first()).toHaveAttribute(PREVIEW_RENDERER, MARKDOWN_RENDERER)

    const paragraph = page.locator(`${PREVIEW_BODY} p`).filter({ hasText: 'alpha paragraph' }).first()
    await expect(paragraph).toBeVisible({ timeout: 15_000 })

    await typeDraft(page, '')
    const box = await paragraph.boundingBox()
    if (box === null) throw new Error('the paragraph has no box')
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 2, y, { steps: 14 })
    await page.mouse.up()
    await page.waitForTimeout(900)
    const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '')
    expect(selected).toBe('alpha paragraph')

    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    const outcome = await pressAsk(page)

    // Rendered Markdown has no source-line mapping, so the citation names the
    // file and nothing more.
    expectDraftBlock(outcome.draft, [
      { exact: '> [\u6765\u6e90\uff1atask5b-smoke.md]' },
      { exact: '> alpha paragraph' },
      { exact: QUESTION_SUFFIX },
    ])
    expect(outcome.draft).not.toMatch(/\u7b2c \d+ \u884c/)
    expect(outcome.turnsAfter).toBe(outcome.turnsBefore)
  })

  test('keeps a Markdown code fence file-only rather than reporting Shiki rows as source lines', async ({
    page,
  }) => {
    await openShell(page)
    await openFixture(page, 'markdown')

    // The fence is a real Shiki block with the same shape as a real code document
    // 鈥?which is exactly why the renderer's identity, not the block, decides
    // whether its rows may be read as source lines.
    const fence = page.locator(CODE_CONTENT).first()
    await expect(fence).toBeVisible({ timeout: 15_000 })
    const fenceRows = fence.locator('pre .line')
    await expect(fenceRows).toHaveCount(2)
    await expect(fenceRows.first()).toHaveText('const beta = 2')
    await expect(fenceRows.nth(1)).toHaveText('const gamma = 3')

    await typeDraft(page, '')
    const selected = await selectRows(page, fenceRows, 0, 0)
    // The row renders as several Shiki token spans, so the gesture may take only
    // part of it. What matters is that the selection lands inside the fence and
    // that the provenance below still names the file alone.
    expect(selected.trim().length).toBeGreaterThan(0)
    expect('const beta = 2'.startsWith(selected.trim())).toBe(true)

    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })
    const outcome = await pressAsk(page)

    // The fence's rows are Shiki rows, exactly like a real code document's. The
    // renderer identity is what decides they may not be read as source lines, so
    // the citation names the file only.
    expectDraftBlock(outcome.draft, [
      { exact: '> [\u6765\u6e90\uff1atask5b-smoke.md]' },
      { prefixOf: '> const beta = 2' },
      { exact: QUESTION_SUFFIX },
    ])
    expect(outcome.draft).not.toMatch(/\u7b2c \d+ \u884c/)
  })

  test('keeps the Ask button reachable while the right column is expanded', async ({ page }) => {
    // **Old behaviour failed here.** Before Task 5C this case asserted the
    // opposite: that the right column occluded the Ask button. The button was
    // rendered inside `conversation.input.overlay`, whose `z-index: 20` was
    // trapped in `wSkVaW_composerStack` (`z-index: 1`), so the expanded column, a
    // later sibling in the same stacking context, painted over it. At both
    // 1600x1000 and 2560x1300 `document.elementFromPoint` at the button's own
    // centre returned a node inside the document preview, and a real pointer click
    // was refused.
    //
    // The surface now occupies `shell.overlay`, the frame's own root-scoped
    // floating layer, which is a sibling of all three columns. This case asserts
    // the defect is gone, and it is the regression guard for the whole round: a
    // future change that puts the button back inside the composer turns it red.
    await openShell(page)
    await openFixture(page, 'txt')

    const selected = await selectExpectedRows(page, page.locator(PREVIEW_LINE), 1, 1, 'beta')
    expect(selected).toBe('beta')
    await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })

    const geometry = await page.evaluate(
      ([buttonSelector, columnSelector]: readonly [string, string]) => {
        const button = document.querySelector(buttonSelector)
        const column = document.querySelector(columnSelector)
        if (button === null) return null
        const box = button.getBoundingClientRect()
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        const columnBox = column?.getBoundingClientRect() ?? null
        return {
          button: { x: box.x, y: box.y, width: box.width, height: box.height },
          column: columnBox === null ? null : { x: columnBox.x, width: columnBox.width },
          hit: top === null ? null : `${top.tagName}.${top.className}`,
          buttonIsTopmost: top === button || button.contains(top),
          inComposer: button.closest('[data-composer-card]') !== null,
          inShellOverlay: button.closest('[data-shell-overlay]') !== null,
          overlaysColumn:
            columnBox !== null && box.x < columnBox.x + columnBox.width && box.x + box.width > columnBox.x,
        }
      },
      [ASK_BUTTON, RIGHT_COLUMN] as const,
    )

    expect(geometry, 'the Ask button must exist for this case to mean anything').not.toBeNull()
    // The column really is open and really does reach the button, so the hit test
    // below is a statement about painting rather than about the column being
    // somewhere else.
    expect(geometry?.column).not.toBeNull()
    expect(geometry?.column?.width ?? 0).toBeGreaterThan(0)
    expect(geometry?.overlaysColumn, 'the recorded defect presupposed the column reaching the button').toBe(true)

    // The fix, stated as the observable fact: the button is no longer inside the
    // composer, it is inside the frame's shell overlay, and the pixel at its own
    // centre is the button.
    expect(geometry?.inComposer).toBe(false)
    expect(geometry?.inShellOverlay).toBe(true)
    expect(geometry?.buttonIsTopmost, `elementFromPoint reached ${String(geometry?.hit)}`).toBe(true)

    // And the same fact as the browser enforces it: an ordinary Playwright click
    // passes its actionability check and lands. `force`, `dispatchEvent` and an
    // in-page `.click()` are deliberately absent; this call is the assertion.
    await page.locator(ASK_BUTTON).first().click({ timeout: 8000 })
    await page.waitForTimeout(1500)

    const draft = await readDraft(page)
    expect(draft).toContain('> beta')
    expect(draft).toContain(QUESTION_SUFFIX)
    expect(await page.locator(ASK_BUTTON).count()).toBe(0)
  })

  // The recorded defect was viewport-dependent in the sense that mattered: it was
  // present at every width tried, because the column always reached the button's
  // centre. These two cases assert the fix at the two widths the round bit on, and
  // each runs the whole hit test plus a real click at its own size.
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 2560, height: 1300 },
  ]) {
    test(`keeps the Ask button reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await openShell(page)
      await openFixture(page, 'txt')
      // The preview column keeps settling for a moment after the body appears —
      // it animates in — and a drag anchored while it is still moving lands
      // mid-glyph. The wait is for the column, not for the renderer.
      await page.waitForTimeout(2000)

      const selected = await selectExpectedRows(page, page.locator(PREVIEW_LINE), 1, 1, 'beta')
      expect(selected).toBe('beta')
      await expect(page.locator(ASK_BUTTON).first()).toBeVisible({ timeout: 15_000 })

      const geometry = await page.evaluate(
        ([buttonSelector, columnSelector]: readonly [string, string]) => {
          const button = document.querySelector(buttonSelector)
          const column = document.querySelector(columnSelector)
          if (button === null) return null
          const box = button.getBoundingClientRect()
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          const columnBox = column?.getBoundingClientRect() ?? null
          return {
            hit: top === null ? null : `${top.tagName}.${top.className}`,
            buttonIsTopmost: top === button || button.contains(top),
            columnWidth: columnBox?.width ?? 0,
            columnReachesButton:
              columnBox !== null && box.x + box.width > columnBox.x && box.x < columnBox.right,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }
        },
        [ASK_BUTTON, RIGHT_COLUMN] as const,
      )

      expect(geometry?.viewport).toEqual(viewport)
      expect(geometry?.columnWidth ?? 0).toBeGreaterThan(0)
      expect(geometry?.columnReachesButton, 'the column must really reach the button').toBe(true)
      expect(geometry?.buttonIsTopmost, `elementFromPoint reached ${String(geometry?.hit)}`).toBe(true)

      // A real click at this size, actionability check included.
      await page.locator(ASK_BUTTON).first().click({ timeout: 8000 })
      await page.waitForTimeout(1500)
      expect(await readDraft(page)).toContain('> beta')
    })
  }
})
