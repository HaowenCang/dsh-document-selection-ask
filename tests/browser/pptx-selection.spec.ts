/**
 * Browser specification for real DSH PPTX rendering, selection capture,
 * slide provenance, windowed rendering, and Ask button integration.
 *
 * Drives a real DSH web instance running with the dsa-smoke profile.
 */

import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'

import { ensureWorkspace } from './helpers/shell.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CURRENT_WORKSPACE = basename(repoRoot)

/** The running DSH instance this smoke drives. */
const BASE_URL = process.env['DSH_SMOKE_URL'] ?? ''

test.skip(BASE_URL === '', 'set DSH_SMOKE_URL to a running DSH instance booted from the dsa-smoke profile')

/** The smoke driver's control strip. */
const DRIVER = '[data-dsa-smoke-driver]'

/** The composer's editable surface. */
const COMPOSER_INPUT = '[data-composer-input]'

/** The Ask button this plugin contributes. */
const ASK_BUTTON = '[data-dsa-selection-ask-button]'

/** The renderer root and the contract attributes it publishes. */
const PPTX_ROOT = '[data-dsa-document-kind="pptx"]'
const PPTX_CONTENT = '[data-dsa-pptx-content]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'
const PPTX_SLIDE = '[data-dsa-pptx-slide]'

const PLUGIN_RENDERER = 'dsh-document-selection-ask/pptx'
const PREVIEW_IDENTITY_ATTRIBUTE = 'data-document-preview'

const QUESTION_SUFFIX = '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/**
 * Read the composer's rendered draft text.
 */
async function readDraft(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-composer-input]')
    return element === null ? '' : element.textContent ?? ''
  })
}

/**
 * Open the DSH shell and ensure workspace is ready.
 */
async function openShell(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForTimeout(12_000)
  await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(DRIVER).first()).toBeVisible({ timeout: 30_000 })
  await ensureWorkspace(page)
}

/**
 * Open one PPTX fixture through the driver's public navigation call and wait
 * for the plugin's PPTX renderer to publish its root.
 */
async function openPptxFixture(page: Page, key: string): Promise<string> {
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  const root = page.locator(PPTX_ROOT).first()
  await expect(root).toBeVisible({ timeout: 30_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  if (address === null || address === '') {
    throw new Error('the PPTX renderer published an empty resource address')
  }

  // Verify that DSH selected this plugin's renderer definition
  const preview = await root.evaluate((element, attribute) => {
    const ancestor = element.closest(`[${attribute}]`)
    return ancestor === null ? null : ancestor.getAttribute(attribute)
  }, PREVIEW_IDENTITY_ATTRIBUTE)

  expect(preview, `the document preview must be registered as ${PLUGIN_RENDERER}`).toBe(PLUGIN_RENDERER)

  return address
}

test.describe('real DSH PPTX preview & selection smoke', () => {
  test('renders text-two-slides.pptx, selects text, preserves draft, and inserts Ask quote', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)

    // Pre-fill composer draft to assert preservation
    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Pre-existing draft text')

    await openPptxFixture(page, 'pptx-text-two-slides')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Verify slide 1 and slide 2 texts
    await expect(content).toContainText('PPTX Slide One Alpha')
    await expect(content).toContainText('PPTX 中文选段一')
    await expect(content).toContainText('PPTX Slide Two Beta')

    // Create a native DOM Selection over "PPTX Slide One Alpha" in slide 1
    await page.evaluate(() => {
      const slide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
      const el = slide1.querySelector('div, span, p, text')!
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    // Ask button must become visible
    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })

    // Click Ask with real mouse click
    await askButton.click()

    // Assert composer draft contains pre-existing text, quoted text, and slide provenance
    const draft = await readDraft(page)
    expect(draft).toContain('Pre-existing draft text')
    expect(draft).toContain('PPTX Slide One Alpha')
    expect(draft).toContain('[来源：task10-text-two-slides.pptx，第 1 张幻灯片]')
    expect(draft).toContain(QUESTION_SUFFIX)

    // Focus restored to composer
    const isFocused = await composer.evaluate((el) => document.activeElement === el)
    expect(isFocused).toBe(true)

    // No external network requests
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('blob:'),
    )
    expect(externalRequests).toEqual([])
  })

  test('creates cross-slide selection spanning slide 1 and slide 2', async ({ page }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-text-two-slides')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Create cross-slide native Selection spanning from slide 1 to slide 2
    await page.evaluate(() => {
      const slide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
      const slide2 = document.querySelector('[data-dsa-pptx-slide="2"]')!
      const el1 = slide1.querySelector('div, span, p, text')!
      const el2 = slide2.querySelector('div, span, p, text')!

      const text1 = el1.firstChild ?? el1
      const text2 = el2.firstChild ?? el2

      const range = document.createRange()
      range.setStart(text1, 0)
      range.setEnd(text2, text2.textContent?.length ?? 0)

      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task10-text-two-slides.pptx，第 1–2 张幻灯片]')
  })

  test('captures Unicode CJK text selection correctly', async ({ page }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-text-two-slides')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    await page.evaluate(() => {
      const slide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
      const allEls = [...slide1.querySelectorAll('*')]
      const cjkEl = allEls.find((el) => (el.textContent ?? '').includes('PPTX 中文选段一'))!

      const range = document.createRange()
      range.selectNodeContents(cjkEl)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('PPTX 中文选段一')
    expect(draft).toContain('[来源：task10-text-two-slides.pptx，第 1 张幻灯片]')
  })

  test('renders table-image.pptx with table cells and embedded PNG image', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)
    await openPptxFixture(page, 'pptx-table-image')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Verify table text visible
    await expect(content).toContainText('Header Col 1')
    await expect(content).toContainText('Cell Row 1 Col 1')
    await expect(content).toContainText('Embedded Image Caption')

    // Verify embedded image is rendered and visible
    const img = content.locator('img').first()
    await expect(img).toBeVisible({ timeout: 10_000 })

    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('blob:'),
    )
    expect(externalRequests).toEqual([])
  })

  test('renders chart.pptx with chart canvas and ordinary selectable label', async ({ page }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-chart')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Title and label visible
    await expect(content).toContainText('Quarterly Revenue Chart')
    await expect(content).toContainText('Selectable Chart Overview Text')

    // Verify chart rendering output exists (canvas or svg with positive bounds)
    const chartRenderOutput = content.locator('canvas, svg').first()
    await expect(chartRenderOutput).toBeVisible({ timeout: 15_000 })
  })

  test('large-120-slides.pptx enforces windowed rendering and cleans stale selection on scroll', async ({
    page,
  }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-large-120-slides')

    const root = page.locator(PPTX_ROOT).first()
    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Wait for initial render to settle
    await page.waitForTimeout(2000)

    // Verify initial mounted marked slide count is bounded (< 20)
    const initialSlideCount = await page.locator(PPTX_SLIDE).count()
    expect(initialSlideCount).toBeGreaterThanOrEqual(1)
    expect(initialSlideCount).toBeLessThan(20)

    // Select text on slide 1
    await page.evaluate(() => {
      const slide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
      const el = slide1.querySelector('div, span, p, text')!
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })

    // Scroll far down to the end of the presentation
    await page.evaluate(() => {
      const root = document.querySelector('[data-dsa-document-kind="pptx"]')!
      const scrollHost = (root.closest('[data-textpreview-body]') as HTMLElement | null) ?? root
      scrollHost.scrollTop = scrollHost.scrollHeight
    })

    // Wait for windowing to virtualize: slide 1 must be unmounted
    await expect
      .poll(async () => page.locator('[data-dsa-pptx-slide="1"]').count(), { timeout: 15_000 })
      .toBe(0)

    // Stale selection hard gate: when selected slide 1 unmounts, Ask must be hidden
    await expect(askButton).toHaveCount(0, { timeout: 5_000 })

    // Slide 120 should eventually mount
    await expect(page.locator('[data-dsa-pptx-slide="120"]').first()).toBeVisible({ timeout: 15_000 })

    // Mounted marked slides after scroll must still be bounded (< 20)
    const postScrollSlideCount = await page.locator(PPTX_SLIDE).count()
    expect(postScrollSlideCount).toBeLessThan(20)
  })

  test('revalidates live selection across viewport resize and invalidates disconnected nodes', async ({
    page,
  }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-text-two-slides')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Select text in slide 1 and retain old node references to assert generation replacement
    const { oldText } = await page.evaluate(() => {
      const slide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
      const el = slide1.querySelector('div, span, p, text')!
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))

      ;(window as unknown as { __oldSlide: Element; __oldAnchor: Node | null }).__oldSlide = slide1
      ;(window as unknown as { __oldSlide: Element; __oldAnchor: Node | null }).__oldAnchor = sel.anchorNode
      return { oldText: sel.toString() }
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })

    // Resize viewport by 200px to exceed threshold and trigger real rebuild
    const currentSize = page.viewportSize() ?? { width: 1280, height: 720 }
    await page.setViewportSize({ width: currentSize.width - 200, height: currentSize.height })

    // Observable generation condition: old slide node must be disconnected from document
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const oldSlide = (window as unknown as { __oldSlide?: Element }).__oldSlide
            return oldSlide ? oldSlide.isConnected : false
          }),
        { timeout: 15_000 },
      )
      .toBe(false)

    // New slide 1 of the new generation must be mounted
    await expect(page.locator('[data-dsa-pptx-slide="1"]').first()).toBeVisible({ timeout: 15_000 })

    // Inspect browser selection after rebuild
    const selectionState = await page.evaluate(() => {
      const emptyResult = (status: string) => ({
        status,
        text: '',
        anchorInRoot: false,
        focusInRoot: false,
        hasAnchorSlide: false,
        hasFocusSlide: false,
        isOldAnchor: false,
      })

      const sel = window.getSelection()
      if (!sel) return emptyResult('none')
      if (sel.isCollapsed) return emptyResult('collapsed')
      const text = sel.toString().trim()
      if (text === '') return emptyResult('empty')

      const anchor = sel.anchorNode
      const focus = sel.focusNode
      if (!anchor || !focus || !anchor.isConnected || !focus.isConnected) {
        return emptyResult('disconnected')
      }

      const root = document.querySelector('[data-dsa-document-kind="pptx"]')
      if (!root) return emptyResult('no-root')

      const anchorInRoot = root.contains(anchor)
      const focusInRoot = root.contains(focus)

      const anchorSlide = anchor.parentElement?.closest('[data-dsa-pptx-slide]')
      const focusSlide = focus.parentElement?.closest('[data-dsa-pptx-slide]')

      const oldAnchor = (window as unknown as { __oldAnchor?: Node | null }).__oldAnchor
      const isOldAnchor = anchor === oldAnchor

      return {
        status: 'alive',
        text: sel.toString(),
        anchorInRoot,
        focusInRoot,
        hasAnchorSlide: anchorSlide !== null,
        hasFocusSlide: focusSlide !== null,
        isOldAnchor,
      }
    })

    // Strict contract: if collapsed/empty/disconnected, Ask must be hard hidden
    if (selectionState.status !== 'alive') {
      await expect(askButton).toHaveCount(0, { timeout: 5_000 })

      // Establish new selection on current generation to prove Ask works for current generation
      await page.evaluate(() => {
        const newSlide1 = document.querySelector('[data-dsa-pptx-slide="1"]')!
        const el = newSlide1.querySelector('div, span, p, text')!
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })

      await expect(askButton).toBeVisible({ timeout: 10_000 })
      const currentSelectionText = await page.evaluate(() => window.getSelection()?.toString() ?? '')
      expect(currentSelectionText.trim().length).toBeGreaterThan(0)
      await askButton.click()

      const draft = await readDraft(page)
      expect(draft).toContain(currentSelectionText.trim())
    } else {
      // If browser preserved a live range across replaceChildren:
      expect(selectionState.isOldAnchor).toBe(false)
      expect(selectionState.anchorInRoot).toBe(true)
      expect(selectionState.focusInRoot).toBe(true)
      expect(selectionState.hasAnchorSlide).toBe(true)
      expect(selectionState.hasFocusSlide).toBe(true)

      await expect(askButton).toBeVisible({ timeout: 5_000 })
      await askButton.click()

      const draft = await readDraft(page)
      expect(draft).toContain(selectionState.text.trim())
    }
  })

  test('fails closed on external-media.pptx and makes zero remote requests', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)
    await page.locator('[data-dsa-smoke-open="pptx-external-media"]').click()

    // Renderer must display failure state. The wording is the locale's generic
    // renderer-failure copy since Task 12: a failure that the renderer cannot
    // diagnose further shows that sentence rather than a per-format one.
    const root = page.locator(PPTX_ROOT).first()
    await expect(root).toBeVisible({ timeout: 30_000 })
    await expect(root).toContainText('无法显示文档', { timeout: 10_000 })

    // Zero external remote network requests
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost'),
    )
    expect(externalRequests).toEqual([])
  })

  test('blocks dangerous javascript hyperlink on external-links.pptx', async ({ page }) => {
    await openShell(page)
    await openPptxFixture(page, 'pptx-external-links')

    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })

    // Initialize attack probe variable
    await page.evaluate(() => {
      ;(window as unknown as { __dsaPptxXss: number }).__dsaPptxXss = 0
    })

    const initialUrl = page.url()

    // Find and click "Danger JS" link normally
    const dangerLink = content.locator('text=Danger JS').first()
    await expect(dangerLink).toBeVisible({ timeout: 10_000 })
    await dangerLink.click()

    await page.waitForTimeout(1000)

    // Probe must remain 0, URL unchanged, shell alive
    const probeValue = await page.evaluate(
      () => (window as unknown as { __dsaPptxXss: number }).__dsaPptxXss,
    )
    expect(probeValue).toBe(0)
    expect(page.url()).toBe(initialUrl)
  })

  test('rapidly switches presentation during initial render without uncaught errors or DOM leakage', async ({
    page,
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => {
      pageErrors.push(err.message)
    })

    await page.setViewportSize({ width: 1600, height: 1000 })
    await openShell(page)

    // Set up unhandledrejection listener in page
    await page.evaluate(() => {
      ;(window as unknown as { __testUnhandledRejections: string[] }).__testUnhandledRejections = []
      window.addEventListener('unhandledrejection', (e) => {
        ;(window as unknown as { __testUnhandledRejections: string[] }).__testUnhandledRejections.push(
          String(e.reason),
        )
      })
    })

    // Step 1: Open large 120-slides deck
    await page.locator('[data-dsa-smoke-open="pptx-large-120-slides"]').click()

    // Step 2: Observe that renderer root has appeared and is in initial loading state
    const root = page.locator(PPTX_ROOT).first()
    await expect(root).toBeVisible({ timeout: 15_000 })
    await expect(root).toContainText('正在加载文档…', { timeout: 10_000 })

    // Step 3: Immediately switch preview to text-two-slides while 120-slide render is pending
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-dsa-smoke-open="pptx-text-two-slides"]')?.click()
    })

    // Step 4: Wait for observable outcome: new presentation renders successfully
    const content = page.locator(PPTX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 20_000 })
    await expect(content).toContainText('PPTX Slide One Alpha', { timeout: 20_000 })

    // Step 5: Assertions:
    // a. Zero uncaught page errors and zero unhandled rejections
    const unhandledRejections = await page.evaluate(
      () => (window as unknown as { __testUnhandledRejections: string[] }).__testUnhandledRejections,
    )
    expect(pageErrors).toEqual([])
    expect(unhandledRejections).toEqual([])

    // b. No late DOM from 120-slide deck republished
    const slide120Count = await page.locator('[data-dsa-pptx-slide="120"]').count()
    expect(slide120Count).toBe(0)

    // c. Total slides in content must match the 2-slide deck (no leaked slides from previous deck)
    const mountedSlides = await page.locator(PPTX_SLIDE).count()
    expect(mountedSlides).toBeLessThanOrEqual(2)

    // d. No stale Ask snapshot remains
    await expect(page.locator(ASK_BUTTON)).toHaveCount(0)

    // e. Shell remains fully usable (composer accepts input)
    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Shell is responsive after rapid abort')
    const draft = await readDraft(page)
    expect(draft).toContain('Shell is responsive after rapid abort')
  })
})
