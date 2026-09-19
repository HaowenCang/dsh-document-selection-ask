// @vitest-environment jsdom
/**
 * The copy contract: six keys, two languages, one resolver.
 *
 * Task 12 completes the plugin's user-visible copy and closes the loop between it
 * and the surfaces that render it. Three claims are asserted here, and the
 * division of labour between this file and `tests/unit/quote/integrity.spec.ts`
 * is deliberate: that suite pins the exact **code points** of every Chinese
 * string (the failure mode it exists for is an editing channel silently altering
 * CJK text), while this one asserts **behaviour** — which table a language tag
 * selects, which key each refusal and renderer state renders, and that neither
 * limit's notice is ever shown for the other's refusal.
 *
 * The renderer half is driven through the real `DocxBody` with its engine module
 * replaced by one the case controls, which is what makes the generic loading and
 * generic failure states reachable without a real OOXML document: the question
 * here is which copy a state renders, not how the document is parsed.
 */

import { act, createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentPreviewProps } from '../../src/client/dsh/contracts.js'
import { createSelectionFeedback } from '../../src/client/selection/feedback.js'
import type { SelectionRejectReason } from '../../src/client/selection/types.js'
import { DocxBody } from '../../src/client/renderers/docx/DocxBody.js'
import type { DocxBodyProps } from '../../src/client/renderers/docx/DocxBody.js'
import { SelectionErrorToast } from '../../src/client/ui/SelectionErrorToast.js'
import {
  EN,
  ZH,
  documentSelectionStrings,
  resolveSelectionStrings,
} from '../../src/client/ui/locales.js'
import type { SelectionStrings } from '../../src/client/ui/locales.js'
import { mountTree } from './helpers/react-mount.js'

/**
 * The DOCX engine, replaced by one this spec drives.
 *
 * `vi.hoisted` is what makes it reachable from the module factory below: `vi.mock`
 * calls are hoisted above the imports, so a factory closing over an ordinary
 * module-level binding would capture it before initialisation.
 */
const engine = vi.hoisted(() => ({
  pending: null as null | { readonly reject: (reason: unknown) => void },
}))

vi.mock('../../src/client/renderers/docx/engine.js', () => ({
  renderDocx: () =>
    new Promise((_resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
      engine.pending = { reject }
    }),
}))

/** The six keys the contract names, and no others. */
const REQUIRED_KEYS = [
  'ask',
  'selectionTooLarge',
  'tooManyCells',
  'rendererFailed',
  'noSelectableText',
  'loading',
] as const

/** The exact English copy the contract names. */
const EN_COPY: SelectionStrings = {
  ask: 'Ask DeepSeek',
  selectionTooLarge: 'The selection is too large. Select a smaller range.',
  tooManyCells: 'Too many cells selected. Select no more than 200 cells.',
  rendererFailed: 'Unable to display the document.',
  noSelectableText: 'This content has no selectable text.',
  loading: 'Loading document…',
}

/** Selector for the rejection notice. */
const TOAST = '[data-dsa-selection-error]'

/**
 * The tab lifetime every mounted body receives.
 *
 * One signal for the whole file, because a body's effects are keyed on it: a stub
 * that minted a new signal per call would re-run them on every render, and an
 * abort listener re-registered per render is a different component from the one
 * the product mounts.
 */
const TAB_SIGNAL = new AbortController().signal

/** Every rejection reason a capture can publish, so the silent set is enumerated. */
const ALL_REASONS: readonly SelectionRejectReason[] = [
  'collapsed',
  'outside-supported-preview',
  'cross-root',
  'interactive-control',
  'empty-after-normalization',
  'too-large',
  'too-many-cells',
  'renderer-not-ready',
]

/** The reasons that stay silent: ordinary gestures, not refusals. */
const SILENT_REASONS = ALL_REASONS.filter(
  (reason) => reason !== 'too-large' && reason !== 'too-many-cells',
)

/**
 * Mount the rejection notice for one feedback and one copy table.
 * @param feedback - the feedback to render, or `null`.
 * @param strings - the resolved copy.
 * @returns the mounted tree.
 */
function mountToast(
  feedback: { readonly kind: 'too-large' } | { readonly kind: 'too-many-cells' } | null,
  strings: SelectionStrings,
) {
  return mountTree(createElement(SelectionErrorToast, { feedback, strings }))
}

/**
 * Mount the production DOCX body over a few bytes, with the engine held pending.
 * @returns the mounted tree.
 */
function mountDocx() {
  const props = {
    resourceAddress: 'dsh-resource://file/session/s1/report.docx',
    content: { kind: 'bytes', data: new Uint8Array([1, 2, 3, 4]) },
    wrap: false,
    scrollportRef: () => undefined,
    useTabInfo: () => ({ tab: { signal: TAB_SIGNAL } }),
  } as unknown as DocxBodyProps

  return mountTree(createElement(DocxBody, props))
}

beforeEach(() => {
  document.documentElement.lang = ''
})

describe('the copy tables', () => {
  it('carry exactly the six keys the contract names', () => {
    expect(Object.keys(ZH).sort()).toEqual([...REQUIRED_KEYS].sort())
    expect(Object.keys(EN).sort()).toEqual([...REQUIRED_KEYS].sort())
  })

  it('word every English key as documented', () => {
    expect(EN).toEqual(EN_COPY)
  })

  it('carry a non-empty string for every key in both languages', () => {
    for (const key of REQUIRED_KEYS) {
      expect(ZH[key].length).toBeGreaterThan(0)
      expect(EN[key].length).toBeGreaterThan(0)
    }
  })

  it('keep the two limits worded differently', () => {
    // Two refusals with two limits: a shared sentence would tell the reader of a
    // 201-cell range to shrink a character selection, which is not their problem.
    expect(ZH.tooManyCells).not.toBe(ZH.selectionTooLarge)
    expect(EN.tooManyCells).not.toBe(EN.selectionTooLarge)
    expect(ZH.tooManyCells).not.toBe(EN.tooManyCells)
  })
})

describe('language resolution', () => {
  it.each([
    ['zh', ZH],
    ['zh-CN', ZH],
    ['zh-TW', ZH],
    ['ZH-Hant', ZH],
    ['en', EN],
    ['en-US', EN],
    ['fr', EN],
    ['de-DE', EN],
  ])('resolves %s', (tag, expected) => {
    expect(resolveSelectionStrings(tag)).toBe(expected)
  })

  it('defaults to Chinese for an absent language', () => {
    expect(resolveSelectionStrings(undefined)).toBe(ZH)
  })

  it('reads the language from the running document', () => {
    document.documentElement.lang = 'zh-CN'
    expect(documentSelectionStrings(document)).toBe(ZH)

    document.documentElement.lang = 'zh-TW'
    expect(documentSelectionStrings(document)).toBe(ZH)

    document.documentElement.lang = 'en-US'
    expect(documentSelectionStrings(document)).toBe(EN)
  })

  it('defaults to Chinese for a document with no language at all', () => {
    // An empty attribute is the same statement as a missing one: the host has not
    // chosen a language, so the product's default stands.
    expect(documentSelectionStrings(document)).toBe(ZH)
    expect(documentSelectionStrings(undefined)).toBe(ZH)
  })
})

describe('refusal copy', () => {
  it('renders the size-limit notice in the resolved language', () => {
    const zh = mountToast({ kind: 'too-large' }, ZH)
    expect(zh.container.querySelector(TOAST)?.textContent).toBe(ZH.selectionTooLarge)
    expect(zh.container.querySelector(TOAST)?.getAttribute('data-dsa-selection-error')).toBe('too-large')
    zh.unmount()

    const en = mountToast({ kind: 'too-large' }, EN)
    expect(en.container.querySelector(TOAST)?.textContent).toBe(EN_COPY.selectionTooLarge)
    en.unmount()
  })

  it('renders the cell-limit notice in the resolved language', () => {
    const zh = mountToast({ kind: 'too-many-cells' }, ZH)
    expect(zh.container.querySelector(TOAST)?.textContent).toBe(ZH.tooManyCells)
    expect(zh.container.querySelector(TOAST)?.getAttribute('data-dsa-selection-error')).toBe(
      'too-many-cells',
    )
    zh.unmount()

    const en = mountToast({ kind: 'too-many-cells' }, EN)
    expect(en.container.querySelector(TOAST)?.textContent).toBe(EN_COPY.tooManyCells)
    en.unmount()
  })

  it('renders nothing when there is nothing to report', () => {
    const tree = mountToast(null, ZH)

    expect(tree.container.querySelector(TOAST)).toBeNull()
    tree.unmount()
  })

  it('publishes the cell limit as its own kind and stays silent for every ordinary gesture', () => {
    const feedback = createSelectionFeedback()

    feedback.report('too-many-cells')
    expect(feedback.getSnapshot()).toEqual({ kind: 'too-many-cells' })

    feedback.report('too-large')
    expect(feedback.getSnapshot()).toEqual({ kind: 'too-large' })

    for (const reason of SILENT_REASONS) {
      feedback.report(reason)
      expect(feedback.getSnapshot(), `${reason} must stay silent`).toBeNull()
    }
  })

  it('clears the notice when a later capture succeeds', () => {
    const feedback = createSelectionFeedback()
    feedback.report('too-many-cells')
    expect(feedback.getSnapshot()).not.toBeNull()

    feedback.report(null)

    expect(feedback.getSnapshot()).toBeNull()
  })
})

describe('renderer state copy', () => {
  it('shows the generic loading copy in the document language', () => {
    document.documentElement.lang = 'zh-CN'
    const zh = mountDocx()
    expect(zh.container.textContent).toContain(ZH.loading)
    zh.unmount()

    document.documentElement.lang = 'en'
    const en = mountDocx()
    expect(en.container.textContent).toContain(EN_COPY.loading)
    en.unmount()
  })

  it('shows the generic failure copy when the renderer has no diagnosis', async () => {
    document.documentElement.lang = 'en'
    const tree = mountDocx()

    await act(async () => {
      // A rejection that carries no message: the renderer has nothing to report
      // beyond "this did not display", which is exactly the generic state.
      engine.pending?.reject({})
    })

    expect(tree.container.textContent).toContain(EN_COPY.rendererFailed)
    tree.unmount()
  })

  it('keeps an explicit diagnosis instead of replacing it with the generic copy', async () => {
    document.documentElement.lang = 'en'
    const tree = mountDocx()

    await act(async () => {
      engine.pending?.reject(new Error('the archive is not a DOCX package'))
    })

    expect(tree.container.textContent).toContain('the archive is not a DOCX package')
    expect(tree.container.textContent).not.toContain(EN_COPY.rendererFailed)
    tree.unmount()
  })
})
