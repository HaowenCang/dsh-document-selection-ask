/**
 * The plugin's selectable PDF preview body.
 *
 * It is registered under the `sidebar.right.tab.document` keyed slot for the
 * renderer id in `identity.ts`, and DSH hands it the file's complete bytes, the
 * exact resource address, a wrap preference and — the contract that matters most
 * here — a `scrollportRef` the body reports its own scroll container through.
 * Everything below is that report plus two layers per page.
 *
 * ## DOM contract
 *
 * ```text
 * <section data-dsa-document-kind="pdf"
 *          data-dsa-resource-address="<props.resourceAddress>">
 *   <div data-dsa-pdf-stack>
 *     <div data-dsa-pdf-page="1">  <canvas/> <div class="textLayer">…</div> </div>
 *     <div data-dsa-pdf-page="2">  …                               </div>
 *   </div>
 * </section>
 * ```
 *
 * The page attribute is **1-based** and marks the wrapper rather than the canvas,
 * because Task 8 resolves a selection's page provenance from the wrapper the
 * selection's endpoints live in. The address is copied verbatim from the public
 * props; nothing here infers it from the shell's DOM or from `location`.
 *
 * ## Page lifecycle
 *
 * Page 1 renders immediately; every later page renders when an
 * `IntersectionObserver` with a fixed `1200px 0px` root margin and the **viewport**
 * as its root — not this body's own scroll container — says it is within that
 * distance of the viewport. A page that has not rendered keeps its full box, so
 * the document's scroll height is correct from the first frame and a page cannot
 * oscillate in and out of the observer's range as it renders.
 *
 * ## Resize
 *
 * The page width follows the preview's available width, which the right column
 * changes when its edge is dragged. A `ResizeObserver` on the scroll container
 * reports the new content width, the change is coalesced into one animation
 * frame, and the page re-renders at that width. The re-render goes through the
 * same operation object as the first one, so the previous canvas task is
 * cancelled rather than left to finish against a canvas whose size has already
 * changed.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import type { DocumentPreviewProps } from '../../dsh/contracts.js'
import { PdfWorkerFailure } from './errors.js'
import {
  PDF_DOCUMENT_KIND,
  PDF_DOCUMENT_KIND_ATTRIBUTE,
  PDF_PAGE_ATTRIBUTE,
  PDF_RESOURCE_ADDRESS_ATTRIBUTE,
} from './identity.js'
import { renderPdfPage } from './render-page.js'
import type { PdfPageRender } from './render-page.js'
import { openPdf } from './runtime.js'
import type { PdfReadyDocument, PdfSession } from './runtime.js'

/** Props this body receives: the framework's own, and nothing else. */
export type SelectablePdfBodyProps = DocumentPreviewProps

/**
 * How far ahead of the viewport a page starts rendering.
 *
 * A fixed distance rather than `100%`. The percentage would be measured against
 * the scroll container's own box, and that box is a **consequence** of how many
 * pages have rendered: the stack is `flex: auto` inside the column, page 1 alone
 * leaves it about one viewport tall, and six rendered pages grow it to several.
 * An observer whose margin is a fraction of that box therefore observes a moving
 * target — the first page's render expands the margin until the next page is
 * inside it, and the whole document renders on open while still looking lazy in
 * the code. A fixed margin is stable under its own effect, and one viewport's
 * worth of lookahead is the behaviour the rule is for.
 */
const LAZY_ROOT_MARGIN = '1200px 0px'

/** Copy shown while a document opens. */
const LOADING_TEXT = '正在打开 PDF…'

/** Copy shown when the file could not be opened. */
const FAILED_TEXT = '无法显示 PDF'

/** Copy shown when the worker that renders PDFs could not be used. */
const WORKER_FAILED_TEXT = 'PDF 渲染进程无法继续，请重试。'

/** Copy shown when the preview has no complete bytes to render. */
const NO_BYTES_TEXT = 'PDF 预览需要完整文件内容。'

/** The failure notice's shape. */
type PdfLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: PdfReadyDocument }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Present one PDF with a canvas and a selectable text layer per page.
 *
 * @param props - the framework's standard document-body props.
 * @returns the renderer root.
 */
export function SelectablePdfBody(props: SelectablePdfBodyProps): JSX.Element {
  const { content, resourceAddress, scrollportRef } = props
  const data = content.kind === 'bytes' ? content.data : undefined

  // The tab's own lifetime, read through the framework's bound hook rather than
  // through a subscription of this component's own; that keeps the body's
  // contract with the shell the published one.
  const { tab } = props.useTabInfo()
  const tabSignal = tab.signal

  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PdfLoadState>({ kind: 'loading' })
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined)
  const [available, setAvailable] = useState(0)
  const devicePixelRatio = useDevicePixelRatio()

  const scrollport = useRef<HTMLElement | null>(null)
  const measured = useRef(0)

  /**
   * The framework's own ref callback, with this component's own bookkeeping in
   * front of it.
   *
   * `scrollportRef` is called with the element while the body is mounted and with
   * `null` when it unmounts; that null call is how the shell returns scroll
   * ownership to the shared preview body, so it is never skipped.
   */
  const bindScrollport = useCallback(
    (element: HTMLElement | null) => {
      scrollport.current = element
      scrollportRef(element)
    },
    [scrollportRef],
  )

  useEffect(() => {
    if (data === undefined || tabSignal.aborted) return

    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tabSignal])
    setState({ kind: 'loading' })
    setLoadFailure(undefined)

    const session: PdfSession = openPdf({
      bytes: data,
      signal,
      onFailure: (error: unknown) => {
        if (!signal.aborted) setLoadFailure(describeFailure(error))
      },
    })

    session.ready.then(
      (document) => {
        if (!signal.aborted) setState({ kind: 'ready', data: document })
      },
      (error: unknown) => {
        if (!signal.aborted) setState({ kind: 'failed', message: describeFailure(error) })
      },
    )

    return () => {
      lifetime.abort()
      void session.dispose()
    }
  }, [data, tabSignal, attempt])

  useLayoutEffect(() => {
    const element = scrollport.current
    if (element === null) return
    const measure = (): void => {
      const next = element.clientWidth
      // The comparison is what keeps the observer from driving an endless
      // re-render: a page whose fit width is already this value lays out
      // identically, and React would otherwise re-render on every reported frame.
      if (next === measured.current) return
      measured.current = next
      setAvailable(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const failure = loadFailure ?? (state.kind === 'failed' ? state.message : undefined)
  const document = state.kind === 'ready' ? state.data : undefined

  /**
   * The width every page is laid out at, before its own geometry is available.
   *
   * 1 is the degenerate value a zero-width column produces; the geometry helper
   * accepts it and the first `ResizeObserver` report replaces it. Nothing here
   * has to guess an aspect ratio, because the unit page sizes arrive with the
   * document.
   */
  const fitWidth = available > 0 ? available : 1

  return (
    <section
      ref={bindScrollport}
      {...{ [PDF_DOCUMENT_KIND_ATTRIBUTE]: PDF_DOCUMENT_KIND }}
      {...{ [PDF_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
    >
      <div data-dsa-pdf-stack="">
        {data === undefined && <p data-dsa-pdf-notice="">{NO_BYTES_TEXT}</p>}
        {data !== undefined && failure !== undefined && (
          <p data-dsa-pdf-notice="" role="alert">
            <span>{failure}</span>
            <button
              type="button"
              data-dsa-pdf-retry=""
              onClick={() => {
                setAttempt((value) => value + 1)
              }}
            >
              重试
            </button>
          </p>
        )}
        {data !== undefined && failure === undefined && document === undefined && (
          <p data-dsa-pdf-notice="">{LOADING_TEXT}</p>
        )}
        {document !== undefined &&
          document.sizes.map((size, index) => (
            <PdfPage
              key={index + 1}
              document={document.document}
              pageNumber={index + 1}
              unitWidth={size.width}
              unitHeight={size.height}
              fitWidth={fitWidth}
              devicePixelRatio={devicePixelRatio}
              signal={tabSignal}
              immediate={index === 0}
            />
          ))}
      </div>
    </section>
  )
}

/**
 * The copy for one failure.
 *
 * A worker failure is reported as itself rather than as "the PDF could not be
 * displayed": the two have different causes and different remedies, and this
 * project's requirement is that a worker problem is visible rather than absorbed
 * into a quieter parse.
 *
 * @param error - the failure.
 * @returns the copy to show.
 */
function describeFailure(error: unknown): string {
  if (error instanceof PdfWorkerFailure) return WORKER_FAILED_TEXT
  const detail = error instanceof Error ? error.message : String(error)
  return `${FAILED_TEXT}：${detail}`
}

/**
 * Follow the display's device pixel ratio, so a page rendered at one ratio is
 * re-rendered when the window moves to a display with another.
 *
 * `matchMedia` is used rather than a `resize` listener because a ratio change is
 * not a resize: dragging a window between two displays can change the ratio
 * without changing its size at all.
 *
 * @returns the current ratio.
 */
function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState<number>(() => globalThis.devicePixelRatio || 1)

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${String(globalThis.devicePixelRatio || 1)}dppx)`)
    const listener = (): void => {
      setRatio(globalThis.devicePixelRatio || 1)
    }
    query.addEventListener('change', listener)
    return () => {
      query.removeEventListener('change', listener)
    }
  }, [ratio])

  return ratio
}

/** Props of one page. */
interface PdfPageProps {
  /** The loaded document. */
  readonly document: PDFDocumentProxy
  /** 1-based page number. */
  readonly pageNumber: number
  /** The page's width in PDF user units. */
  readonly unitWidth: number
  /** The page's height in PDF user units. */
  readonly unitHeight: number
  /** The width the page is displayed at, in CSS pixels. */
  readonly fitWidth: number
  /** The display's device pixel ratio. */
  readonly devicePixelRatio: number
  /** The owning tab's lifetime. */
  readonly signal: AbortSignal
  /** Whether the page renders without waiting to become visible. */
  readonly immediate: boolean
}

/**
 * One page: a stable wrapper, a canvas, and a text layer.
 *
 * @param props - the document, the page number and the shared geometry.
 * @returns the page wrapper.
 */
function PdfPage(props: PdfPageProps): JSX.Element {
  const { document, pageNumber, unitWidth, unitHeight, fitWidth, devicePixelRatio, signal, immediate } = props

  const wrapper = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const textLayer = useRef<HTMLDivElement | null>(null)
  const render = useRef<PdfPageRender | undefined>(undefined)
  const frame = useRef<number | undefined>(undefined)
  const paintedToken = useRef<string | undefined>(undefined)

  const [requested, setRequested] = useState(immediate)
  const [painted, setPainted] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const width = fitWidth
  const height = (fitWidth / unitWidth) * unitHeight

  const paint = useCallback((): PdfPageRender | undefined => {
    const canvasElement = canvas.current
    const layerElement = textLayer.current
    if (canvasElement === null || layerElement === null) return undefined

    render.current?.cancel()
    const operation = renderPdfPage(
      document,
      pageNumber,
      { canvas: canvasElement, textLayer: layerElement },
      width,
      devicePixelRatio,
      signal,
    )
    render.current = operation
    operation.done.then(
      () => {
        if (render.current !== operation) return
        setPainted(true)
        setFailure(undefined)
      },
      (error: unknown) => {
        if (render.current !== operation || signal.aborted) return
        setFailure(describeFailure(error))
      },
    )
    return operation
  }, [document, pageNumber, width, devicePixelRatio, signal])

  useEffect(() => {
    if (requested) return
    const element = wrapper.current
    if (element === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setRequested(true)
        observer.disconnect()
      },
      // The viewport is the root, not the scroll container. The container is
      // clipped by the column and normally sits inside the viewport, and a
      // viewport-rooted observer has a box that this component's own rendering
      // cannot change — which is what keeps the margin above a fixed distance.
      { rootMargin: LAZY_ROOT_MARGIN },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [requested])

  useEffect(() => {
    if (!requested) return
    if (paintedToken.current === `${String(width)}x${String(devicePixelRatio)}`) return

    // One frame of coalescing: dragging the right column's edge reports many
    // sizes, and every report would otherwise start a full page raster that the
    // next one cancels a few milliseconds later.
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      const operation = paint()
      // Only a paint that actually started is remembered, so a cancelled frame
      // leaves the token untouched and the next report paints.
      if (operation !== undefined) {
        paintedToken.current = `${String(width)}x${String(devicePixelRatio)}`
      }
    })

    return () => {
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current)
        frame.current = undefined
      }
    }
  }, [requested, width, devicePixelRatio, paint])

  // Unmount, and a tab that aborts while this page is still mounted, both cancel
  // the in-flight render. `render-page.ts` releases the page object once both of
  // its renders have settled.
  useEffect(() => {
    const onAbort = (): void => {
      render.current?.cancel()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    return () => {
      signal.removeEventListener('abort', onAbort)
      render.current?.cancel()
    }
  }, [signal])

  const pageStyle = useMemo<CSSProperties>(
    () => ({ width: `${String(width)}px`, height: `${String(height)}px` }),
    [width, height],
  )

  return (
    <div
      ref={wrapper}
      {...{ [PDF_PAGE_ATTRIBUTE]: String(pageNumber) }}
      data-dsa-pdf-page-wrapper=""
      style={pageStyle}
    >
      <canvas ref={canvas} data-dsa-pdf-canvas="" />
      <div ref={textLayer} className="textLayer" data-dsa-pdf-text="" />
      {!painted && failure === undefined && <div data-dsa-pdf-placeholder="">{LOADING_TEXT}</div>}
      {failure !== undefined && (
        <div data-dsa-pdf-placeholder="" role="alert">
          {failure}
        </div>
      )}
    </div>
  )
}
