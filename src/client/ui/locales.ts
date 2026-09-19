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
 * Resolve the copy for a language tag.
 *
 * The default direction is deliberate: an unknown or absent language resolves to
 * **Chinese**, not to English. Chinese is this product's default and the copy the
 * contract names, so a host that publishes no language must not silently hand the
 * reader a language they did not choose. Only a tag that positively identifies
 * itself as non-Chinese selects the English table.
 *
 * @param locale - a BCP 47 tag, or `undefined` when the host exposes none.
 * @returns the resolved copy.
 */
export function resolveSelectionStrings(locale: string | undefined): SelectionStrings {
  if (locale === undefined) {
    return ZH
  }

  return locale.toLowerCase().startsWith('zh') ? ZH : EN
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
