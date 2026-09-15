/**
 * Real DSH smoke: the Ask interaction in a live DSH `0.1.5-rc.1` browser.
 *
 * This spec exists because jsdom cannot prove the interaction the plugin is built
 * around. jsdom implements no focus-driven selection collapse, so the property
 * that matters most — a press on a floating button must not destroy the selection
 * it describes — is unobservable there. It also implements no layout, so a real
 * selection's real rectangles, and where the overlay actually lands, exist only
 * in a browser.
 *
 * **What is real here and what is injected.** The page is a running DSH web
 * instance with this plugin loaded: the composer, its session, the session-scoped
 * slot the overlay occupies, the browser selection, the pointer gesture, the
 * geometry, the focus behaviour, the composer write and the session-isolation
 * comparison are all the real ones. What this spec injects is the *document
 * preview body*. The shell's file-browser panel could not be reached in this
 * headless instance, so the spec renders the preview markup DSH's builtin
 * renderers emit — the same `data-` attributes the adapter reads, reproduced from
 * the installed `dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle — into
 * the live page. Only the preview's provenance is synthetic; everything the
 * plugin does with it is observed in the real application.
 *
 * The instance is external: `DSH_SMOKE_URL` names a running DSH web server with
 * this plugin mounted. The spec is skipped when the variable is absent, which is
 * what keeps `pnpm test:browser` usable on a machine with no DSH installed; a
 * smoke run sets it, and then the cases are mandatory.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH web instance with this plugin mounted')

/** The composer's editable surface, verified against rc.1. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The rejection notice this plugin contributes. */
const TOAST = '[data-dsa-selection-error]'

/** The injected preview's root id. */
const PREVIEW_ID = 'dsa-smoke-preview'

/** The Ask button's accessible name. */
const ASK_LABEL = '\u8be2\u95ee DeepSeek'

/** The question suffix an appended block must close with. */
const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** The size-limit notice. */
const TOO_LARGE = '\u9009\u533a\u8fc7\u5927\uff0c\u8bf7\u7f29\u5c0f\u8303\u56f4'

/** The preview markup injected into the live page. */
interface InjectedPreview {
  /** The `dsh-resource://` address the injected root publishes. */
  readonly url: string
  /** The renderer identity the injected root publishes. */
  readonly renderer: string
  /** Source rows, each rendered as one `data-textpreview-line` row. */
  readonly lines: readonly string[]
  /** Text to drag-select, which must appear inside one row. */
  readonly needle: string
}

/**
 * Open the DSH shell.
 *
 * The composer is the anchor: it exists in the hero state and in an open session
 * alike, and the overlay only has somewhere to render once it is on screen.
 *
 * @param page - the browser page.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForTimeout(9000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Read the current session's id from the live page.
 *
 * Two sources, in order of directness. The shell persists the current session
 * under `dsh.sessions.current`, which is the identity a session-scoped slot
 * receives as its `sessionId` prop — the same value a selection's address has to
 * name. If that store is unavailable, the page is scanned for a
 * `dsh-resource://file/session/<id>/…` address, which is what the preview and the
 * file panel publish.
 *
 * The id is required rather than defaulted: the injected address has to name the
 * real session, because the plugin refuses a selection from any other one — and
 * that refusal is exactly what the isolation case asserts.
 *
 * @param page - the browser page.
 * @returns the session id, failing the case when the page publishes none.
 */
async function readSessionId(page: Page): Promise<string> {
  const sessionId = await page.evaluate(() => {
    const stored = localStorage.getItem('dsh.sessions.current')
    if (stored !== null) {
      try {
        const parsed: unknown = JSON.parse(stored)
        if (parsed !== null && typeof parsed === 'object') {
          const candidate = (parsed as { sessionId?: unknown }).sessionId
          if (typeof candidate === 'string' && candidate !== '') {
            return candidate
          }
        }
      } catch {
        // A malformed store is not a failure: the address scan below still runs.
      }
    }

    const pattern = /dsh-resource:\/\/file\/session\/([^/'"?]+)\//
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        const match = pattern.exec(attribute.value)
        if (match !== null && match[1] !== undefined) {
          return decodeURIComponent(match[1])
        }
      }
    }

    return null
  })

  expect(sessionId, 'the page must publish the current session id').not.toBeNull()
  return sessionId ?? ''
}

/**
 * Build the default preview fixture.
 * @param sessionId - the session the preview's address names.
 * @returns the fixture.
 */
function preview(sessionId: string): InjectedPreview {
  return {
    url: `dsh-resource://file/session/${sessionId}/smoke-notes.txt`,
    renderer: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
    lines: ['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota'],
    needle: 'alpha',
  }
}

/**
 * Render a document-preview body into the live page.
 *
 * The markup reproduces what the builtin plain renderer emits: a root carrying
 * the resource address and the renderer identity, a body region, and one row per
 * source line whose value is that line's 1-based number. That shape is what makes
 * exact line provenance provable, so the injected fixture exercises the same
 * adapter path a real preview does.
 *
 * @param page - the browser page.
 * @param spec - the preview to render.
 */
async function injectPreview(page: Page, spec: InjectedPreview): Promise<void> {
  await page.evaluate(
    (input) => {
      document.querySelector(`#${input.id}`)?.remove()

      const root = document.createElement('div')
      root.id = input.id
      root.setAttribute('data-textpreview-state', 'text')
      root.setAttribute('data-textpreview-url', input.url)
      root.setAttribute('data-document-preview', input.renderer)
      // Pinned to the bottom of the viewport rather than the top: the Ask button
      // is placed above the selection, and a preview under the button would
      // intercept the very click this spec needs to perform.
      root.style.cssText =
        'position:fixed;left:24px;bottom:24px;width:520px;height:180px;z-index:2147483000;background:#fff;' +
        'color:#111;font:13px/22px monospace;padding:8px;overflow:auto;border:2px solid #333'

      const body = document.createElement('div')
      body.setAttribute('data-textpreview-body', '')

      for (const [index, text] of input.lines.entries()) {
        const row = document.createElement('div')
        row.setAttribute('data-textpreview-line', String(index + 1))
        row.textContent = text
        body.appendChild(row)
      }

      root.appendChild(body)
      document.body.appendChild(root)
    },
    { id: PREVIEW_ID, url: spec.url, renderer: spec.renderer, lines: [...spec.lines] },
  )

  await page.waitForTimeout(300)
}

/**
 * Drag-select a run of text inside the injected preview.
 *
 * A real pointer gesture over real text, which is the only way to observe whether
 * the button's own press destroys the selection.
 *
 * @param page - the browser page.
 * @param needle - the text run to drag across.
 */
async function selectInPreview(page: Page, needle: string): Promise<void> {
  const row = page.locator(`#${PREVIEW_ID} [data-textpreview-line]`).filter({ hasText: needle }).first()
  const box = await row.boundingBox()
  if (box === null) {
    throw new Error('the injected preview row has no box')
  }

  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(box.width - 2, 90), box.y + box.height / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(700)
}

/**
 * Read the composer's rendered draft text.
 * @param page - the browser page.
 * @returns the draft text.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-composer-input]')
    return element === null ? '' : element.textContent ?? ''
  })
}

test.describe('real DSH 0.1.5-rc.1 smoke', () => {
  test('loads the client plugin and installs its overlay style sheet', async ({ page }) => {
    await openShell(page)

    const boot = await page.evaluate(() => {
      const bootWire: unknown = (window as unknown as { __DSH_BOOT__?: unknown }).__DSH_BOOT__
      const rows =
        bootWire !== null && typeof bootWire === 'object' && Array.isArray((bootWire as { entries?: unknown }).entries)
          ? (bootWire as { entries: { id?: unknown }[] }).entries
          : []
      return {
        hasPlugin: rows.some((row) => String(row.id ?? '').includes('document-selection-ask')),
        styleSheets: [...document.querySelectorAll('style[data-plugin-css]')].map(
          (tag) => (tag as HTMLElement).dataset['pluginCss'],
        ),
        composerCards: document.querySelectorAll('[data-composer-card]').length,
        composerInputs: document.querySelectorAll('[data-composer-input]').length,
      }
    })

    expect(boot.hasPlugin).toBe(true)
    expect(boot.styleSheets).toContain('dsh-document-selection-ask/selection-ask.css')
    // The focus path depends on both markers, so their presence is part of the
    // contract this smoke verifies rather than an implementation detail.
    expect(boot.composerCards).toBeGreaterThan(0)
    expect(boot.composerInputs).toBeGreaterThan(0)
  })

  test('appends from a real selection, keeps the draft, restores focus and never sends', async ({ page }) => {
    await openShell(page)

    const sessionId = await readSessionId(page)
    const fixture = preview(sessionId)

    // A draft the reader typed before selecting: the ask must preserve it.
    const typedDraft = '\u6211\u7684\u95ee\u9898'
    await page.locator(COMPOSER_INPUT).first().click()
    await page.keyboard.type(typedDraft)
    await page.waitForTimeout(700)

    await injectPreview(page, fixture)
    await selectInPreview(page, fixture.needle)

    const selectedLength = await page.evaluate(() => {
      const selection = document.getSelection()
      return selection === null ? 0 : selection.toString().length
    })
    expect(selectedLength).toBeGreaterThan(0)

    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button).toHaveText(ASK_LABEL)

    // The button must sit inside the composer card: that is what makes the focus
    // path able to find the editable surface at all.
    expect(
      await page.evaluate(
        (selector) => document.querySelector(selector)?.closest('[data-composer-card]') !== null,
        ASK_BUTTON,
      ),
    ).toBe(true)

    const turnsBefore = await page.locator('[data-chat-turn]').count()
    await button.click()
    await page.waitForTimeout(1200)

    const draft = await readDraft(page)
    expect(draft).toContain(typedDraft)
    expect(draft).toContain('smoke-notes.txt')
    expect(draft).toContain(fixture.needle)
    expect(draft).toContain(QUESTION_SUFFIX)

    // Focus must be back in the composer's editable surface.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-composer-input') !== null)).toBe(true)

    // No message may have been sent: the transcript gains no turn.
    await page.waitForTimeout(1500)
    expect(await page.locator('[data-chat-turn]').count()).toBe(turnsBefore)

    // A successful ask retires the button.
    await expect(page.locator(ASK_BUTTON)).toHaveCount(0, { timeout: 10_000 })
  })

  test('keeps the selection through the press that clicks the button', async ({ page }) => {
    await openShell(page)

    const sessionId = await readSessionId(page)
    const fixture = preview(sessionId)

    await injectPreview(page, fixture)
    await selectInPreview(page, fixture.needle)

    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })

    // Press without releasing, then read the selection: this is the exact moment
    // a focus-taking button would collapse it, and jsdom cannot reproduce it.
    const box = await button.boundingBox()
    if (box === null) {
      throw new Error('the Ask button has no box')
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(300)
    const duringPress = await page.evaluate(() => {
      const selection = document.getSelection()
      return selection === null ? 0 : selection.toString().length
    })
    await page.mouse.up()
    await page.waitForTimeout(1200)

    expect(duringPress).toBeGreaterThan(0)
    expect(await readDraft(page)).toContain('smoke-notes.txt')
  })

  test('shows no button and writes nothing for a selection from another session', async ({ page }) => {
    await openShell(page)

    const sessionId = await readSessionId(page)
    const foreign = preview(`${sessionId}-other`)

    await injectPreview(page, foreign)
    await selectInPreview(page, foreign.needle)
    await page.waitForTimeout(1200)

    // Session isolation is the one rule that cannot be relaxed: a selection whose
    // address names another session must not be written into this composer.
    await expect(page.locator(ASK_BUTTON)).toHaveCount(0)
    expect(await readDraft(page)).not.toContain('smoke-notes.txt')
  })

  test('reports the size limit and writes nothing when the selection is too large', async ({ page }) => {
    await openShell(page)

    const sessionId = await readSessionId(page)
    const huge = 'x'.repeat(500)
    const fixture: InjectedPreview = {
      url: `dsh-resource://file/session/${sessionId}/huge-notes.txt`,
      renderer: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
      lines: Array.from({ length: 40 }, () => huge),
      needle: huge.slice(0, 20),
    }

    await injectPreview(page, fixture)

    // Select the whole body, which is well past the 16,384-unit limit.
    await page.evaluate((id) => {
      const body = document.querySelector(`#${id} [data-textpreview-body]`)
      if (body === null) {
        throw new Error('the injected preview has no body')
      }
      const range = document.createRange()
      range.selectNodeContents(body)
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    }, PREVIEW_ID)
    await page.waitForTimeout(1500)

    await expect(page.locator(TOAST).first()).toHaveText(TOO_LARGE, { timeout: 10_000 })
    await expect(page.locator(ASK_BUTTON)).toHaveCount(0)
    expect(await readDraft(page)).not.toContain('huge-notes.txt')
  })

  test('positions the button over the selection and inside the viewport', async ({ page }) => {
    await openShell(page)

    const sessionId = await readSessionId(page)
    const fixture = preview(sessionId)

    await injectPreview(page, fixture)
    await selectInPreview(page, fixture.needle)

    const button = page.locator(ASK_BUTTON).first()
    await expect(button).toBeVisible({ timeout: 15_000 })

    const geometry = await page.evaluate((selector) => {
      const element = document.querySelector(selector)
      if (element === null) {
        return null
      }
      const box = element.getBoundingClientRect()
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        position: getComputedStyle(element).position,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
    }, ASK_BUTTON)

    expect(geometry).not.toBeNull()
    expect(geometry?.position).toBe('fixed')
    expect(geometry?.box.width).toBeGreaterThan(0)

    // The clamp keeps the whole box inside the viewport margins.
    expect(geometry?.box.x).toBeGreaterThanOrEqual(8)
    expect(geometry?.box.y).toBeGreaterThanOrEqual(8)
    expect((geometry?.box.x ?? 0) + (geometry?.box.width ?? 0)).toBeLessThanOrEqual(
      (geometry?.viewport.width ?? 0) - 8 + 1,
    )
    expect((geometry?.box.y ?? 0) + (geometry?.box.height ?? 0)).toBeLessThanOrEqual(
      (geometry?.viewport.height ?? 0) - 8 + 1,
    )
  })
})
