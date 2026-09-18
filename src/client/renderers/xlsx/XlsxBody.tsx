/**
 * The plugin's selectable XLSX preview body.
 *
 * Renders high-fidelity spreadsheet workbooks using @extend-ai/react-xlsx
 * in read-only mode after strict OOXML preflight, extraction verification,
 * and relationship security checks.
 *
 * Publishes spreadsheet range selections to the injected `XlsxSelectionBridge`.
 */

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  useXlsxViewer,
  XlsxViewer,
  XlsxViewerProvider,
} from '@extend-ai/react-xlsx'

import type { DocumentPreviewProps } from '../../dsh/contracts.js'
import { DEFAULT_OOXML_LIMITS } from '../../ooxml/limits.js'
import { preflightOoxml } from '../../ooxml/preflight.js'
import { verifyOoxmlExtraction } from '../../ooxml/verify-extraction.js'
import { fileNameFromResourceAddress } from '../../provenance/file-name.js'
import { parseCellRange } from '../../provenance/cell-range.js'
import { MAX_XLSX_SELECTED_CELLS } from '../../quote/format-xlsx.js'
import {
  XLSX_DOCUMENT_KIND,
  XLSX_DOCUMENT_KIND_ATTRIBUTE,
  XLSX_RESOURCE_ADDRESS_ATTRIBUTE,
  XLSX_SELECTABLE_ATTRIBUTE,
  XLSX_SELECTION_ATTRIBUTE,
} from './identity.js'
import { assertSafeXlsxRelationships } from './security.js'
import type { XlsxSelectionBridge, XlsxSelectionOwner } from './selection-bridge.js'
import { ensureXlsxWasmInitialized, XlsxWasmIntegrityError, XlsxWasmSourceUnavailableError } from './wasm.js'
import { XlsxSheetTabs } from './XlsxSheetTabs.js'

/** Maximum supported XLSX file size (25 MiB limit). */
export const MAX_XLSX_FILE_SIZE_BYTES = 25 * 1024 * 1024

const LOADING_TEXT = '正在打开表格…'
const FAILED_TEXT = '无法显示电子表格'
const TOO_LARGE_TEXT = '文件超出支持的大小限制（最大 25 MB）'
const NO_BYTES_TEXT = 'XLSX 预览需要完整文件内容。'
const WASM_UNAVAILABLE_TEXT = '表格解析引擎在当前架构下无法加载，暂不支持显示。'
const WASM_INTEGRITY_TEXT = '表格解析引擎完整性校验失败，无法显示。'

/**
 * The copy one pipeline failure is reported with.
 *
 * The two engine failures are named separately because they are different
 * findings: `unavailable` is the architecture having no source at all, and
 * `integrity` is the embedded payload not reproducing the reviewed binary. Both
 * fail closed, and neither is reported as a workbook that simply failed to open.
 *
 * @param error - whatever the pipeline threw.
 * @returns the message to show.
 */
function failureMessage(error: unknown): string {
  if (error instanceof XlsxWasmSourceUnavailableError) return WASM_UNAVAILABLE_TEXT
  if (error instanceof XlsxWasmIntegrityError) return WASM_INTEGRITY_TEXT
  return FAILED_TEXT
}

export interface XlsxBodyProps extends DocumentPreviewProps {
  readonly bridge: XlsxSelectionBridge
}

/**
 * The load state of one resource generation.
 *
 * `ready` carries the bytes rather than a flag, and that is the point: the
 * buffer handed to `XlsxViewerProvider` is the **same** array the security gates
 * validated, not a second read of the host's array. A state that only recorded
 * "ok" would leave the render free to copy whatever `content.data` happened to
 * hold at that instant, which is a different array from the one that passed.
 */
type XlsxLoadState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly file: ArrayBuffer }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Invisible publisher watching the viewer controller inside XlsxViewerProvider
 * and publishing range selections to the bridge owner.
 */
function XlsxSelectionPublisher({
  bridge,
  resourceAddress,
  rootRef,
  onSelectionChange,
}: {
  bridge: XlsxSelectionBridge
  resourceAddress: string
  rootRef: React.RefObject<HTMLElement | null>
  onSelectionChange: (selection: string | null) => void
}) {
  const controller = useXlsxViewer()
  const selection = controller.selection
  const selectedRangeAddress = controller.selectedRangeAddress
  const activeSheet = controller.activeSheet
  const activeSheetName = activeSheet?.name ?? ''
  const sheetIndex = activeSheet?.workbookSheetIndex ?? 0

  const ownerRef = useRef<XlsxSelectionOwner | null>(null)

  useEffect(() => {
    if (rootRef.current && !ownerRef.current) {
      ownerRef.current = bridge.createOwner(resourceAddress, rootRef.current)
    }
    return () => {
      if (ownerRef.current) {
        ownerRef.current.dispose()
        ownerRef.current = null
      }
    }
  }, [bridge, resourceAddress, rootRef])

  useEffect(() => {
    if (!ownerRef.current || !rootRef.current) return

    if (!selection || !selectedRangeAddress || !activeSheetName) {
      ownerRef.current.clear()
      onSelectionChange(null)
      return
    }

    const parsed = parseCellRange(selectedRangeAddress)
    if (!parsed) {
      ownerRef.current.clear()
      onSelectionChange(null)
      return
    }

    // The published label is the same `<sheet>!<range>` pair the adapter turns
    // into provenance, so an observer reading it sees exactly what Ask would
    // quote rather than a parallel rendering of the same state.
    onSelectionChange(`${activeSheetName}!${parsed.range}`)

    if (parsed.cellCount > MAX_XLSX_SELECTED_CELLS) {
      ownerRef.current.publish({
        resourceAddress,
        root: rootRef.current,
        sheet: activeSheetName,
        range: parsed.range,
        values: [],
        cellCount: parsed.cellCount,
        rect: null,
      })
      return
    }

    let cancelled = false

    async function fetchValuesAndPublish() {
      const rows: string[][] = []
      for (let r = parsed!.startRowIndex; r <= parsed!.endRowIndex; r += 1) {
        const rowVals: string[] = []
        for (let c = parsed!.startColIndex; c <= parsed!.endColIndex; c += 1) {
          let val = ''
          if (typeof controller.getCellSnapshotAsync === 'function') {
            try {
              const snap = await controller.getCellSnapshotAsync(sheetIndex, r, c)
              val = snap?.displayValue ?? ''
            } catch {
              val = controller.getCellDisplayValue({ row: r, col: c }) ?? ''
            }
          } else {
            val = controller.getCellDisplayValue({ row: r, col: c }) ?? ''
          }
          rowVals.push(val)
        }
        rows.push(rowVals)
      }

      if (!cancelled && ownerRef.current && rootRef.current) {
        ownerRef.current.publish({
          resourceAddress,
          root: rootRef.current,
          sheet: activeSheetName,
          range: parsed!.range,
          values: rows,
          cellCount: parsed!.cellCount,
          rect: null,
        })
      }
    }

    void fetchValuesAndPublish()

    return () => {
      cancelled = true
    }
  }, [
    selection,
    selectedRangeAddress,
    activeSheetName,
    sheetIndex,
    controller,
    resourceAddress,
    rootRef,
    onSelectionChange,
  ])

  return null
}

/**
 * XLSX Workbook Viewer Body Component.
 */
export function XlsxBody(props: XlsxBodyProps): JSX.Element {
  const { content, resourceAddress, bridge } = props
  const rootRef = useRef<HTMLElement | null>(null)
  const [loadState, setLoadState] = useState<XlsxLoadState>({ kind: 'checking' })
  const [publishedSelection, setPublishedSelection] = useState<string | null>(null)

  const bytes = content?.kind === 'bytes' ? content.data : null
  const fileName = fileNameFromResourceAddress(resourceAddress) ?? 'workbook.xlsx'

  // A new resource generation starts with no selection of its own. Clearing here
  // rather than only on unmount keeps the published observable from describing
  // the previous workbook between the switch and the first gesture on the new
  // one — the window in which a stale range would otherwise look current.
  useEffect(() => {
    setPublishedSelection(null)
  }, [resourceAddress])

  useEffect(() => {
    if (!bytes) {
      setLoadState({ kind: 'failed', message: NO_BYTES_TEXT })
      return
    }

    if (bytes.byteLength > MAX_XLSX_FILE_SIZE_BYTES) {
      setLoadState({ kind: 'too-large' })
      return
    }

    let cancelled = false
    const abortController = new AbortController()
    const { signal } = abortController

    async function runSecurityGates() {
      try {
        setLoadState({ kind: 'checking' })

        // One defensive copy per resource generation. Every gate below, and the
        // third-party viewer, read this array and nothing else: the host's own
        // bytes are never consulted again, so a host that reuses or mutates its
        // buffer cannot change what was validated. The copy is `Uint8Array`
        // over its own `ArrayBuffer`, which is why `validated.buffer` can be
        // handed to the viewer unchanged.
        const validated = new Uint8Array(
          bytes!.buffer.slice(bytes!.byteOffset, bytes!.byteOffset + bytes!.byteLength),
        )

        // Strictly serial. Each gate is awaited with the caller's own signal so
        // that releasing the tab interrupts metadata preflight, extraction
        // verification and the relationship scan alike — none of them may still
        // be reading an archive whose owner has gone. Nothing after a gate may
        // begin before it settles: a metadata gate that runs concurrently with
        // the content it is gating is not a gate.
        await preflightOoxml(validated, DEFAULT_OOXML_LIMITS, signal)
        if (signal.aborted || cancelled) return

        await verifyOoxmlExtraction(validated, DEFAULT_OOXML_LIMITS, signal)
        if (signal.aborted || cancelled) return

        await assertSafeXlsxRelationships(validated, signal)
        if (signal.aborted || cancelled) return

        // The engine is installed here, after every security gate has accepted
        // the archive and before the third-party viewer is mounted. It is a
        // session-level initialization — the embedded payload is decoded,
        // inflated and SHA-256 verified once, reused by every later workbook —
        // and it is awaited under the same signal, so a released tab stops
        // waiting immediately without cancelling work the session still needs.
        // A payload that does not reproduce the exact reviewed binary throws
        // rather than reaching for a URL, a host route or a CDN.
        await ensureXlsxWasmInitialized(signal)
        if (signal.aborted || cancelled) return

        if (!cancelled) {
          setLoadState({ kind: 'ready', file: validated.buffer })
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setLoadState({ kind: 'failed', message: failureMessage(error) })
        }
      }
    }

    void runSecurityGates()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [bytes, resourceAddress])

  if (!bytes) {
    return (
      <section
        {...{ [XLSX_DOCUMENT_KIND_ATTRIBUTE]: XLSX_DOCUMENT_KIND }}
        {...{ [XLSX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
        className="dsa-xlsx-status"
      >
        <p>{NO_BYTES_TEXT}</p>
      </section>
    )
  }

  if (loadState.kind === 'checking') {
    return (
      <section
        {...{ [XLSX_DOCUMENT_KIND_ATTRIBUTE]: XLSX_DOCUMENT_KIND }}
        {...{ [XLSX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
        className="dsa-xlsx-status"
      >
        <p>{LOADING_TEXT}</p>
      </section>
    )
  }

  if (loadState.kind === 'too-large') {
    return (
      <section
        {...{ [XLSX_DOCUMENT_KIND_ATTRIBUTE]: XLSX_DOCUMENT_KIND }}
        {...{ [XLSX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
        className="dsa-xlsx-status dsa-xlsx-error"
      >
        <p>{TOO_LARGE_TEXT}</p>
      </section>
    )
  }

  if (loadState.kind === 'failed') {
    return (
      <section
        {...{ [XLSX_DOCUMENT_KIND_ATTRIBUTE]: XLSX_DOCUMENT_KIND }}
        {...{ [XLSX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
        className="dsa-xlsx-status dsa-xlsx-error"
      >
        <p>{loadState.message}</p>
      </section>
    )
  }

  // Ready: Mount XlsxViewerProvider with worker and readOnly enabled
  return (
    <section
      ref={rootRef}
      {...{ [XLSX_DOCUMENT_KIND_ATTRIBUTE]: XLSX_DOCUMENT_KIND }}
      {...{ [XLSX_RESOURCE_ADDRESS_ATTRIBUTE]: resourceAddress }}
      {...(publishedSelection === null
        ? {}
        : { [XLSX_SELECTION_ATTRIBUTE]: publishedSelection })}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div
        {...{ [XLSX_SELECTABLE_ATTRIBUTE]: '' }}
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}
      >
        <XlsxViewerProvider
          file={loadState.file}
          fileName={fileName}
          readOnly={true}
          useWorker={true}
          allowResizeInReadOnly={false}
          maxFileSizeBytes={MAX_XLSX_FILE_SIZE_BYTES}
        >
          <XlsxSelectionPublisher
            bridge={bridge}
            resourceAddress={resourceAddress}
            rootRef={rootRef}
            onSelectionChange={setPublishedSelection}
          />
          <XlsxSheetTabs />
          <XlsxViewer
            readOnly={true}
            useWorker={true}
            showDefaultToolbar={false}
            allowResizeInReadOnly={false}
            experimentalCanvas={true}
            renderFormControl={() => null}
            height="100%"
          />
        </XlsxViewerProvider>
      </div>
    </section>
  )
}
