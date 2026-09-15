/**
 * The overlay's style sheet.
 *
 * DSH bundles its own components' CSS through its internal build pipeline; an
 * external plugin has no equivalent. A `*.module.css` import is therefore not a
 * safe contract to depend on: the bundler this project uses drops the import
 * without complaint, which would leave the components reading class names from
 * an `undefined` object and fail only in the browser. The sheet is written as a
 * string and installed at runtime instead, which is a mechanism this repository
 * can verify in its own build output.
 *
 * **Selector strategy.** Styling targets this plugin's own `data-*` hooks rather
 * than generated class names. Those attributes are already the contract the
 * client specs assert against, so there is one name per element instead of two,
 * and no dependency on any DSH class — official classes are generated per build
 * and would turn a DSH release into a styling regression here.
 *
 * **Tokens.** Every declaration that needs a colour reads a published `--dsw-*`
 * token with a literal fallback, so the overlay follows light and dark themes
 * and still renders coherently if a token is ever renamed.
 *
 * The sheet is installed once per document, tagged so a hot reload replaces
 * rather than duplicates it, and removed when the plugin fiber unloads.
 */

/** `data-plugin-css` value identifying this plugin's sheet. */
export const STYLE_TAG_ID = 'dsh-document-selection-ask/selection-ask.css'

/**
 * The overlay's style sheet.
 *
 * Selectors name three attributes this plugin owns and its specs assert on:
 * `data-dsa-selection-ask` on the positioning layer, `data-dsa-selection-ask-button`
 * on the button, and `data-dsa-selection-error` on the rejection notice.
 */
export const OVERLAY_CSS = `
[data-dsa-selection-ask] {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}

[data-dsa-selection-ask-button] {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgb(0 0 0 / 12%));
  border-radius: 8px;
  background: var(--dsw-alias-button-floating-fill, #ffffff);
  color: var(--dsw-alias-label-primary, #0f0f0f);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: var(--dsw-elevation-panel, 0 0 0 0.5px rgb(0 0 0 / 20%), 0 3px 8px 0 rgb(0 0 0 / 3%));
}

[data-dsa-selection-ask-button]:hover {
  background: var(--dsw-alias-button-floating-hover, #f1f3f5);
}

[data-dsa-selection-ask-button]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 2px;
}

[data-dsa-selection-error] {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  z-index: 21;
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-toast-bg, #353638);
  color: var(--dsw-alias-label-primary-inverted, #ffffff);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  box-shadow: var(--dsw-elevation-panel, 0 3px 8px 0 rgb(0 0 0 / 3%));
}
`

/**
 * Install the overlay's style sheet into a document.
 *
 * Idempotent per document: an existing sheet with the same tag id is left in
 * place, so a second apply — a hot reload, or two plugin instances during a
 * reload window — cannot stack duplicate rules.
 *
 * @param doc - the document to install into.
 * @returns a disposer that removes the sheet, or does nothing when the sheet was
 * already present and owned by someone else.
 */
export function installOverlayStyles(doc: Document): () => void {
  const selector = `style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`
  if (doc.querySelector(selector) !== null) {
    return () => undefined
  }

  const tag = doc.createElement('style')
  tag.dataset['pluginCss'] = STYLE_TAG_ID
  tag.textContent = OVERLAY_CSS
  doc.head.appendChild(tag)

  return () => {
    tag.remove()
  }
}
