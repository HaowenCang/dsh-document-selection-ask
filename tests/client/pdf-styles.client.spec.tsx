// @vitest-environment jsdom
/**
 * The PDF renderer's style sheet, and the selectors the text layer depends on.
 *
 * The bundler this project uses drops a `*.module.css` import silently — which
 * Task 5 already paid for once — so this sheet is a runtime `style[data-plugin-css]`
 * element. The property that matters is therefore not "a CSS file exists in the
 * repository" but "the built artifact carries the rules and the document receives
 * them", and only the second half is observable here. The first half is asserted
 * against `lib/client.js` in `tests/unit/pdf-bundle.spec.ts`.
 */

import { describe, expect, it } from 'vitest'

import { PDF_RENDERER_CSS, PDF_STYLE_TAG_ID, installPdfStyles } from '../../src/client/renderers/pdf/styles.js'

describe('PDF renderer style sheet', () => {
  it('carries the text layer rules PDF.js lays its spans out against', () => {
    // Without these three the spans are in flow, at the wrong size and at the
    // wrong position; the selection would be a column of invisible text under the
    // canvas rather than on top of it.
    expect(PDF_RENDERER_CSS).toContain('.textLayer')
    expect(PDF_RENDERER_CSS).toContain('position: absolute')
    expect(PDF_RENDERER_CSS).toContain('--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size))')
    expect(PDF_RENDERER_CSS).toContain('font-size: calc(var(--text-scale-factor) * var(--font-height))')
    expect(PDF_RENDERER_CSS).toContain("color: transparent")
    expect(PDF_RENDERER_CSS).toContain('-webkit-user-select: text')
  })

  it('sizes the page wrapper and the canvas from the one CSS box', () => {
    expect(PDF_RENDERER_CSS).toContain("[data-dsa-pdf-page]")
    expect(PDF_RENDERER_CSS).toContain('[data-dsa-pdf-page] canvas')
  })

  it('installs exactly one tagged style element and removes it on dispose', () => {
    const dispose = installPdfStyles(document)
    const tag = document.querySelector(`style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`)

    expect(tag).not.toBeNull()
    expect(tag?.textContent).toBe(PDF_RENDERER_CSS)

    dispose()
    expect(document.querySelector(`style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`)).toBeNull()
  })

  it('is idempotent: a second install adds no second sheet', () => {
    const first = installPdfStyles(document)
    const second = installPdfStyles(document)

    expect(document.querySelectorAll(`style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`).length).toBe(1)

    // The second caller owns nothing, and disposing it must not remove the sheet
    // the first caller installed.
    second()
    expect(document.querySelector(`style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`)).not.toBeNull()

    first()
    expect(document.querySelector(`style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`)).toBeNull()
  })
})
