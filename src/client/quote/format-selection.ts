/**
 * Draft quote formatting.
 *
 * This module turns a captured snapshot into the block that is appended to the
 * conversation draft, and it is the last pure step before the composer bridge.
 * It returns a string; it does not touch the composer, does not focus anything,
 * and never submits. That separation is what makes the ask flow testable without
 * a browser, and it keeps the one rule the product cannot break — the user's
 * existing draft is preserved — checkable by assertion rather than by review.
 *
 * The block has three parts: the provenance line, the selected text as a
 * blockquote, and the question suffix. Appending never rewrites what is already
 * there, so each selection keeps its own provenance and its own question line and
 * the newest block is last.
 *
 * The suffix is written as `\u` escapes rather than raw CJK text, so its exact
 * code points are visible in review and cannot be altered by an editor that
 * rewrites the file. The expected strings in
 * `tests/unit/quote/format-selection.spec.ts` and
 * `tests/unit/quote/integrity.spec.ts` are built from the same code points.
 */

import { formatProvenance } from '../provenance/format.js'
import type { SelectionSnapshot } from '../selection/types.js'

/**
 * `请针对以上选中内容回答：` — appended so the user only has to type their
 * question. Never sent automatically.
 */
export const SELECTION_QUESTION_SUFFIX =
  '\u8bf7\u9488\u5bf9\u4ee5\u4e0a\u9009\u4e2d\u5185\u5bb9\u56de\u7b54\uff1a'

/** One blank line: the only separator this formatter inserts between blocks. */
const BLOCK_SEPARATOR = '\n\n'

/** Marker that opens a quoted line. Empty selected lines carry the marker alone. */
const QUOTE_PREFIX = '> '

/**
 * Prefix every line of the selected text with the blockquote marker.
 *
 * Lines are copied verbatim otherwise, including their own `>` and ``` markers:
 * the prefix is what establishes the source block, so nested quoting and fenced
 * code inside the selection stay readable and are not rewritten into a second
 * layer of generated Markdown.
 *
 * @param text - normalized selection text.
 * @returns the blockquoted text, one prefixed line per input line.
 */
function blockquote(text: string): string {
  const prefixed: string[] = []
  for (const line of text.split('\n')) {
    prefixed.push(line === '' ? '>' : QUOTE_PREFIX + line)
  }
  return prefixed.join('\n')
}

/**
 * Render one selection as a quotable block: provenance, content, question.
 *
 * The provenance line opens the blockquote rather than sitting on a line of its
 * own, so the whole block quotes as one unit.
 *
 * @param snapshot - the captured selection, whose text must already be normalized.
 * @returns the block to append to a draft.
 * @throws RangeError when the selection text is empty, which would otherwise
 * produce a provenance line with nothing to ask about.
 */
export function formatSelectionForDraft(snapshot: SelectionSnapshot): string {
  const text = snapshot.text
  if (text.trim() === '') {
    throw new RangeError('Cannot format an empty selection text')
  }

  const source = blockquote(formatProvenance(snapshot))
  const quoted = blockquote(text)
  return source + '\n' + quoted + BLOCK_SEPARATOR + SELECTION_QUESTION_SUFFIX
}

/**
 * Append a selection block to the user's draft without replacing or reordering it.
 *
 * The operation is purely additive, which is what "append" has to mean here. The
 * draft keeps its own text — trailing newlines collapsed to a single blank
 * separator — and the new block follows it, so a second selection produces a
 * second quoted block with its own provenance and its own question line below the
 * first. Nothing is removed: the question suffix ends the appended block, and
 * rewriting the existing draft to move a marker would delete the question line of
 * the selection that produced it.
 *
 * @param existingDraft - the draft as the composer currently holds it.
 * @param snapshot - the captured selection.
 * @returns the complete next draft.
 * @throws RangeError when the selection text is empty.
 */
export function appendSelectionToDraft(existingDraft: string, snapshot: SelectionSnapshot): string {
  const block = formatSelectionForDraft(snapshot)
  const draft = existingDraft.trim()
  if (draft === '') return block

  return `${draft}${BLOCK_SEPARATOR}${block}`
}
