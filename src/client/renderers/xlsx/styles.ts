/**
 * The XLSX spreadsheet preview style sheet.
 *
 * Installed as a runtime `style[data-plugin-css]` element rather than as a
 * `*.module.css` import, because tsdown drops CSS module imports silently.
 *
 * Scoped strictly to plugin-owned `[data-dsa-document-kind="xlsx"]` without
 * overriding the internal spreadsheet canvas or table fidelity.
 */

export const XLSX_STYLE_TAG_ID = 'dsh-document-selection-ask/xlsx-renderer.css'

export const XLSX_RENDERER_CSS = `
[data-dsa-document-kind='xlsx'] {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: auto;
  padding: 0;
  overflow: hidden;
  position: relative;
  background-color: var(--dsw-alias-bg-canvas, #ffffff);
}

[data-dsa-xlsx-content] {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  position: relative;
}

.dsa-xlsx-status {
  padding: 24px 16px;
  color: var(--dsw-alias-label-secondary, #666);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

/*
 * The failure copy is 13 px body text, so it needs a 4.5:1 ratio against the
 * sheet's own canvas rather than the lighter danger accent the design system uses
 * for state dots and borders: #e5484d on white measures 3.9:1 and would leave
 * the one message that explains a failed workbook below the text threshold. The
 * token is kept first so a themed danger colour still wins where it has been
 * darkened for text; the fallback is the value that measures 6.6:1 on white.
 */
.dsa-xlsx-error {
  color: var(--dsw-alias-state-danger-primary, #b42318);
}
`

/**
 * Install the XLSX preview styles into the target document.
 *
 * Idempotent per document.
 *
 * @param doc - document where the style element is placed.
 * @returns disposer removing the style element.
 */
export function installXlsxStyles(doc: Document): () => void {
  const existing = doc.head.querySelector(`style[data-plugin-css="${XLSX_STYLE_TAG_ID}"]`)
  if (existing !== null) {
    return () => {}
  }

  const style = doc.createElement('style')
  style.setAttribute('data-plugin-css', XLSX_STYLE_TAG_ID)
  style.textContent = XLSX_RENDERER_CSS
  doc.head.appendChild(style)

  return () => {
    style.remove()
  }
}
