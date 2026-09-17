// @vitest-environment jsdom
/**
 * One text-layer container, one generation of text.
 *
 * A page's text-layer element belongs to React and is reused: a resize re-renders
 * the page **into the same container**, which is the whole point of that element
 * being stable. PDF.js's `TextLayer` appends into whatever container it is given
 * and its `cancel()` does not remove what a previous layer appended — it cancels
 * the reader and rejects the layer's own capability. Two renders into one
 * container therefore put the page's text in the DOM twice, and a third puts it in
 * three times. The duplicates are invisible — the spans are transparent and
 * coincide — but they are what the browser reads: `getSelection().toString()`
 * returns the text twice, copy takes it twice, and Task 8's adapter would quote it
 * twice.
 *
 * What this suite asserts is the contract the renderer owes its caller:
 *
 * ```text
 * one render into a host  →  one generation of text in that host
 * ```
 *
 * Every case below renders twice into **one** `{ canvas, textLayer }` pair, which
 * is the production shape; a case built on two fresh hosts would prove nothing,
 * because the defect is precisely the reuse.
 *
 * ## Why the assertions are not a span count
 *
 * PDF.js may group items into spans differently from one render to the next —
 * marked content, end-of-line breaks and glyph grouping all change the structure —
 * so a count is corroboration and never the contract. The contract is that the
 * text a reader can see and select exists **once**: the layer's `textContent`
 * after the second render equals its `textContent` after the first. The counts are
 * asserted beside it because this stand-in is deterministic, and a count that
 * moved would be the accumulation the contract forbids.
 *
 * ## Why the stand-in appends unconditionally
 *
 * `helpers/pdfjs-mock.ts` writes into the container it was given without asking
 * who owns it, exactly as the real layer does, so nothing here can pass because a
 * test double declined to reproduce the defect. What the renderer has to do to
 * make these cases pass is what the fix is: empty the container when a new
 * generation begins.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { renderPdfPage } from '../../src/client/renderers/pdf/render-page.js'
import { FakePage, addPage, addScriptedPage, control } from './helpers/pdfjs-mock.js'
import type { PageControl } from './helpers/pdfjs-mock.js'

beforeEach(() => {
  // The page scripts are module state, so each case starts from none. Without
  // this a case would render the previous case's page.
  control.reset()
})

/** The hosts one page render writes into, as the production caller builds them. */
interface Hosts {
  readonly canvas: HTMLCanvasElement
  readonly textLayer: HTMLElement
}

/**
 * One canvas and one text-layer element, exactly as React's two refs supply them.
 *
 * The pair is created **once per case** and passed to every render in it, which is
 * what makes these cases about reuse.
 *
 * @returns the hosts.
 */
function hosts(): Hosts {
  const canvas = document.createElement('canvas')
  const textLayer = document.createElement('div')
  textLayer.className = 'textLayer'
  document.body.append(canvas, textLayer)
  return { canvas, textLayer }
}

/**
 * A loaded document over the stand-in pages this case scripted.
 *
 * @returns the document to hand the renderer.
 */
function loadedDocument(): PDFDocumentProxy {
  return {
    getPage: async (pageNumber: number): Promise<FakePage> => {
      const script = control.pages[pageNumber - 1]
      if (script === undefined) throw new Error(`No such page: ${String(pageNumber)}`)
      return new FakePage(script)
    },
  } as unknown as PDFDocumentProxy
}

/**
 * Let every pending microtask run.
 *
 * Eight turns is what the renderer's own chain needs to reach the text layout. The
 * cases below state which render they are waiting for by awaiting its `done`; this
 * helper is for the ones that deliberately leave a render unfinished.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

/**
 * The text a browser would read out of one layer.
 * @param elements - the hosts under test.
 * @returns the layer's text content.
 */
function layerText(elements: Hosts): string {
  return elements.textLayer.textContent ?? ''
}

/**
 * Every span's own text, in document order.
 * @param elements - the hosts under test.
 * @returns one entry per span.
 */
function spanTexts(elements: Hosts): (string | null)[] {
  return [...elements.textLayer.querySelectorAll('span')].map((span) => span.textContent)
}

/**
 * Start one render against the hosts, the way `SelectablePdfBody` starts one.
 *
 * @param elements - the shared hosts.
 * @param signal - the tab's lifetime.
 * @returns the render handle.
 */
function start(elements: Hosts, signal: AbortSignal): ReturnType<typeof renderPdfPage> {
  return renderPdfPage(loadedDocument(), 1, elements, 816, 1, signal)
}

/**
 * The page script under test, once a case has added it.
 * @returns the one page this case scripted.
 */
function page(): PageControl {
  const script = control.pages[0]
  if (script === undefined) throw new Error('the case added no page')
  return script
}

/**
 * The stream one generation was handed, by the order it was handed out.
 * @param index - 0 for the first render, 1 for the second, and so on.
 * @returns the stream.
 */
function streamOf(index: number): NonNullable<PageControl['streams'][number]> {
  const stream = page().streams[index]
  if (stream === undefined) throw new Error(`no text stream was handed out for generation ${String(index)}`)
  return stream
}

describe('rendering one page twice into the same text-layer host', () => {
  it('leaves the second render with one generation of text', async () => {
    addPage(['Alpha', 'Beta', 'Gamma'])
    const signal = new AbortController().signal
    const elements = hosts()

    const first = start(elements, signal)
    await first.done

    const firstText = layerText(elements)
    expect(firstText).toBe('AlphaBetaGamma')
    expect(spanTexts(elements)).toEqual(['Alpha', 'Beta', 'Gamma'])

    // The same hosts: the second render is the resize re-render, not a fresh page.
    const second = start(elements, signal)
    await second.done

    expect(layerText(elements)).toBe(firstText)
    expect(spanTexts(elements)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('keeps one generation across four consecutive renders into one host', async () => {
    addPage(['Alpha', 'Beta'])
    const signal = new AbortController().signal
    const elements = hosts()

    const first = start(elements, signal)
    await first.done
    const firstText = layerText(elements)

    // Three more renders, each cancelling the operation it replaces — including
    // one cancelled after it had already completed, which must stay harmless.
    const second = start(elements, signal)
    await second.done
    second.cancel()

    const third = start(elements, signal)
    await third.done

    const fourth = start(elements, signal)
    await fourth.done

    expect(layerText(elements)).toBe(firstText)
    expect(spanTexts(elements)).toEqual(['Alpha', 'Beta'])
  })

  it('empties the layer for a render that is cancelled before it starts at all', async () => {
    addPage(['Alpha', 'Beta'])
    const elements = hosts()

    const first = start(elements, new AbortController().signal)
    await first.done
    expect(layerText(elements)).toBe('AlphaBeta')

    // A signal that has already aborted: the operation cancels itself before its
    // first `await`, so it never reaches PDF.js. The previous generation's text
    // must not survive it — that text belongs to a render the caller has already
    // superseded, so keeping it would leave selectable text on screen that no
    // render produced.
    const aborted = new AbortController()
    aborted.abort()
    const second = start(elements, aborted.signal)
    await second.done

    expect(layerText(elements)).toBe('')
    expect(spanTexts(elements)).toEqual([])
    // And nothing was read from the page: the aborted generation handed out no
    // text stream, so its spans could not have come from anywhere. The one stream
    // recorded is the first render's.
    expect(page().streams).toHaveLength(1)
  })
})

describe('what a render leaves in the layer when it does not finish', () => {
  it('does not keep the previous generation’s text when the new render fails', async () => {
    addPage(['Alpha', 'Beta'])
    const signal = new AbortController().signal
    const elements = hosts()

    const first = start(elements, signal)
    await first.done
    expect(layerText(elements)).toBe('AlphaBeta')
    const script = page()

    // The next generation fails before it reaches the text layer at all: the page
    // it asks for is gone, so `getPage` rejects. That is the shape of the hazard
    // the boundary exists for — the previous generation's text is still in the
    // element, and nothing this generation does will replace it.
    control.pages.length = 0
    const second = start(elements, signal)
    await expect(second.done).rejects.toThrowError('No such page: 1')

    expect(layerText(elements)).toBe('')
    expect(spanTexts(elements)).toEqual([])
    // The cleanup contract is untouched by the reset: the operation that did obtain
    // a page cleaned it up once, and never while its own render was still pending.
    expect(script.cleanups).toBe(1)
    expect(script.cleanedUpWhileRendering).toBe(false)
  })

  it('keeps only the new generation when the old one was cancelled mid-layout', async () => {
    // Three chunks, released one at a time by this case: the first generation
    // lays out `Partial` and is then left waiting for the second.
    addScriptedPage([['Partial'], ['Alpha'], ['Beta']])
    const signal = new AbortController().signal
    const elements = hosts()

    const first = start(elements, signal)
    await settle()
    expect(streamOf(0).deliver()).toBe(true)
    await settle()
    expect(layerText(elements)).toBe('Partial')
    expect(streamOf(0).delivered).toBe(1)

    first.cancel()
    await first.done
    // The cancellation reached the stream, so the old generation will never be
    // served another chunk — the state a partial layout leaves behind.
    expect(streamOf(0).cancels).toBe(1)
    expect(page().textCancelled).toBe(true)

    // The new generation reads the page's text from the beginning, as a re-render
    // of a real page does, and it is served the same three chunks: the old
    // generation's partial `Partial` must not stand in front of them.
    const second = start(elements, signal)
    await settle()
    streamOf(1).release()
    await second.done
    await settle()

    expect(layerText(elements)).toBe('PartialAlphaBeta')
    expect(spanTexts(elements)).toEqual(['Partial', 'Alpha', 'Beta'])
    expect(page().cleanedUpWhileRendering).toBe(false)
  })
})
