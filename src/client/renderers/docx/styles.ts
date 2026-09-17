/**
 * The DOCX preview's style sheet.
 *
 * Installed as a runtime `style[data-plugin-css]` element rather than as a
 * `*.module.css` import, because tsdown drops CSS module imports silently.
 *
 * Scoped strictly to plugin-owned `[data-dsa-document-kind="docx"]` and
 * internal host attributes without resetting or overriding docx-preview's
 * document styling.
 */

/** `data-plugin-css` value identifying the DOCX renderer's sheet. */
export const DOCX_STYLE_TAG_ID = 'dsh-document-selection-ask/docx-renderer.css'

/** The DOCX renderer's style sheet. */
export const DOCX_RENDERER_CSS = `
[data-dsa-document-kind='docx'] {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: auto;
  padding: 0;
  overflow: auto;
  background-color: #808080;
}

[data-dsa-docx-content] {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: block;
}

[data-dsa-docx-style-host] {
  display: none;
}

.dsa-docx-engine-wrapper {
  background: #808080;
  padding: 24px;
  padding-bottom: 0px;
  display: flex;
  flex-flow: column;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
}

.dsa-docx-engine-wrapper > section.dsa-docx-engine {
  background: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  margin-bottom: 24px;
  box-sizing: border-box;
}
`

/**
 * Install the DOCX preview styles into the target document.
 *
 * Idempotent: returns an uninstaller disposer.
 *
 * @param doc - document where the style element is placed.
 * @returns disposer removing the style element.
 */
export function installDocxStyles(doc: Document): () => void {
  const existing = doc.head.querySelector(`style[data-plugin-css="${DOCX_STYLE_TAG_ID}"]`)
  if (existing !== null) {
    return () => {}
  }

  const style = doc.createElement('style')
  style.setAttribute('data-plugin-css', DOCX_STYLE_TAG_ID)
  style.textContent = DOCX_RENDERER_CSS
  doc.head.appendChild(style)

  return () => {
    style.remove()
  }
}
