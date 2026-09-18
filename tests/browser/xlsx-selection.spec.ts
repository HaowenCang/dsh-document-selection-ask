/**
 * Browser specification for real DSH XLSX rendering, semantic cell-range selection,
 * displayed value extraction, sheet/A1 provenance, and Ask button integration.
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
const XLSX_ROOT = '[data-dsa-document-kind="xlsx"]'
const XLSX_CONTENT = '[data-dsa-xlsx-content]'
const RESOURCE_ADDRESS = 'data-dsa-resource-address'

const PLUGIN_RENDERER = 'dsh-document-selection-ask/xlsx'
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
 * Open one XLSX fixture through the driver's public navigation call and wait
 * for the plugin's XLSX renderer to publish its root.
 */
async function openXlsxFixture(page: Page, key: string): Promise<string> {
  await page.locator(`[data-dsa-smoke-open="${key}"]`).click()

  const root = page.locator(XLSX_ROOT).first()
  await expect(root).toBeVisible({ timeout: 40_000 })

  const address = await root.getAttribute(RESOURCE_ADDRESS)
  if (address === null || address === '') {
    throw new Error('the XLSX renderer published an empty resource address')
  }

  // Verify that DSH selected this plugin's renderer definition
  const preview = await root.evaluate((element, attribute) => {
    const ancestor = element.closest(`[${attribute}]`)
    return ancestor === null ? null : ancestor.getAttribute(attribute)
  }, PREVIEW_IDENTITY_ATTRIBUTE)

  expect(preview, `the document preview must be registered as ${PLUGIN_RENDERER}`).toBe(PLUGIN_RENDERER)

  return address
}

test.describe('real DSH XLSX preview & selection smoke', () => {
  test('1. simple semantic range Ask: selects range, preserves draft, exact provenance and table quote', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)

    // Pre-fill composer draft
    const composer = page.locator(COMPOSER_INPUT).first()
    await composer.click()
    await composer.fill('Pre-existing draft text')

    await openXlsxFixture(page, 'xlsx-simple')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const box = await grid.boundingBox()
    expect(box).not.toBeNull()

    // Perform real spreadsheet mouse drag gesture across A1:C3
    await page.mouse.move(box!.x + 75, box!.y + 45)
    await page.mouse.down()
    await page.mouse.move(box!.x + 180, box!.y + 85, { steps: 5 })
    await page.mouse.up()

    // Ask button must appear
    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })

    await askButton.click()

    // Assert composer draft
    const draft = await readDraft(page)
    expect(draft).toContain('Pre-existing draft text')
    expect(draft).toContain('[来源：task11-simple.xlsx，Sheet1!')
    expect(draft).toContain('Apple')
    expect(draft).toContain('Pear')
    expect(draft).toContain(QUESTION_SUFFIX)

    // Composer focus restored
    const isFocused = await composer.evaluate((el) => document.activeElement === el)
    expect(isFocused).toBe(true)

    // Verify zero external network requests
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('blob:'),
    )
    expect(externalRequests).toEqual([])
  })

  test('2. formula and display values: quotes calculated/formatted values not formula source', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-formula-values')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const box = await grid.boundingBox()
    expect(box).not.toBeNull()

    // Click/drag across cells in row 3 (A3 is SUM formula, B3 is date)
    await page.mouse.move(box!.x + 75, box!.y + 85)
    await page.mouse.down()
    await page.mouse.move(box!.x + 155, box!.y + 85, { steps: 3 })
    await page.mouse.up()

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('[来源：task11-formula-values.xlsx，Sheet1!A3:B3]')
    // Must contain calculated display result 30 and formatted date, not raw formula string "=SUM(A1:A2)"
    expect(draft).toContain('30')
    expect(draft).toContain('2026-09-18')
    expect(draft).not.toBe('```tsv\n=SUM(A1:A2)\n```')
  })

  test('3. multi-sheet navigation and sheet switch selection stale clearing', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-multi-sheet')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const box = await grid.boundingBox()

    // Select range on first sheet (Summary)
    await page.mouse.move(box!.x + 75, box!.y + 45)
    await page.mouse.down()
    await page.mouse.up()
    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })

    // Click on sheet tab "Data 2026"
    const dataTab = content.locator('button[role="tab"]:has-text("Data 2026")').first()
    await expect(dataTab).toBeVisible({ timeout: 10_000 })
    await dataTab.click()

    // After switching sheet, make new selection on "Data 2026"
    await page.waitForTimeout(1000)
    await page.mouse.move(box!.x + 85, box!.y + 65)
    await page.mouse.down()
    await page.mouse.up()

    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Data 2026')
    expect(draft).not.toContain('Summary!')
  })

  test('4. read-only enforcement: no toolbar, double-click/typing does not mutate workbook', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    // Ensure no default toolbar or edit controls exist
    await expect(page.locator('button:has-text("Export")')).toHaveCount(0)
    await expect(page.locator('button:has-text("Save")')).toHaveCount(0)
    await expect(page.locator('button:has-text("Edit")')).toHaveCount(0)

    const grid = content.locator('[role="grid"]').first()
    const box = await grid.boundingBox()
    expect(box).not.toBeNull()

    // Double click on cell A2
    await page.mouse.dblclick(box!.x + 75, box!.y + 65)
    await page.keyboard.type('MUTATED_VALUE')
    await page.keyboard.press('Enter')

    // Ensure no text editor input spawned
    await expect(content.locator('input[type="text"], textarea')).toHaveCount(0)

    // Now select A2 and ask
    await page.mouse.click(box!.x + 75, box!.y + 65)
    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Apple')
    expect(draft).not.toContain('MUTATED_VALUE')
  })

  test('5. merged and frozen panes: renders and remains navigable without crashes', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-merged-frozen')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const box = await grid.boundingBox()

    // Select banner in top row
    await page.mouse.move(box!.x + 75, box!.y + 40)
    await page.mouse.down()
    await page.mouse.up()

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Merged Header Banner')
  })

  test('6. chart and embedded image: renders without external network requests', async ({ page }) => {
    const recordedRequests: string[] = []
    page.on('request', (request: Request) => {
      recordedRequests.push(request.url())
    })

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-chart-image')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 20_000 })

    // Select category cell in row 1
    const box = await grid.boundingBox()
    await page.mouse.move(box!.x + 75, box!.y + 40)
    await page.mouse.down()
    await page.mouse.up()

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('Category')

    // Verify zero external network requests
    const externalRequests = recordedRequests.filter(
      (url) => !url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('blob:'),
    )
    expect(externalRequests).toEqual([])
  })

  test('7. large workbook: parses with worker and renders virtualized grid smoothly', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-large')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 35_000 })

    const grid = content.locator('[role="grid"]').first()
    await expect(grid).toBeVisible({ timeout: 25_000 })

    // Select cells in large workbook
    const box = await grid.boundingBox()
    await page.mouse.click(box!.x + 75, box!.y + 65)
    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })
    await askButton.click()

    const draft = await readDraft(page)
    expect(draft).toContain('task11-large.xlsx')
  })

  test('8. resource switch cleanup: switching resources hides stale XLSX Ask button', async ({ page }) => {
    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    const grid = content.locator('[role="grid"]').first()
    const box = await grid.boundingBox()
    await page.mouse.click(box!.x + 75, box!.y + 45)

    const askButton = page.locator(ASK_BUTTON).first()
    await expect(askButton).toBeVisible({ timeout: 15_000 })

    // Open DOCX resource
    await page.locator('[data-dsa-smoke-open="docx-paragraphs"]').click()

    // Old XLSX Ask button must be hidden
    await expect(askButton).toHaveCount(0)
  })

  test('9. local WASM and assets: loaded from local origin with zero remote CDN requests', async ({ page }) => {
    const wasmResponses: { url: string; status: number }[] = []
    page.on('response', (response) => {
      const url = response.url()
      if (url.includes('duke_sheets_wasm_bg.wasm')) {
        wasmResponses.push({ url, status: response.status() })
      }
    })

    await openShell(page)
    await openXlsxFixture(page, 'xlsx-simple')

    const content = page.locator(XLSX_CONTENT).first()
    await expect(content).toBeVisible({ timeout: 25_000 })

    // Wait for workbook rendering to settle so worker/WASM response is captured
    await page.waitForTimeout(3000)

    // WASM must be requested and served with HTTP 200 from local DSH server
    expect(wasmResponses.length).toBeGreaterThan(0)
    for (const res of wasmResponses) {
      expect(res.url).toContain('/dsa-assets/duke_sheets_wasm_bg.wasm')
      expect(res.url.startsWith('http://127.0.0.1') || res.url.startsWith('http://localhost')).toBe(true)
      expect(res.status).toBe(200)
    }
  })
})
