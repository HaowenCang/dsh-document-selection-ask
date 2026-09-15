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
 * locally keeps Task 5 free of a locale service it cannot yet register into;
 * moving to the locale seat later replaces this module's resolver and leaves the
 * escape-anchored literals where they are.
 */

/** The copy keys the Ask UI renders. */
export interface SelectionStrings {
  /** Accessible name of the floating Ask button. */
  readonly ask: string
  /** Shown when a real selection exceeds the documented size limit. */
  readonly selectionTooLarge: string
}

/** Language tags this module resolves. */
export type SelectionLocale = 'zh' | 'en'
/** `询问 DeepSeek` — the Ask button's accessible name. */
const ASK_ZH = '\u8be2\u95ee DeepSeek'

/** `选区过大，请缩小范围` — the size-limit notice. */
const SELECTION_TOO_LARGE_ZH =
  '\u9009\u533a\u8fc7\u5927\uff0c\u8bf7\u7f29\u5c0f\u8303\u56f4'

/** English copy, used when the document language is not Chinese. */
const EN: SelectionStrings = {
  ask: 'Ask DeepSeek',
  selectionTooLarge: 'The selection is too large. Select a smaller range.',
}

/** Chinese copy; the product's default. */
export const ZH: SelectionStrings = {
  ask: ASK_ZH,
  selectionTooLarge: SELECTION_TOO_LARGE_ZH,
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
 * @param doc - the document whose language is read, or `undefined` when the
 * plugin is applied in a host without a document.
 * @returns the resolved copy.
 */
export function documentSelectionStrings(doc: Document | undefined): SelectionStrings {
  const lang = doc?.documentElement.lang
  return resolveSelectionStrings(lang === undefined || lang === '' ? undefined : lang)
}
