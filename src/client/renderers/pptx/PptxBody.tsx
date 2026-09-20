/**
 * The plugin's selectable PPTX preview body.
 *
 * Registered under the `sidebar.right.tab.document` keyed slot for the
 * renderer id in `identity.ts`. Renders high-fidelity PPTX presentations
 * using PptxViewer after OOXML security pipeline gating.
 *
 * ## DOM contract
 *
 * ```html
 * <section data-dsa-document-kind="pptx"
 *          data-dsa-resource-address="<props.resourceAddress>">
 *   <div data-dsa-pptx-content />
 * </section>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { DocumentPreviewProps } from '../../dsh/contracts.js'
import { documentRendererStrings } from '../../ui/locales.js'
import { useResourceInvalidation } from '../resource-invalidation.js'
import { renderPptx } from './engine.js'
import type { PptxEngineSession } from './engine.js'
import {
  PPTX_DOCUMENT_KIND,
  PPTX_DOCUMENT_KIND_ATTRIBUTE,
  PPTX_RESOURCE_ADDRESS_ATTRIBUTE,
  PPTX_SELECTABLE_ATTRIBUTE,
  PPTX_STATUS_ATTRIBUTE,
} from './identity.js'

/** Injected callbacks the PPTX renderer body receives from the plugin runtime. */
export interface PptxRendererInjectFace {
  /** Re-evaluate live selection when rendered slide DOM is invalidated. */
  readonly onSelectableDomInvalidated?: (() => void) | undefined
  /** Called when a resource stops owning a selectable selection. */
  readonly onResourceInvalidated?: ((resourceAddress: string) => void) | undefined
}

export type PptxBodyProps = DocumentPreviewProps & Partial<PptxRendererInjectFace>

type PptxLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly slideCount: number }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Present one PPTX presentation with high-fidelity rendered HTML/SVG DOM.
 *
 * @param props - standard document-body props provided by DSH and slot injectors.
 * @returns the renderer root.
 */
export function PptxBody(props: PptxBodyProps): JSX.Element {
  const { content, resourceAddress, scrollportRef, onSelectableDomInvalidated, onResourceInvalidated } =
    props

  const { tab } = props.useTabInfo()
  const tabSignal = tab.signal

  // Resolved on every render so the copy follows the document's language.
  const strings = documentRendererStrings(globalThis.document)

  // The windowed renderer's selectable DOM is recycled as slides scroll, which is
  // why slide invalidation is a recapture rather than a clear; a resource that
  // goes away is the clear.
  useResourceInvalidation(resourceAddress, tabSignal, onResourceInvalidated)

  const [state, setState] = useState<PptxLoadState>({ kind: 'loading' })
  const generationRef = useRef(0)

  const rootRef = useRef<HTMLElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<PptxEngineSession | null>(null)
  const measuredWidthRef = useRef<number>(0)

  const bindScrollport = useCallback(
    (element: HTMLElement | null) => {
      rootRef.current = element
      if (element !== null) {
        const scrollHost = (element.closest('[data-textpreview-body]') as HTMLElement | null) ?? element
        scrollportRef(scrollHost)
      } else {
        scrollportRef(null)
      }
    },
    [scrollportRef],
  )

  useEffect(() => {
    if (content.kind !== 'bytes') {
      setState({ kind: 'failed', message: strings.pptxNeedsBytes })
      return
    }

    const currentGeneration = ++generationRef.current
    const ac = new AbortController()

    const onTabAbort = () => {
      ac.abort()
    }
    tabSignal.addEventListener('abort', onTabAbort, { once: true })

    const rootEl = rootRef.current
    const contentHost = contentHostRef.current

    if (!rootEl || !contentHost) {
      return () => {
        tabSignal.removeEventListener('abort', onTabAbort)
        ac.abort()
      }
    }

    const bytes = content.data.slice()
    setState({ kind: 'loading' })

    const initialWidth = Math.max(contentHost.clientWidth || rootEl.clientWidth || 800, 100)
    measuredWidthRef.current = initialWidth

    const scrollHost = (rootEl.closest('[data-textpreview-body]') as HTMLElement | null) ?? rootEl

    renderPptx(bytes, contentHost, scrollHost, initialWidth, ac.signal, {
      onSelectableDomInvalidated: () => {
        onSelectableDomInvalidated?.()
      },
    })
      .then((session) => {
        if (ac.signal.aborted || currentGeneration !== generationRef.current) {
          session.dispose()
          return
        }
        sessionRef.current = session
        setState({ kind: 'ready', slideCount: session.slideCount })
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || currentGeneration !== generationRef.current) {
          return
        }
        console.error('[dsa-pptx] failed to render presentation:', err)
        // The generic copy is the locale's; the underlying failure is still
        // logged above rather than absorbed into it.
        setState({ kind: 'failed', message: strings.rendererFailed })
      })

    // ResizeObserver for plugin-owned width adaptation
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newWidth = Math.floor(entry.contentRect.width)
          if (
            newWidth > 50 &&
            Math.abs(newWidth - measuredWidthRef.current) >= 2 &&
            sessionRef.current
          ) {
            measuredWidthRef.current = newWidth
            sessionRef.current.resize(newWidth).catch(() => {
              // Ignore benign concurrent resize aborts
            })
          }
        }
      })
      resizeObserver.observe(rootEl)
    }

    return () => {
      tabSignal.removeEventListener('abort', onTabAbort)
      ac.abort()
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      if (sessionRef.current) {
        sessionRef.current.dispose()
        sessionRef.current = null
      }
      if (contentHost) {
        contentHost.replaceChildren()
      }
    }
  }, [content, tabSignal, onSelectableDomInvalidated])

  return (
    <section
      ref={bindScrollport}
      {...{
        [PPTX_DOCUMENT_KIND_ATTRIBUTE]: PPTX_DOCUMENT_KIND,
        [PPTX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress,
      }}
    >
      <div ref={contentHostRef} {...{ [PPTX_SELECTABLE_ATTRIBUTE]: '' }} />
      {state.kind === 'loading' && (
        <div {...{ [PPTX_STATUS_ATTRIBUTE]: 'loading' }}>{strings.loading}</div>
      )}
      {state.kind === 'failed' && (
        <div {...{ [PPTX_STATUS_ATTRIBUTE]: 'failed' }}>{state.message}</div>
      )}
    </section>
  )
}
