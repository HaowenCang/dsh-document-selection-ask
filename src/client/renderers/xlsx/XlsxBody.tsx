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
} from './identity.js'
import { assertSafeXlsxRelationships } from './security.js'
import type { XlsxSelectionBridge, XlsxSelectionOwner } from './selection-bridge.js'
import { ensureXlsxWasmInitialized } from './wasm.js'
import { XlsxSheetTabs } from './XlsxSheetTabs.js'

/** Maximum supported XLSX file size (25 MiB limit). */
export const MAX_XLSX_FILE_SIZE_BYTES = 25 * 1024 * 1024

const LOADING_TEXT = '正在打开表格…'
const FAILED_TEXT = '无法显示电子表格'
const TOO_LARGE_TEXT = '文件超出支持的大小限制（最大 25 MB）'
const NO_BYTES_TEXT = 'XLSX 预览需要完整文件内容。'

export interface XlsxBodyProps extends DocumentPreviewProps {
  readonly bridge: XlsxSelectionBridge
}

type XlsxLoadState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready' }
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
}: {
  bridge: XlsxSelectionBridge
  resourceAddress: string
  rootRef: React.RefObject<HTMLElement | null>
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
      return
    }

    const parsed = parseCellRange(selectedRangeAddress)
    if (!parsed) {
      ownerRef.current.clear()
      return
    }

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

  const bytes = content?.kind === 'bytes' ? content.data : null
  const fileName = fileNameFromResourceAddress(resourceAddress) ?? 'workbook.xlsx'

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

        // Defensive copy of buffer before untrusted third-party consumption
        const copy = new Uint8Array(bytes!.buffer.slice(bytes!.byteOffset, bytes!.byteOffset + bytes!.byteLength))

        // Preflight & extraction verification
        preflightOoxml(copy, DEFAULT_OOXML_LIMITS)
        if (signal.aborted || cancelled) return

        await verifyOoxmlExtraction(copy, DEFAULT_OOXML_LIMITS, signal)
        if (signal.aborted || cancelled) return

        await assertSafeXlsxRelationships(copy, signal)
        if (signal.aborted || cancelled) return

        ensureXlsxWasmInitialized()

        if (!cancelled) {
          setLoadState({ kind: 'ready' })
        }
      } catch {
        if (!cancelled) {
          setLoadState({ kind: 'failed', message: FAILED_TEXT })
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
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div
        {...{ [XLSX_SELECTABLE_ATTRIBUTE]: '' }}
        style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}
      >
        <XlsxViewerProvider
          file={bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)}
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
