// @vitest-environment jsdom
/**
 * XLSX renderer specification.
 *
 * Two layers are asserted here, and they are deliberately in one file because
 * the second layer exists to constrain the first.
 *
 * The **public API** layer drives `@extend-ai/react-xlsx` itself: the displayed
 * values the plugin quotes come from the library's own formatted-value surface,
 * and this suite is what proves the workbook fixtures carry the formulas,
 * currencies, percentages and dates the browser smoke asserts on.
 *
 * The **security pipeline** layer drives `XlsxBody` with its three archive gates
 * and its engine initialization replaced by controllable doubles. The properties
 * under test are orderings and identities, which no assertion on a rendered result
 * can distinguish: a fire-and-forget preflight and an awaited one both end with a
 * rendered grid, and a viewer handed a second copy of the host's bytes and one
 * handed the validated copy both display the same workbook. The suite therefore
 * observes the pipeline's own sequence — which step ran, in what order, on which
 * buffer, under which signal — rather than its output.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act } from 'react'
import { createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initWasm, type XlsxImageRenderProps, type XlsxViewerController } from '@extend-ai/react-xlsx'

import { createXlsxSelectionBridge } from '../../src/client/renderers/xlsx/selection-bridge.js'
import { XlsxBody, type XlsxBodyProps } from '../../src/client/renderers/xlsx/XlsxBody.js'
import { mountTree, type MountedTree } from './helpers/react-mount.js'

/** One gate invocation, as the doubles recorded it. */
interface GateCall {
  readonly bytes: Uint8Array
  readonly limits: unknown
  readonly signal: AbortSignal | undefined
}

/**
 * The pipeline observatory.
 *
 * `vi.hoisted` is what makes this reachable from the module factories below:
 * `vi.mock` calls are hoisted above the imports, so a factory closing over an
 * ordinary module-level binding would capture it before initialisation.
 */
const pipeline = vi.hoisted(() => {
  /**
   * The typed refusals the engine gate raises. Declared here rather than inside
   * the module factory so a spec can raise the same types the production code
   * branches on.
   */
  class XlsxWasmSourceUnavailableError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'XlsxWasmSourceUnavailableError'
    }
  }

  /** Raised when the embedded engine payload does not reproduce the reviewed binary. */
  class XlsxWasmIntegrityError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'XlsxWasmIntegrityError'
    }
  }

  const calls = {
    preflight: [] as GateCall[],
    verify: [] as GateCall[],
    relationships: [] as GateCall[],
    wasmInit: 0,
    viewerFiles: [] as ArrayBuffer[],
    viewerProps: [] as Array<Record<string, unknown>>,
    log: [] as string[],
  }

  /**
   * The controller the viewer hook resolves to.
   *
   * Mutable so a spec can state the selection the renderer is being asked to
   * publish, and read through the hook at call time rather than captured, so a
   * spec's value is the one the component sees.
   */
  const viewer = {
    selection: null as unknown,
    selectedRangeAddress: null as string | null,
    activeSheet: null as { name: string; workbookSheetIndex: number } | null,
    tabs: [] as unknown[],
    activeTabIndex: 0,
    getCellDisplayValue: (): string => '',
    setActiveTabIndex: (): void => undefined,
  }

  return {
    calls,
    viewer,
    XlsxWasmSourceUnavailableError,
    XlsxWasmIntegrityError,
    preflight: null as null | ((call: GateCall) => Promise<void>),
    verify: null as null | ((call: GateCall) => Promise<void>),
    relationships: null as null | ((call: GateCall) => Promise<void>),
    wasm: null as null | ((signal?: AbortSignal) => void | Promise<void>),
    reset(): void {
      calls.preflight.length = 0
      calls.verify.length = 0
      calls.relationships.length = 0
      calls.wasmInit = 0
      calls.viewerFiles.length = 0
      calls.viewerProps.length = 0
      calls.log.length = 0
      pipeline.preflight = null
      pipeline.verify = null
      pipeline.relationships = null
      pipeline.wasm = null
      viewer.selection = null
      viewer.selectedRangeAddress = null
      viewer.activeSheet = null
    },
  }
})

vi.mock('../../src/client/ooxml/preflight.js', () => ({
  preflightOoxml: async (bytes: Uint8Array, limits: unknown, signal?: AbortSignal) => {
    const call: GateCall = { bytes, limits, signal }
    pipeline.calls.preflight.push(call)
    pipeline.calls.log.push('preflight:start')
    if (pipeline.preflight) await pipeline.preflight(call)
    pipeline.calls.log.push('preflight:end')
  },
}))

vi.mock('../../src/client/ooxml/verify-extraction.js', () => ({
  verifyOoxmlExtraction: async (bytes: Uint8Array, limits: unknown, signal?: AbortSignal) => {
    const call: GateCall = { bytes, limits, signal }
    pipeline.calls.verify.push(call)
    pipeline.calls.log.push('verify')
    if (pipeline.verify) await pipeline.verify(call)
  },
}))

vi.mock('../../src/client/renderers/xlsx/security.js', () => ({
  XlsxRelationshipSecurityError: class extends Error {},
  assertSafeXlsxRelationships: async (bytes: Uint8Array, signal?: AbortSignal) => {
    const call: GateCall = { bytes, limits: undefined, signal }
    pipeline.calls.relationships.push(call)
    pipeline.calls.log.push('relationships')
    if (pipeline.relationships) await pipeline.relationships(call)
  },
}))

vi.mock('../../src/client/renderers/xlsx/wasm.js', () => ({
  XlsxWasmSourceUnavailableError: pipeline.XlsxWasmSourceUnavailableError,
  XlsxWasmIntegrityError: pipeline.XlsxWasmIntegrityError,
  ensureXlsxWasmInitialized: async (signal?: AbortSignal) => {
    pipeline.calls.wasmInit += 1
    pipeline.calls.log.push('wasm:start')
    if (pipeline.wasm) await pipeline.wasm(signal)
    pipeline.calls.log.push('wasm:end')
  },
}))

/**
 * The viewer double.
 *
 * `XlsxViewerProvider` records the exact `ArrayBuffer` it was handed. That
 * identity is the whole point: the property under test is that the bytes the
 * viewer parses are the bytes the gates validated, not a fresh read of the
 * host's array.
 *
 * `XlsxViewer` records the props it was configured with, because two of them —
 * `showImages` and `renderImage` — decide whether an embedded worksheet picture
 * reaches the document at all, and neither is observable from a rendered grid.
 */
vi.mock('@extend-ai/react-xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@extend-ai/react-xlsx')>()

  return {
    ...actual,
    XlsxViewerProvider: (props: { file: ArrayBuffer; children?: unknown }) => {
      pipeline.calls.viewerFiles.push(props.file)
      return createElement(
        'div',
        { 'data-stub-viewer-provider': '' },
        props.children as never,
      )
    },
    XlsxViewer: (props: Record<string, unknown>) => {
      pipeline.calls.viewerProps.push(props)
      return createElement('div', { 'data-stub-viewer': '' })
    },
    useXlsxViewer: () => pipeline.viewer as unknown as XlsxViewerController,
  }
})

describe('XLSX Public API Displayed Values Integration', () => {
  beforeAll(async () => {
    const wasmPath = resolve(
      process.cwd(),
      'node_modules/@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm',
    )
    const wasmBytes = new Uint8Array(readFileSync(wasmPath))
    await initWasm(wasmBytes.buffer)
  })

  it('retrieves calculated and formatted displayed values from formula-values.xlsx via public API', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/formula-values.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    expect(wb.sheetCount).toBe(1)
    const sheet = wb.getSheet(0)
    expect(sheet.name).toBe('Sheet1')

    // Formula cell: A3 is row 2, col 0
    const a3Formula = sheet.getFormulaAt(2, 0)
    const a3Display = sheet.getFormattedValueAt(2, 0)
    expect(a3Formula).toBe('=SUM(A1:A2)')
    expect(a3Display).toBe('30') // Must be calculated result 30, not formula string alone

    // Currency cell: B1 is row 0, col 1
    const b1Display = sheet.getFormattedValueAt(0, 1)
    expect(b1Display).toBe('$1,234.50')

    // Percentage cell: B2 is row 1, col 1
    const b2Display = sheet.getFormattedValueAt(1, 1)
    expect(b2Display).toBe('12.5%')

    // Date cell: B3 is row 2, col 1
    const b3Display = sheet.getFormattedValueAt(2, 1)
    expect(b3Display).toBe('2026-09-18')
  })

  it('reads simple.xlsx table structure via public API', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/simple.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    const sheet = wb.getSheet(0)
    expect(sheet.name).toBe('Sheet1')

    // Row 0: Name, Qty, Price
    expect(sheet.getFormattedValueAt(0, 0)).toBe('Name')
    expect(sheet.getFormattedValueAt(0, 1)).toBe('Qty')
    expect(sheet.getFormattedValueAt(0, 2)).toBe('Price')

    // Row 1: Apple, 2, 3.50
    expect(sheet.getFormattedValueAt(1, 0)).toBe('Apple')
    expect(sheet.getFormattedValueAt(1, 1)).toBe('2')
    expect(sheet.getFormattedValueAt(1, 2)).toBe('3.50')

    // Row 3: 中文, 6, 1.00
    expect(sheet.getFormattedValueAt(3, 0)).toBe('中文')
    expect(sheet.getFormattedValueAt(3, 1)).toBe('6')
    expect(sheet.getFormattedValueAt(3, 2)).toBe('1.00')
  })

  it('reads sheet names with spaces and Unicode from multi-sheet.xlsx', async () => {
    const filePath = resolve(process.cwd(), 'tests/fixtures/xlsx/multi-sheet.xlsx')
    const fileBytes = new Uint8Array(readFileSync(filePath))

    const duke = await initWasm()
    const wb = duke.Workbook.fromBytes(fileBytes)
    expect(wb.sheetCount).toBe(3)
    expect(wb.getSheet(0).name).toBe('Summary')
    expect(wb.getSheet(1).name).toBe('Data 2026')
    expect(wb.getSheet(2).name).toBe('中文表')
  })
})

/** A pending gate the test settles by hand. */
interface Gate {
  readonly promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
}

/**
 * Create a promise the test settles explicitly, so the pipeline's ordering is
 * observed at a chosen instant rather than after a delay.
 * @returns the gate.
 */
function createGate(): Gate {
  let settleResolve!: () => void
  let settleReject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    settleResolve = () => {
      resolvePromise()
    }
    settleReject = (error: unknown) => {
      rejectPromise(error)
    }
  })
  // The gate is consumed by the production pipeline, which handles the
  // rejection; this handler exists only for the cases where the test rejects a
  // gate the pipeline is no longer awaiting.
  promise.catch(() => undefined)
  return { promise, resolve: settleResolve, reject: settleReject }
}

/** Host bytes for the simple workbook, read once. */
const SIMPLE_BYTES = new Uint8Array(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/xlsx/simple.xlsx')),
)

/** Collect the rejections Node would otherwise report as unhandled. */
function watchUnhandledRejections(): { seen: unknown[]; stop(): void } {
  const seen: unknown[] = []
  const listener = (reason: unknown): void => {
    seen.push(reason)
  }
  process.on('unhandledRejection', listener)
  return {
    seen,
    stop(): void {
      process.off('unhandledRejection', listener)
    },
  }
}

/**
 * Flush pending microtasks inside React's act queue.
 * @returns nothing.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolveTick) => {
      setTimeout(resolveTick, 0)
    })
  })
}

describe('XlsxBody security pipeline', () => {
  let trees: MountedTree[] = []

  beforeEach(() => {
    pipeline.reset()
  })

  afterEach(() => {
    for (const tree of trees) tree.unmount()
    trees = []
  })

  /**
   * Mount the body over a host-owned byte array.
   * @param hostBytes - the array the host owns and may mutate.
   * @returns the mounted tree and the host array it was given.
   */
  function mountBody(hostBytes: Uint8Array<ArrayBuffer>): MountedTree {
    const bridge = createXlsxSelectionBridge()
    // One signal per mounted body: the body's effects are keyed on the tab's
    // lifetime, so a stub minting a fresh signal per call would re-run them on
    // every render.
    const signal = new AbortController().signal
    const props = {
      resourceAddress: 'dsh-resource://file/session/s1/smoke-fixtures/task11-simple.xlsx',
      content: { kind: 'bytes', data: hostBytes },
      wrap: false,
      scrollportRef: () => undefined,
      // The tab reader is a published standard prop of every document body, and
      // since Task 12 the body reads it to invalidate its resource-scoped
      // selection when the tab is released.
      useTabInfo: () => ({ tab: { signal } }),
      bridge,
    } as unknown as XlsxBodyProps

    const tree = mountTree(createElement(XlsxBody, props))
    trees.push(tree)
    return tree
  }

  it('does not start extraction verification while metadata preflight is pending', async () => {
    const preflightGate = createGate()
    pipeline.preflight = () => preflightGate.promise

    mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    expect(pipeline.calls.log).toEqual(['preflight:start'])
    expect(pipeline.calls.verify).toHaveLength(0)
    expect(pipeline.calls.relationships).toHaveLength(0)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(pipeline.calls.wasmInit).toBe(0)
  })

  it('runs preflight, extraction verification and relationship scan strictly in that order', async () => {
    const preflightGate = createGate()
    const verifyGate = createGate()
    const relationshipGate = createGate()
    pipeline.preflight = () => preflightGate.promise
    pipeline.verify = () => verifyGate.promise
    pipeline.relationships = () => relationshipGate.promise

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    expect(pipeline.calls.log).toEqual(['preflight:start'])

    preflightGate.resolve()
    await settle()
    expect(pipeline.calls.log).toEqual(['preflight:start', 'preflight:end', 'verify'])
    expect(pipeline.calls.relationships).toHaveLength(0)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)

    verifyGate.resolve()
    await settle()
    expect(pipeline.calls.log).toEqual([
      'preflight:start',
      'preflight:end',
      'verify',
      'relationships',
    ])
    expect(pipeline.calls.viewerFiles).toHaveLength(0)

    relationshipGate.resolve()
    await settle()
    expect(pipeline.calls.viewerFiles).toHaveLength(1)
    expect(tree.container.querySelector('[data-stub-viewer]')).not.toBeNull()
  })

  it('never reaches extraction verification or the viewer when preflight refuses the archive', async () => {
    const refuse = new Error('preflight refused the archive')
    const unhandled = watchUnhandledRejections()
    pipeline.preflight = async () => {
      throw refuse
    }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    unhandled.stop()

    expect(pipeline.calls.verify).toHaveLength(0)
    expect(pipeline.calls.relationships).toHaveLength(0)
    expect(pipeline.calls.wasmInit).toBe(0)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(tree.container.querySelector('[data-stub-viewer-provider]')).toBeNull()
    expect(tree.container.textContent).toContain('无法显示文档')
    expect(unhandled.seen).toEqual([])
  })

  it('hands every gate and the viewer one lifecycle AbortSignal', async () => {
    const preflightGate = createGate()
    pipeline.preflight = () => preflightGate.promise

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    const signal = pipeline.calls.preflight[0]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    tree.unmount()

    // Releasing the tab aborts the signal the preflight was started under, so a
    // preflight still reading the central directory stops with it.
    expect(signal?.aborted).toBe(true)
  })

  it('runs the later gates under the same signal the preflight received', async () => {
    const preflightGate = createGate()
    pipeline.preflight = () => preflightGate.promise

    mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    preflightGate.resolve()
    await settle()

    const preflightSignal = pipeline.calls.preflight[0]?.signal
    expect(preflightSignal).toBeInstanceOf(AbortSignal)
    expect(pipeline.calls.verify[0]?.signal).toBe(preflightSignal)
    expect(pipeline.calls.relationships[0]?.signal).toBe(preflightSignal)
  })

  it('does not continue past a gate when the tab is released while preflight is pending', async () => {
    const preflightGate = createGate()
    pipeline.preflight = () => preflightGate.promise

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    expect(pipeline.calls.preflight).toHaveLength(1)

    tree.unmount()
    preflightGate.resolve()
    await settle()

    expect(pipeline.calls.verify).toHaveLength(0)
    expect(pipeline.calls.relationships).toHaveLength(0)
    expect(pipeline.calls.wasmInit).toBe(0)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
  })

  it('passes one defensive copy to every gate and to the viewer', async () => {
    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    const validated = pipeline.calls.preflight[0]?.bytes
    expect(validated).toBeInstanceOf(Uint8Array)
    expect(pipeline.calls.verify[0]?.bytes).toBe(validated)
    expect(pipeline.calls.relationships[0]?.bytes).toBe(validated)
    expect(pipeline.calls.viewerFiles[0]).toBe(validated?.buffer)
    expect(tree.container.querySelector('[data-stub-viewer]')).not.toBeNull()
  })

  it('keeps the validated bytes when the host mutates its own array after the copy', async () => {
    const hostBytes = new Uint8Array(SIMPLE_BYTES)
    const expected = new Uint8Array(SIMPLE_BYTES)

    // The mutation is placed deterministically: it happens inside the first
    // gate, which is after the defensive copy was taken and before any later
    // gate or the viewer reads the bytes. No sleep is involved.
    let copySeen: Uint8Array | undefined
    pipeline.preflight = async (call) => {
      copySeen = call.bytes
      hostBytes.fill(0x00)
    }

    mountBody(hostBytes)
    await settle()

    expect(copySeen).toBeDefined()
    expect(copySeen?.buffer).not.toBe(hostBytes.buffer)
    expect(pipeline.calls.verify[0]?.bytes).toBe(copySeen)
    expect(pipeline.calls.relationships[0]?.bytes).toBe(copySeen)

    const file = pipeline.calls.viewerFiles[0]
    expect(file).toBe(copySeen?.buffer)
    expect(new Uint8Array(file as ArrayBuffer)).toEqual(expected)
  })

  it('does not publish a viewer when the relationship scan rejects', async () => {
    const unhandled = watchUnhandledRejections()
    pipeline.relationships = async () => {
      throw new Error('relationship scan refused the archive')
    }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    unhandled.stop()

    expect(pipeline.calls.relationships).toHaveLength(1)
    expect(pipeline.calls.wasmInit).toBe(0)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(tree.container.querySelector('[data-stub-viewer-provider]')).toBeNull()
    expect(tree.container.textContent).toContain('无法显示文档')
    expect(unhandled.seen).toEqual([])
  })

  it('reports the blocked engine-binary state instead of mounting a viewer', async () => {
    // The architecture having no engine source at all is a state the product has
    // to be able to show, not one it may paper over: no viewer is mounted, no
    // worker is asked for, and the message names the engine rather than the file.
    const unhandled = watchUnhandledRejections()
    pipeline.wasm = () => {
      throw new pipeline.XlsxWasmSourceUnavailableError('no client-owned engine binary')
    }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    unhandled.stop()

    expect(pipeline.calls.wasmInit).toBe(1)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(tree.container.querySelector('[data-stub-viewer-provider]')).toBeNull()
    expect(tree.container.textContent).toContain('无法加载')
    expect(tree.container.textContent).not.toContain('无法显示文档')
    expect(unhandled.seen).toEqual([])
  })

  it('reports a failed engine integrity check instead of mounting a viewer', async () => {
    // The embedded payload not reproducing the reviewed binary is the failure the
    // client-inline architecture can actually produce, and it fails closed in the
    // same place: the viewer is never reached, and the message names the engine
    // rather than reporting a workbook that simply would not open.
    const unhandled = watchUnhandledRejections()
    pipeline.wasm = () => {
      throw new pipeline.XlsxWasmIntegrityError('the embedded payload hashes to something else')
    }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    unhandled.stop()

    expect(pipeline.calls.wasmInit).toBe(1)
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(tree.container.querySelector('[data-stub-viewer-provider]')).toBeNull()
    expect(tree.container.textContent).toContain('完整性校验失败')
    expect(tree.container.textContent).not.toContain('无法显示文档')
    expect(unhandled.seen).toEqual([])
  })

  it('does not mount the viewer while the engine payload is still being prepared', async () => {
    // The engine gate is awaited between the relationship scan and the mount, so a
    // payload still inflating is a viewer that does not exist yet — not a viewer
    // mounted against an engine that has not been installed.
    const preflightGate = createGate()
    const verifyGate = createGate()
    const relationshipGate = createGate()
    const engineGate = createGate()
    pipeline.preflight = () => preflightGate.promise
    pipeline.verify = () => verifyGate.promise
    pipeline.relationships = () => relationshipGate.promise
    pipeline.wasm = () => engineGate.promise

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    preflightGate.resolve()
    await settle()
    verifyGate.resolve()
    await settle()
    relationshipGate.resolve()
    await settle()

    expect(pipeline.calls.log).toEqual([
      'preflight:start',
      'preflight:end',
      'verify',
      'relationships',
      'wasm:start',
    ])
    expect(pipeline.calls.viewerFiles).toHaveLength(0)
    expect(tree.container.querySelector('[data-stub-viewer-provider]')).toBeNull()

    engineGate.resolve()
    await settle()

    expect(pipeline.calls.viewerFiles).toHaveLength(1)
    expect(tree.container.querySelector('[data-stub-viewer]')).not.toBeNull()
  })

  it('hands the engine gate the tab signal the other gates received', async () => {
    const preflightGate = createGate()
    pipeline.preflight = () => preflightGate.promise
    let engineSignal: AbortSignal | undefined
    pipeline.wasm = (signal) => {
      engineSignal = signal
    }

    mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()
    preflightGate.resolve()
    await settle()

    const preflightSignal = pipeline.calls.preflight[0]?.signal
    expect(preflightSignal).toBeInstanceOf(AbortSignal)
    expect(engineSignal).toBe(preflightSignal)
  })

  it('publishes the current semantic selection on the renderer root', async () => {
    // `<sheet>!<range>` is the pair the adapter turns into provenance, so an
    // observer reading this attribute sees the range Ask would quote.
    pipeline.viewer.selection = { anchor: { row: 0, col: 0 }, focus: { row: 2, col: 2 } }
    pipeline.viewer.selectedRangeAddress = 'A1:C3'
    pipeline.viewer.activeSheet = { name: 'Sheet1', workbookSheetIndex: 0 }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    const root = tree.container.querySelector('[data-dsa-document-kind="xlsx"]')
    expect(root?.getAttribute('data-dsa-xlsx-selection')).toBe('Sheet1!A1:C3')
  })

  it('omits the published selection when nothing is selected', async () => {
    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    const root = tree.container.querySelector('[data-dsa-document-kind="xlsx"]')
    expect(root).not.toBeNull()
    expect(root?.hasAttribute('data-dsa-xlsx-selection')).toBe(false)
  })

  it('omits the published selection when the selected range address is unparsable', async () => {
    pipeline.viewer.selection = { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } }
    pipeline.viewer.selectedRangeAddress = 'not-a-range'
    pipeline.viewer.activeSheet = { name: 'Sheet1', workbookSheetIndex: 0 }

    const tree = mountBody(new Uint8Array(SIMPLE_BYTES))
    await settle()

    const root = tree.container.querySelector('[data-dsa-document-kind="xlsx"]')
    expect(root?.hasAttribute('data-dsa-xlsx-selection')).toBe(false)
  })
})

/**
 * The presentation configuration `XlsxBody` gives the pinned viewer.
 *
 * These two props are the whole of the embedded-image remediation, and neither is
 * observable from a rendered grid: `showImages` decides whether worksheet
 * drawings are published at all, and `renderImage` decides whether an image is
 * baked into the sheet canvas or handed to a node the plugin owns. The stub
 * viewer above therefore records the props it received, and the cases below
 * assert the configuration and then drive the recorded hook with a
 * public-shaped `XlsxImageRenderProps` to state what the replacement node is.
 *
 * The same hook is driven end to end, over the real fixture and the real
 * pipeline, by `tests/client/xlsx-image-render.client.spec.tsx`.
 */
describe('XLSX embedded image presentation configuration', () => {
  let trees: MountedTree[] = []

  beforeEach(() => {
    pipeline.reset()
  })

  afterEach(() => {
    for (const tree of trees) tree.unmount()
    trees = []
  })

  /**
   * Mount the production body over the simple workbook.
   * @returns the mounted tree.
   */
  function mountBody(): MountedTree {
    const bridge = createXlsxSelectionBridge()
    // One signal per mounted body: the body's effects are keyed on the tab's
    // lifetime, so a stub minting a fresh signal per call would re-run them on
    // every render.
    const signal = new AbortController().signal
    const props = {
      resourceAddress: 'dsh-resource://file/session/s1/smoke-fixtures/task11-simple.xlsx',
      content: { kind: 'bytes', data: new Uint8Array(SIMPLE_BYTES) },
      wrap: false,
      scrollportRef: () => undefined,
      // The tab reader every document body receives as a standard prop; the body
      // reads it to invalidate its resource-scoped selection when the tab is
      // released.
      useTabInfo: () => ({ tab: { signal } }),
      bridge,
    } as unknown as XlsxBodyProps

    const tree = mountTree(createElement(XlsxBody, props))
    trees.push(tree)
    return tree
  }

  /** The viewer props the production body published, once it reached the viewer. */
  function configuredViewer(): Record<string, unknown> {
    const props = pipeline.calls.viewerProps.at(-1)
    if (props === undefined) throw new Error('the production body did not mount the viewer')
    return props
  }

  it('enables worksheet images and replaces their rendering through the documented hook', async () => {
    mountBody()
    await settle()

    const props = configuredViewer()

    // Explicit rather than inherited: the default is documented as `true`, and a
    // renderer that published no drawings would otherwise be indistinguishable
    // from one configured to publish them.
    expect(props['showImages']).toBe(true)
    expect(typeof props['renderImage']).toBe('function')

    // Read-only presentation is unchanged, and no mutation surface is added: the
    // resize-handle hook the library offers alongside `renderImage` is not used,
    // and the workbook stays non-editable in both places it can be set.
    expect(props['readOnly']).toBe(true)
    expect(props['allowResizeInReadOnly']).toBe(false)
    expect(props['renderImageSelection']).toBeUndefined()
    expect(configuredViewer()).not.toHaveProperty('updateImage')
  })

  it('builds a non-draggable marker image from the viewer’s own source and box', async () => {
    mountBody()
    await settle()

    const renderImage = configuredViewer()['renderImage'] as (
      props: XlsxImageRenderProps,
    ) => React.ReactElement

    // A public-shaped callback argument: the model entry, rectangle and style the
    // viewer computes, as the installed typings describe them.
    const element = renderImage({
      defaultNode: createElement('img', { src: 'blob:upstream-default' }),
      image: {
        anchor: { from: { col: 3, colOffsetEmu: 0, row: 1, rowOffsetEmu: 0 }, kind: 'one-cell', sizeEmu: { cx: 609600, cy: 609600 } },
        description: 'Embedded picture',
        id: 'worksheet-image-0-1',
        mediaPath: 'xl/media/image1.png',
        mimeType: 'image/png',
        name: 'Picture 1',
        sheetIndex: 0,
        src: 'blob:viewer-owned-resource',
        workbookSheetIndex: 0,
        zIndex: 1,
      },
      rect: { height: 64, left: 232, top: 44, width: 64 },
      style: {
        contain: 'layout paint',
        height: 64,
        left: 232,
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'absolute',
        top: 44,
        width: 64,
        zIndex: 1,
      },
    })

    const tree = mountTree(element)
    trees.push(tree)

    const image = tree.container.querySelector('img[data-dsa-xlsx-image]')
    expect(image).not.toBeNull()

    // The source is consumed, not re-derived: no object URL of the plugin's own,
    // no fetch, no re-encoding of the media bytes.
    expect(image?.getAttribute('src')).toBe('blob:viewer-owned-resource')

    // The accessible name comes from the workbook's own metadata.
    expect(image?.getAttribute('alt')).toBe('Embedded picture')

    // Read-only: the node carries no drag affordance.
    expect(image?.getAttribute('draggable')).toBe('false')
    expect(image?.outerHTML ?? '').not.toContain('blob:upstream-default')

    // The box is the viewer's calculation, consumed rather than recomputed: width
    // and height are the rectangle it published, not a value derived from the
    // anchor.
    const style = (image as HTMLElement).style
    expect(style.width).toBe('64px')
    expect(style.height).toBe('64px')
    expect(style.objectFit).toBe('contain')
  })

  it('falls back to the image name when the workbook carries no description', async () => {
    mountBody()
    await settle()

    const renderImage = configuredViewer()['renderImage'] as (
      props: XlsxImageRenderProps,
    ) => React.ReactElement

    const element = renderImage({
      defaultNode: null,
      image: {
        anchor: {
          from: { col: 0, colOffsetEmu: 0, row: 0, rowOffsetEmu: 0 },
          kind: 'one-cell',
          sizeEmu: { cx: 1, cy: 1 },
        },
        id: 'worksheet-image-0-1',
        mimeType: 'image/png',
        name: 'Picture 1',
        sheetIndex: 0,
        src: 'blob:viewer-owned-resource',
        workbookSheetIndex: 0,
        zIndex: 1,
      },
      rect: { height: 10, left: 0, top: 0, width: 10 },
      style: { height: 10, left: 0, position: 'absolute', top: 0, width: 10, zIndex: 1 },
    })

    const tree = mountTree(element)
    trees.push(tree)

    expect(tree.container.querySelector('img[data-dsa-xlsx-image]')?.getAttribute('alt')).toBe(
      'Picture 1',
    )
  })
})
