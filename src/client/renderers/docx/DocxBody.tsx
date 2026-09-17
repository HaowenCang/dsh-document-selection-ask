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
import { renderDocx } from './engine.js'
import {
  DOCX_DOCUMENT_KIND,
  DOCX_DOCUMENT_KIND_ATTRIBUTE,
  DOCX_RESOURCE_ADDRESS_ATTRIBUTE,
  DOCX_SELECTABLE_ATTRIBUTE,
  DOCX_STYLE_HOST_ATTRIBUTE,
} from './identity.js'

/** Copy shown while a document opens. */
const LOADING_TEXT = '正在打开 Word 文档…'

/** Copy shown when the file could not be opened. */
const FAILED_TEXT = '无法显示 Word 文档'

/** Copy shown when the preview has no complete bytes to render. */
const NO_BYTES_TEXT = 'DOCX 预览需要完整文件内容。'

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
export function DocxBody(props: DocumentPreviewProps): JSX.Element {
  const { content, resourceAddress, scrollportRef } = props

  const { tab } = props.useTabInfo()
  const tabSignal = tab.signal

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
      setState({ kind: 'failed', message: NO_BYTES_TEXT })
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
        const message = err instanceof Error && err.message ? err.message : FAILED_TEXT
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
        <div style={{ padding: '32px', textAlign: 'center', color: '#666' }}>
          {LOADING_TEXT}
        </div>
      )}
      {state.kind === 'failed' && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
          {state.message}
        </div>
      )}
    </section>
  )
}
