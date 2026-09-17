/**
 * Browser specification for real DSH DOCX rendering, selection capture,
 * rendered-page provenance, and Ask button integration.
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
const DOCX_ROOT = '[data-dsa-document-kind="docx"]'
const DOCX_CONTENT = '[data-dsa-docx-content]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'
const DOCX_PAGE = '[data-dsa-docx-page]'
const BLOCKED_LINK = '[data-dsa-docx-blocked-link]'

const PLUGIN_RENDERER = 'dsh-document-selection-ask/docx'
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
  await ensureWorkspace(page, CURRENT_WORKSPACE)
}

/**
 * Open one DOCX fixture through the driver's public navigation call and wait
 * for the plugin's DOCX renderer to publish its root.
 */
async function openDocxFixture(page: Page, key: string): Promise<string> {
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  const root = page.locator(DOCX_ROOT).first()
  await expect(root).toBeVisible({ timeout: 30_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  if (address === null || address === '') {
    throw new Error('the DOCX renderer published an empty resource address')
  }

  // Verify that DSH selected this plugin's renderer definition
  const preview = await root.evaluate((element, attribute) => {
    const ancestor = element.closest(`[${attribute}]`)
    return ancestor === null ? null : ancestor.getAttribute(attribute)
  }, PREVIEW_IDENTITY_ATTRIBUTE)

  expect(preview, `the document preview must be registered as ${PLUGIN_RENDERER}`).toBe(PLUGIN_RENDERER)

  return address
}

test.describe('real DSH DOCX preview & selection smoke', () => {
  test('renders paragraphs.docx, selects text, preserves draft, and inserts Ask quote', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)

    // Pre-fill composer draft to assert preservation
    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Pre-existing draft text')

    await openDocxFixture(page, 'docx-paragraphs')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })

    // Verify text content visibility
    await expect(content).toContainText('DOCX Alpha')
    await expect(content).toContainText('DOCX Beta')
    await expect(content).toContainText('DOCX Gamma')
    await expect(content).toContainText('DOCX 中文选段')

    // Create a native DOM Selection over "DOCX Alpha"
    await page.evaluate(() => {
      const contentEl = document.querySelector('[data-dsa-docx-content]')!
      const p = contentEl.querySelector('p')!
      const range = document.createRange()
      range.selectNodeContents(p)
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

    // Assert composer draft contains both pre-existing text and the provenance quote block
    const draft = await readDraft(page)
    expect(draft).toContain('Pre-existing draft text')
    expect(draft).toContain('DOCX Alpha')
    expect(draft).toContain('[来源：task9-paragraphs.docx')
    expect(draft).toContain(QUESTION_SUFFIX)

    // Composer must have focus restored
    const isFocused = await composer.evaluate((el) => document.activeElement === el)
    expect(isFocused).toBe(true)

    // Verify no external remote requests occurred
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost'),
    )
    expect(externalRequests).toEqual([])
  })

  test('renders manual-page-break.docx with 2 pages and creates cross-page rendered provenance', async ({ page }) => {
    await openShell(page)

    await openDocxFixture(page, 'docx-break')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })

    // Verify two pages with 1-based page markers
    const pages = page.locator(DOCX_PAGE)
    await expect(pages).toHaveCount(2)
    await expect(pages.nth(0)).toContainText('DOCX page one Alpha')
    await expect(pages.nth(1)).toContainText('DOCX page two Beta')

    // Select across page 1 and page 2
    await page.evaluate(() => {
      const pageElements = document.querySelectorAll('[data-dsa-docx-page]')
      const p1 = pageElements[0]!.querySelector('p')!
      const p2 = pageElements[1]!.querySelector('p')!

      const getTextNode = (el: Element): Node => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        return walker.nextNode() ?? el
      }

      const t1 = getTextNode(p1)
      const t2 = getTextNode(p2)

      const range = document.createRange()
      range.setStart(t1, 0)
      range.setEnd(t2, t2.textContent?.length ?? 0)

      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task9-manual-page-break.docx，第 1–2 渲染页]')
  })

  test('renders table-image.docx with readable cells, embedded base64 image, and no remote requests', async ({
    page,
  }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)

    await openDocxFixture(page, 'docx-table-image')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })

    // Table cells
    await expect(content).toContainText('Table Cell 1-1')
    await expect(content).toContainText('Table Cell 1-2')
    await expect(content).toContainText('Table Cell 2-1')
    await expect(content).toContainText('Table Cell 2-2')

    // Embedded image
    const img = content.locator('img').first()
    await expect(img).toBeVisible()
    const src = await img.getAttribute('src')
    expect(src).toMatch(/^data:image\/png;base64,/)

    // External network check
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost'),
    )
    expect(externalRequests).toEqual([])
  })

  test('renders headers-footers.docx with header and footer visible', async ({ page }) => {
    await openShell(page)

    await openDocxFixture(page, 'docx-headers-footers')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })

    await expect(content).toContainText('header marker - Task 9 Header')
    await expect(content).toContainText('body marker - Task 9 Body Content')
    await expect(content).toContainText('footer marker - Task 9 Footer')
  })

  test('preserves live DOCX selection across viewport resize', async ({ page }) => {
    await openShell(page)

    await openDocxFixture(page, 'docx-paragraphs')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })

    await page.evaluate(() => {
      const p = document.querySelector('[data-dsa-docx-content] p')!
      const range = document.createRange()
      range.selectNodeContents(p)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })

    // Trigger viewport resize
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.waitForTimeout(500)

    // Selection and Ask button must remain stable
    await expect(askButton).toBeVisible()
  })

  test('hardens external hyperlinks against malicious schemes while preserving selection and Ask', async ({
    page,
  }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)

    // Set test-only execution probe
    await page.evaluate(() => {
      ;(window as unknown as { __dsaDocxXss: number }).__dsaDocxXss = 0
    })

    const initialUrl = page.url()

    await openDocxFixture(page, 'docx-external-links')

    const content = page.locator(DOCX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 15_000 })
    await expect(content).toContainText('DOCX External Link Security')

    // 1. Safe HTTPS link assertions
    const httpsLink = content.locator('a', { hasText: 'Safe HTTPS' }).first()
    await expect(httpsLink).toBeVisible()
    expect(await httpsLink.getAttribute('href')).toBe('https://example.com/path')
    expect(await httpsLink.getAttribute('target')).toBe('_blank')
    const httpsRel = await httpsLink.getAttribute('rel')
    expect(httpsRel).toContain('noopener')
    expect(httpsRel).toContain('noreferrer')
    expect(await httpsLink.getAttribute('referrerpolicy')).toBe('no-referrer')

    // 2. Safe Mail link assertions
    const mailLink = content.locator('a', { hasText: 'Safe Mail' }).first()
    await expect(mailLink).toBeVisible()
    expect(await mailLink.getAttribute('href')).toBe('mailto:test@example.com')
    expect(await mailLink.getAttribute('target')).toBeNull()

    // 3. Internal bookmark link assertions
    const bookmarkLink = content.locator('a', { hasText: 'Internal Bookmark' }).first()
    await expect(bookmarkLink).toBeVisible()
    expect(await bookmarkLink.getAttribute('href')).toBe('#dsa-bookmark')
    expect(await bookmarkLink.getAttribute('target')).toBeNull()

    // 4. Danger JS link: href stripped, blocked marker present, text visible
    const jsLink = content.locator('a', { hasText: 'Danger JS' }).first()
    await expect(jsLink).toBeVisible()
    expect(await jsLink.getAttribute('href')).toBeNull()
    expect(await jsLink.getAttribute('data-dsa-docx-blocked-link')).toBe('')

    // Normal mouse click on the visible text element (without force: true or dispatchEvent)
    await jsLink.click()
    await page.waitForTimeout(500)

    // Probe must still be 0, URL unchanged, shell alive
    const probeVal = await page.evaluate(() => (window as unknown as { __dsaDocxXss: number }).__dsaDocxXss)
    expect(probeVal).toBe(0)
    expect(page.url()).toBe(initialUrl)
    await expect(page.locator(COMPOSER_INPUT).first()).toBeVisible()

    // 5. Danger Data link: href stripped, click does not navigate
    const dataLink = content.locator('a', { hasText: 'Danger Data' }).first()
    await expect(dataLink).toBeVisible()
    expect(await dataLink.getAttribute('href')).toBeNull()
    expect(await dataLink.getAttribute('data-dsa-docx-blocked-link')).toBe('')

    await dataLink.click()
    await page.waitForTimeout(500)
    expect(page.url()).toBe(initialUrl)

    // 6. Danger File link: href stripped
    const fileLink = content.locator('a', { hasText: 'Danger File' }).first()
    await expect(fileLink).toBeVisible()
    expect(await fileLink.getAttribute('href')).toBeNull()
    expect(await fileLink.getAttribute('data-dsa-docx-blocked-link')).toBe('')

    // 7. Danger Custom link: href stripped
    const customLink = content.locator('a', { hasText: 'Danger Custom' }).first()
    await expect(customLink).toBeVisible()
    expect(await customLink.getAttribute('href')).toBeNull()
    expect(await customLink.getAttribute('data-dsa-docx-blocked-link')).toBe('')

    // 8. Selection and Ask button test over blocked link text "Danger JS"
    await page.evaluate(() => {
      const allAnchors = Array.from(document.querySelectorAll('[data-dsa-docx-content] a'))
      const jsAnchor = allAnchors.find((a) => a.textContent?.includes('Danger JS'))!
      const range = document.createRange()
      range.selectNodeContents(jsAnchor)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 10_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Danger JS')
    expect(draft).toContain('[来源：task9-external-links.docx')

    // 9. Rendering network gate: zero external network requests
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost'),
    )
    expect(externalRequests).toEqual([])
  })
})
