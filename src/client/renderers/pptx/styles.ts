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

[data-dsa-pptx-status] {
  margin: 24px;
  padding: 24px 16px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #0f1115);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

/*
 * The failure state is distinguished by the attribute above, not by a second
 * colour. Task 15U measured why: --dsw-alias-state-danger-primary resolves to
 * nothing in rc.2, so a literal danger red is what actually paints — and a red
 * dark enough for the light theme's white card measures 2.4:1 on the dark theme's
 * bg-layer-1 card. The label token follows both themes (measured 17.5:1 on the
 * light card and 13.3:1 on the dark one), and the copy itself names the failure.
 */
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
