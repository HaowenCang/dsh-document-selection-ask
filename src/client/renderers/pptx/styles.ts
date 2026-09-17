/**
 * The PPTX preview's style sheet.
 *
 * Installed as a runtime `style[data-plugin-css]` element rather than as a
 * `*.module.css` import, because tsdown drops CSS module imports silently.
 *
 * Scoped strictly to plugin-owned `[data-dsa-document-kind="pptx"]` and
 * internal host attributes without resetting or overriding the slide internals.
 */

/** `data-plugin-css` value identifying the PPTX renderer's sheet. */
export const PPTX_STYLE_TAG_ID = 'dsh-document-selection-ask/pptx-renderer.css'

/** The PPTX renderer's style sheet. */
export const PPTX_RENDERER_CSS = `
[data-dsa-document-kind='pptx'] {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: auto;
  padding: 0;
  overflow: auto;
  background-color: #555555;
}

[data-dsa-pptx-content] {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: block;
  padding: 24px 0;
}
`

/**
 * Install the PPTX preview styles into the target document.
 *
 * Idempotent: returns an uninstaller disposer.
 *
 * @param doc - document where the style element is placed.
 * @returns disposer removing the style element.
 */
export function installPptxStyles(doc: Document): () => void {
  const existing = doc.head.querySelector(`style[data-plugin-css="${PPTX_STYLE_TAG_ID}"]`)
  if (existing !== null) {
    return () => {}
  }

  const style = doc.createElement('style')
  style.setAttribute('data-plugin-css', PPTX_STYLE_TAG_ID)
  style.textContent = PPTX_RENDERER_CSS
  doc.head.appendChild(style)

  return () => {
    style.remove()
  }
}
