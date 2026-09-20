/**
 * The plugin's user-visible copy.
 *
 * Every literal here is written as `\u` escapes rather than raw CJK text. That
 * is not decoration: this project has already observed an editing channel
 * silently altering Chinese literals, and a dropped or duplicated code unit
 * inside a CJK string still reads as plausible Chinese, so a visual diff does
 * not catch it. Escapes put the exact code points in the source where review can
 * see them, and `tests/unit/quote/integrity.spec.ts` asserts the same code
 * points against the exported values.
 *
 * **This is the v1 fallback, not the intended end state.** DSH rc.1 does have a
 * public locale mechanism — a slot registration can declare a dictionary
 * namespace, and the framework then hands the component a typed `t` seat — but
 * installing a dictionary requires the locale plugin's registration path and a
 * declared namespace, neither of which this plugin owns. Resolving the copy
 * locally keeps the plugin free of a locale service it cannot register into;
 * moving to the locale seat later replaces this module's resolver and leaves the
 * escape-anchored literals where they are. Task 12 deliberately did not widen the
 * plugin's `inject` surface to reach one.
 *
 * Six keys are the whole contract, and each has one consumer. `ask` is the Ask
 * button's accessible name. `selectionTooLarge` and `tooManyCells` are the two
 * actionable refusals the feedback slot can publish, one per limit, so neither
 * limit's notice is ever shown for the other's refusal. `rendererFailed` is the
 * generic "this document could not be displayed" state of a byte renderer, used
 * only where the renderer has no diagnosis of its own — a security, integrity,
 * size or missing-bytes failure keeps its specific wording, because collapsing
 * one of those into the generic line would drop the reason the reader needs.
 * `loading` is the generic in-progress state. `noSelectableText` names the
 * image-only case; the production surface for it is deferred rather than invented
 * here, so the key exists, is tested, and is ready for the surface that needs it.
 */

/** The copy keys the Ask UI renders. */
export interface SelectionStrings {
  /** Accessible name of the floating Ask button. */
  readonly ask: string
  /** Shown when a real selection exceeds the documented size limit. */
  readonly selectionTooLarge: string
  /** Shown when a spreadsheet range exceeds the 200-cell limit. */
  readonly tooManyCells: string
  /** Generic state of a renderer that could not display its document. */
  readonly rendererFailed: string
  /** State of a document — an image-only PDF — with no selectable text. */
  readonly noSelectableText: string
  /** Generic state of a renderer that is still preparing its document. */
  readonly loading: string
}

/** Language tags this module resolves. */
export type SelectionLocale = 'zh' | 'en'
/** `询问 DeepSeek` — the Ask button's accessible name. */
const ASK_ZH = '\u8be2\u95ee DeepSeek'

/** `选区过大，请缩小范围` — the selection size-limit notice. */
const SELECTION_TOO_LARGE_ZH =
  '\u9009\u533a\u8fc7\u5927\uff0c\u8bf7\u7f29\u5c0f\u8303\u56f4'

/** `选中的单元格过多，请选择不超过 200 个单元格` — the cell-count notice. */
const TOO_MANY_CELLS_ZH =
  '\u9009\u4e2d\u7684\u5355\u5143\u683c\u8fc7\u591a\uff0c\u8bf7\u9009\u62e9\u4e0d\u8d85\u8fc7 200 \u4e2a\u5355\u5143\u683c'

/** `无法显示文档` — the generic renderer-failure state. */
const RENDERER_FAILED_ZH = '\u65e0\u6cd5\u663e\u793a\u6587\u6863'

/** `当前内容没有可选择文本` — the image-only state. */
const NO_SELECTABLE_TEXT_ZH =
  '\u5f53\u524d\u5185\u5bb9\u6ca1\u6709\u53ef\u9009\u62e9\u6587\u672c'

/** `正在加载文档…` — the generic loading state. */
const LOADING_ZH = '\u6b63\u5728\u52a0\u8f7d\u6587\u6863\u2026'

/** English copy, used when the document language is not Chinese. */
export const EN: SelectionStrings = {
  ask: 'Ask DeepSeek',
  selectionTooLarge: 'The selection is too large. Select a smaller range.',
  tooManyCells: 'Too many cells selected. Select no more than 200 cells.',
  rendererFailed: 'Unable to display the document.',
  noSelectableText: 'This content has no selectable text.',
  loading: 'Loading document…',
}

/** Chinese copy; the product's default. */
export const ZH: SelectionStrings = {
  ask: ASK_ZH,
  selectionTooLarge: SELECTION_TOO_LARGE_ZH,
  tooManyCells: TOO_MANY_CELLS_ZH,
  rendererFailed: RENDERER_FAILED_ZH,
  noSelectableText: NO_SELECTABLE_TEXT_ZH,
  loading: LOADING_ZH,
}

/**
 * Whether a language tag selects the Chinese table.
 *
 * The default direction is deliberate: an unknown or absent language resolves to
 * **Chinese**, not to English. Chinese is this product's default and the copy the
 * contract names, so a host that publishes no language must not silently hand the
 * reader a language they did not choose. Only a tag that positively identifies
 * itself as non-Chinese selects the English table.
 *
 * @param locale - a BCP 47 tag, or `undefined` when the host exposes none.
 * @returns true when the Chinese table is selected.
 */
function isChinese(locale: string | undefined): boolean {
  return locale === undefined || locale.toLowerCase().startsWith('zh')
}

/**
 * Resolve the copy for a language tag.
 *
 * @param locale - a BCP 47 tag, or `undefined` when the host exposes none.
 * @returns the resolved copy.
 */
export function resolveSelectionStrings(locale: string | undefined): SelectionStrings {
  return isChinese(locale) ? ZH : EN
}

/**
 * The copy a document renderer's own status surfaces render.
 *
 * **Why this is a second table and not more keys on {@link SelectionStrings}.**
 * The six keys above are the Ask surface's contract, and Task 12 fixed that
 * contract deliberately at six. A byte renderer's notices are a different
 * surface with a different owner: each renderer decides when it has no bytes,
 * when its engine is unavailable and what to call the retry control. Widening
 * the Ask table would make every Ask consumer answer for copy it never renders;
 * extending it here keeps the six-key contract exactly as reviewed and gives the
 * four renderers one place to resolve their own copy.
 *
 * The table is resolved from the same `<html lang>` the Ask surface reads, so a
 * document opened in an English locale renders its notices in English rather
 * than in the product's default.
 */
export interface RendererStrings extends SelectionStrings {
  /** Label of the retry control a failed renderer offers. */
  readonly retry: string
  /** PDF worker that could not continue. */
  readonly pdfWorkerFailed: string
  /** PDF preview given no file bytes. */
  readonly pdfNeedsBytes: string
  /** DOCX preview given no file bytes. */
  readonly docxNeedsBytes: string
  /** PPTX preview given no file bytes. */
  readonly pptxNeedsBytes: string
  /** XLSX preview given no file bytes. */
  readonly xlsxNeedsBytes: string
  /** Workbook above the supported size limit. */
  readonly xlsxTooLarge: string
  /** Spreadsheet engine with no loadable source on this architecture. */
  readonly xlsxEngineUnavailable: string
  /** Spreadsheet engine whose embedded payload failed its integrity check. */
  readonly xlsxEngineIntegrityFailed: string
  /** Accessible name of the workbook sheet-tab list. */
  readonly sheetTabs: string
}

/** `重试` — the retry control's label. */
const RETRY_ZH = '\u91cd\u8bd5'

/** `PDF 渲染进程无法继续，请重试。` — a PDF worker that stopped. */
const PDF_WORKER_FAILED_ZH =
  'PDF \u6e32\u67d3\u8fdb\u7a0b\u65e0\u6cd5\u7ee7\u7eed\uff0c\u8bf7\u91cd\u8bd5\u3002'

/** `PDF 预览需要完整文件内容。` — a PDF preview with no bytes. */
const PDF_NEEDS_BYTES_ZH = 'PDF \u9884\u89c8\u9700\u8981\u5b8c\u6574\u6587\u4ef6\u5185\u5bb9\u3002'

/** `DOCX 预览需要完整文件内容。` — a DOCX preview with no bytes. */
const DOCX_NEEDS_BYTES_ZH = 'DOCX \u9884\u89c8\u9700\u8981\u5b8c\u6574\u6587\u4ef6\u5185\u5bb9\u3002'

/** `PPTX 预览需要完整文件内容。` — a PPTX preview with no bytes. */
const PPTX_NEEDS_BYTES_ZH = 'PPTX \u9884\u89c8\u9700\u8981\u5b8c\u6574\u6587\u4ef6\u5185\u5bb9\u3002'

/** `XLSX 预览需要完整文件内容。` — an XLSX preview with no bytes. */
const XLSX_NEEDS_BYTES_ZH = 'XLSX \u9884\u89c8\u9700\u8981\u5b8c\u6574\u6587\u4ef6\u5185\u5bb9\u3002'

/** `文件超出支持的大小限制（最大 25 MB）` — workbook over the size limit. */
const XLSX_TOO_LARGE_ZH =
  '\u6587\u4ef6\u8d85\u51fa\u652f\u6301\u7684\u5927\u5c0f\u9650\u5236\uff08\u6700\u5927 25 MB\uff09'

/** `表格解析引擎在当前架构下无法加载，暂不支持显示。` */
const XLSX_ENGINE_UNAVAILABLE_ZH =
  '\u8868\u683c\u89e3\u6790\u5f15\u64ce\u5728\u5f53\u524d\u67b6\u6784\u4e0b\u65e0\u6cd5\u52a0\u8f7d\uff0c\u6682\u4e0d\u652f\u6301\u663e\u793a\u3002'

/** `表格解析引擎完整性校验失败，无法显示。` */
const XLSX_ENGINE_INTEGRITY_ZH =
  '\u8868\u683c\u89e3\u6790\u5f15\u64ce\u5b8c\u6574\u6027\u6821\u9a8c\u5931\u8d25\uff0c\u65e0\u6cd5\u663e\u793a\u3002'

/** `工作表` — the sheet-tab list's accessible name. */
const SHEET_TABS_ZH = '\u5de5\u4f5c\u8868'

/** English renderer copy. */
export const EN_RENDERER: RendererStrings = {
  ...EN,
  retry: 'Retry',
  pdfWorkerFailed: 'The PDF rendering process stopped. Try again.',
  pdfNeedsBytes: 'The PDF preview needs the complete file contents.',
  docxNeedsBytes: 'The DOCX preview needs the complete file contents.',
  pptxNeedsBytes: 'The PPTX preview needs the complete file contents.',
  xlsxNeedsBytes: 'The XLSX preview needs the complete file contents.',
  xlsxTooLarge: 'The file exceeds the supported size limit (25 MB maximum).',
  xlsxEngineUnavailable:
    'The spreadsheet engine cannot load on this architecture, so the workbook cannot be displayed.',
  xlsxEngineIntegrityFailed:
    'The spreadsheet engine failed its integrity check, so the workbook cannot be displayed.',
  sheetTabs: 'Workbook sheets',
}

/** Chinese renderer copy; the product's default. */
export const ZH_RENDERER: RendererStrings = {
  ...ZH,
  retry: RETRY_ZH,
  pdfWorkerFailed: PDF_WORKER_FAILED_ZH,
  pdfNeedsBytes: PDF_NEEDS_BYTES_ZH,
  docxNeedsBytes: DOCX_NEEDS_BYTES_ZH,
  pptxNeedsBytes: PPTX_NEEDS_BYTES_ZH,
  xlsxNeedsBytes: XLSX_NEEDS_BYTES_ZH,
  xlsxTooLarge: XLSX_TOO_LARGE_ZH,
  xlsxEngineUnavailable: XLSX_ENGINE_UNAVAILABLE_ZH,
  xlsxEngineIntegrityFailed: XLSX_ENGINE_INTEGRITY_ZH,
  sheetTabs: SHEET_TABS_ZH,
}

/**
 * Resolve a renderer's copy for a language tag.
 *
 * @param locale - a BCP 47 tag, or `undefined` when the host exposes none.
 * @returns the resolved copy.
 */
export function resolveRendererStrings(locale: string | undefined): RendererStrings {
  return isChinese(locale) ? ZH_RENDERER : EN_RENDERER
}

/**
 * Report the copy for the running document.
 *
 * Read on every call rather than cached, so a component that resolves its copy
 * during render follows a language change on its next render without a second
 * subscription to observe `<html lang>`. No observer is installed for it: this
 * module deliberately has no state and no listeners.
 *
 * @param doc - the document whose language is read, or `undefined` when the
 * plugin is applied in a host without a document.
 * @returns the resolved copy.
 */
export function documentSelectionStrings(doc: Document | undefined): SelectionStrings {
  const lang = doc?.documentElement.lang
  return resolveSelectionStrings(lang === undefined || lang === '' ? undefined : lang)
}

/**
 * Report the renderer copy for the running document.
 *
 * Same contract as {@link documentSelectionStrings}: read on every call rather
 * than cached, so a renderer that resolves its copy during render follows a
 * language change on its next render.
 *
 * @param doc - the document whose language is read, or `undefined` when the
 * plugin is applied in a host without a document.
 * @returns the resolved copy.
 */
export function documentRendererStrings(doc: Document | undefined): RendererStrings {
  const lang = doc?.documentElement.lang
  return resolveRendererStrings(lang === undefined || lang === '' ? undefined : lang)
}
