/**
 * Format-independent selection model.
 *
 * Every supported format — plain text, Markdown, code, CSV, PDF, DOCX, PPTX,
 * XLSX — describes its selection with these four types and nothing else. The
 * snapshot is deliberately renderer-blind: it carries copied primitives, not a
 * live `Range`, a controller, or a mounted component, so the Ask flow can be
 * reasoned about, tested, and stored without a browser.
 *
 * Two consequences are load-bearing rather than incidental.
 *
 * The snapshot is *copied*, because a click on the Ask overlay collapses the
 * browser selection that produced it. Anything read lazily at click time would
 * already be gone.
 *
 * The snapshot is *format-independent*, because the composer bridge, the
 * overlay, and the prompt formatter are shared by all eight formats. A field
 * that only one format can populate — a page number, a slide index, a cell
 * count, an XLSX sheet name — belongs inside `SelectionLocation`, where only the
 * variants that can honour it declare it. A format that needs more than that
 * keeps the detail in its own adapter and converts it here.
 */

/** Document classes this plugin can select text from. */
export type DocumentKind =
  | 'text'
  | 'markdown'
  | 'code'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'

/**
 * Where a selection sits inside its document, in the terms its format actually
 * has. Ranges are inclusive at both ends and one-based, matching the numbering
 * a reader sees in a page or line gutter.
 *
 * `pages` carries a `fidelity` discriminant because the two page numbers are not
 * the same claim. `source` means the renderer exposed real document pagination;
 * `rendered` means the range counts pages this browser produced, which is a
 * weaker statement and is worded differently in the provenance line.
 */
export type SelectionLocation =
  | {
      readonly kind: 'lines'
      readonly start: number
      readonly end: number
    }
  | {
      readonly kind: 'pages'
      readonly start: number
      readonly end: number
      readonly fidelity: 'source' | 'rendered'
    }
  | {
      readonly kind: 'slides'
      readonly start: number
      readonly end: number
    }
  | {
      readonly kind: 'cells'
      readonly sheet: string
      readonly range: string
    }
  | {
      readonly kind: 'document'
    }

/**
 * One captured selection, complete enough to build a prompt without the
 * document still being open.
 */
export interface SelectionSnapshot {
  /** Identifier of the adapter that captured the selection. */
  readonly adapterId: string
  /** Address of the previewed resource, for diagnostics rather than provenance. */
  readonly resourceAddress: string
  /** Display name of the file, as the provenance line quotes it. */
  readonly fileName: string
  /** Document class, used to interpret {@link SelectionLocation}. */
  readonly documentKind: DocumentKind
  /** Normalized selection text; empty text is rejected by the quote formatter. */
  readonly text: string
  /** Format-appropriate position of the selection inside the document. */
  readonly location: SelectionLocation
  /**
   * Viewport rectangles of the selection, used to anchor the Ask overlay.
   * Empty or zero-sized rectangles are legal: the XLSX viewer may expose no
   * selection geometry, and the overlay then falls back to a fixed corner.
   */
  readonly rects: readonly DOMRectReadOnly[]
  /** Capture time as `Date.now()` milliseconds, used to invalidate stale snapshots. */
  readonly capturedAt: number
}

/**
 * Why a candidate selection produced no Ask action. The DOM adapters report
 * these instead of throwing, because most of them describe a user gesture that
 * simply was not a selection — clicking in a paragraph, dragging across an
 * input, releasing over the assistant transcript — and those stay silent.
 * Only the size limits are surfaced to the user, since reaching them means a
 * real selection that this plugin declines to send.
 */
export type SelectionRejectReason =
  | 'collapsed'
  | 'outside-supported-preview'
  | 'cross-root'
  | 'interactive-control'
  | 'empty-after-normalization'
  | 'too-large'
  | 'too-many-cells'
  | 'renderer-not-ready'
