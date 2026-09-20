/**
 * The plugin's selectable DOCX preview body.
 *
 * Registered under the `sidebar.right.tab.document` keyed slot for the
 * renderer id in `identity.ts`. Renders high-fidelity DOCX documents using
 * `docx-preview` after OOXML preflight security verification.
 *
 * ## DOM contract
 *
 * ```html
 * <section data-dsa-document-kind="docx"
 *          data-dsa-resource-address="<props.resourceAddress>">
 *   <div data-dsa-docx-style-host />
 *   <div data-dsa-docx-content />
 * </section>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { DocumentPreviewProps } from '../../dsh/contracts.js'
import { documentRendererStrings } from '../../ui/locales.js'
import { useResourceInvalidation } from '../resource-invalidation.js'
import { renderDocx } from './engine.js'
import {
  DOCX_DOCUMENT_KIND,
  DOCX_DOCUMENT_KIND_ATTRIBUTE,
  DOCX_RESOURCE_ADDRESS_ATTRIBUTE,
  DOCX_SELECTABLE_ATTRIBUTE,
  DOCX_STATUS_ATTRIBUTE,
  DOCX_STYLE_HOST_ATTRIBUTE,
} from './identity.js'
import type { DocxRendererInjectFace } from './register.js'

/** Props this body receives: the framework's own, plus the slot-injected callbacks. */
export type DocxBodyProps = DocumentPreviewProps & Partial<DocxRendererInjectFace>

type DocxLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly renderedPages: number }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Present one DOCX document with high-fidelity rendered HTML/CSS DOM.
 *
 * @param props - standard document-body props provided by DSH.
 * @returns the renderer root.
 */
export function DocxBody(props: DocxBodyProps): JSX.Element {
  const { content, resourceAddress, scrollportRef, onResourceInvalidated } = props

  const { tab } = props.useTabInfo()
  const tabSignal = tab.signal

  // Resolved on every render rather than captured once, so the copy follows the
  // document's language without a second subscription to observe a change.
  const strings = documentRendererStrings(globalThis.document)

  // The resource this body renders stops being selectable when the body unmounts,
  // when the address changes, or when its tab is released. The renderer publishes
  // that fact and nothing else: which snapshot to clear is the runtime's decision.
  useResourceInvalidation(resourceAddress, tabSignal, onResourceInvalidated)

  const [state, setState] = useState<DocxLoadState>({ kind: 'loading' })
  const generationRef = useRef(0)

  const rootRef = useRef<HTMLElement | null>(null)
  const styleHostRef = useRef<HTMLDivElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)

  const bindScrollport = useCallback(
    (element: HTMLElement | null) => {
      rootRef.current = element
      scrollportRef(element)
    },
    [scrollportRef],
  )

  useEffect(() => {
    if (content.kind !== 'bytes') {
      setState({ kind: 'failed', message: strings.docxNeedsBytes })
      return
    }

    const currentGeneration = ++generationRef.current
    const ac = new AbortController()

    const onTabAbort = () => {
      ac.abort()
    }
    tabSignal.addEventListener('abort', onTabAbort, { once: true })

    const contentHost = contentHostRef.current
    const styleHost = styleHostRef.current

    if (!contentHost || !styleHost) {
      return () => {
        tabSignal.removeEventListener('abort', onTabAbort)
        ac.abort()
      }
    }

    // Copy host bytes so third-party parser does not receive mutable buffer
    const bytes = content.data.slice()

    setState({ kind: 'loading' })

    renderDocx(bytes, contentHost, styleHost, ac.signal)
      .then((result) => {
        if (ac.signal.aborted || currentGeneration !== generationRef.current) {
          result.dispose()
          return
        }
        setState({ kind: 'ready', renderedPages: result.renderedPages })
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || currentGeneration !== generationRef.current) {
          return
        }
        // The parser's own message when it has one, and the locale's generic
        // "could not be displayed" when it does not: a renderer that always
        // replaced the underlying diagnosis with the generic copy would hide the
        // one piece of evidence a failure report needs.
        const message = err instanceof Error && err.message ? err.message : strings.rendererFailed
        setState({ kind: 'failed', message })
      })

    return () => {
      tabSignal.removeEventListener('abort', onTabAbort)
      ac.abort()
      if (contentHost) contentHost.innerHTML = ''
      if (styleHost) styleHost.innerHTML = ''
    }
  }, [content, tabSignal])

  return (
    <section
      ref={bindScrollport}
      {...{
        [DOCX_DOCUMENT_KIND_ATTRIBUTE]: DOCX_DOCUMENT_KIND,
        [DOCX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress,
      }}
    >
      <div ref={styleHostRef} {...{ [DOCX_STYLE_HOST_ATTRIBUTE]: '' }} />
      <div ref={contentHostRef} {...{ [DOCX_SELECTABLE_ATTRIBUTE]: '' }} />
      {state.kind === 'loading' && (
        <div {...{ [DOCX_STATUS_ATTRIBUTE]: 'loading' }}>{strings.loading}</div>
      )}
      {state.kind === 'failed' && (
        <div {...{ [DOCX_STATUS_ATTRIBUTE]: 'failed' }}>{state.message}</div>
      )}
    </section>
  )
}
