/**
 * The PDF preview's style sheet.
 *
 * Installed as a runtime `style[data-plugin-css]` element rather than as a
 * `*.module.css` import, for the reason Task 5 recorded and Task 7 re-verified:
 * the bundler this project uses drops a CSS-module import without complaint,
 * which leaves a component reading class names from `undefined` and fails only in
 * a browser. The mechanism here is the one `ui/styles.ts` already uses, and this
 * sheet is installed by the renderer registration so it exists exactly as long as
 * the plugin fiber does.
 *
 * ## What is adapted from PDF.js
 *
 * The `textLayer` rules below are adapted from `pdfjs-dist@6.3.289`'s
 * `web/pdf_viewer.css` and are covered by the attribution in
 * `THIRD_PARTY_NOTICES.md`. They are reproduced rather than imported because the
 * whole sheet also styles the viewer shell, the annotation editor and the
 * sidebar — thousands of rules for features this renderer does not create — and
 * an unscoped copy of it inside a DSH page would restyle the application around
 * the preview.
 *
 * The selectors are PDF.js's own attribute-free class names, because those are
 * the names `TextLayer` appends to the DOM. The alternative — renaming them and
 * re-emitting them from this side — would be a second statement of PDF.js's own
 * contract, which is the thing this project avoids everywhere else. Every other
 * rule targets a `data-dsa-*` attribute this plugin owns.
 *
 * ## The scale variables
 *
 * Two variables are conspicuous by their absence: `--total-scale-factor` and
 * `--scale-round-*` are **values**, not rules, and are written by
 * `text-layer.ts` from the same geometry the canvas was rendered with. A literal
 * here would be a second, silently wrong answer to a question the canvas has
 * already answered.
 */

/** `data-plugin-css` value identifying the PDF renderer's sheet. */
export const PDF_STYLE_TAG_ID = 'dsh-document-selection-ask/pdf-renderer.css'

/** The PDF renderer's style sheet. */
export const PDF_RENDERER_CSS = `
[data-dsa-document-kind='pdf'] {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: auto;
  padding: 8px;
  overflow: auto;
}

[data-dsa-pdf-stack] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

[data-dsa-pdf-page] {
  position: relative;
  flex: none;
  background: #ffffff;
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l3, rgb(0 0 0 / 12%)), 0 2px 8px 0 rgb(0 0 0 / 6%);
}

[data-dsa-pdf-page] canvas {
  display: block;
  width: 100%;
  height: 100%;
}

[data-dsa-pdf-placeholder] {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-secondary, #6b7280);
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

/* --- adapted from pdfjs-dist 6.3.289 web/pdf_viewer.css ------------------- */

.textLayer {
  color-scheme: only light;
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  caret-color: CanvasText;
  z-index: 0;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}

.textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  -webkit-user-select: text;
  user-select: text;
}

.textLayer > :not(.markedContent),
.textLayer .markedContent span:not(.markedContent) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.textLayer .markedContent {
  display: contents;
}

.textLayer span[role='img'] {
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}

.textLayer ::selection {
  background: color-mix(in srgb, AccentColor, transparent 50%);
  color: transparent;
}

.textLayer br::selection {
  background: transparent;
}

/**
 * The end-of-content element PDF.js appends once the layer has rendered. It
 * exists so a drag past the last line anchors inside the layer instead of
 * escaping into the page around it; this renderer keeps the element for that
 * reason and adds no behaviour of its own.
 */
.textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
}
`

/**
 * Install the PDF renderer's style sheet into a document.
 *
 * Idempotent per document, like the overlay's: an existing sheet with the same
 * tag id is left in place, so a second apply — a hot reload, or two plugin
 * instances during a reload window — cannot stack duplicate rules.
 *
 * @param doc - the document to install into.
 * @returns a disposer that removes the sheet, or does nothing when a sheet with
 * this tag was already present.
 */
export function installPdfStyles(doc: Document): () => void {
  const selector = `style[data-plugin-css=${JSON.stringify(PDF_STYLE_TAG_ID)}]`
  if (doc.querySelector(selector) !== null) {
    return () => undefined
  }

  const tag = doc.createElement('style')
  tag.dataset['pluginCss'] = PDF_STYLE_TAG_ID
  tag.textContent = PDF_RENDERER_CSS
  doc.head.appendChild(tag)

  return () => {
    tag.remove()
  }
}
