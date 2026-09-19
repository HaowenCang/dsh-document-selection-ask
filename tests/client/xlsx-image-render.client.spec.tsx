// @vitest-environment jsdom
/**
 * XLSX embedded-image rendering specification.
 *
 * ## What this suite is about
 *
 * `chart-image.xlsx` carries a 64x64 solid-red PNG in `xl/media` and a chart
 * part. The image is asserted from two public surfaces that can fail
 * independently: the library's own **public image model** as the controller
 * publishes it, and the DOM node the plugin's replacement renderer produces.
 * Neither is inferred from the other, and neither is inferred from the fixture's
 * XML.
 *
 * The suite drives the **real** fixture through the **real** pipeline. Nothing
 * here stands in for a gate, an engine or a viewer: `preflightOoxml`,
 * `verifyOoxmlExtraction`, `assertSafeXlsxRelationships` and
 * `ensureXlsxWasmInitialized` run exactly as the product runs them, over the
 * exact bytes the host handed the renderer, and the workbook is then handed to
 * the installed `@extend-ai/react-xlsx@0.16.4`.
 *
 * Two environment substitutions are made, and both are supplies of platform APIs
 * that jsdom omits rather than stand-ins for behaviour under test. The
 * `virtual:dsa-xlsx-wasm-gzip` payload the build embeds is recomputed here from
 * the installed binary with the same gzip-and-digest procedure, so the real
 * engine bytes pass the real integrity check and the real parser opens the real
 * workbook. jsdom's `Blob` implements no `stream()` and its `URL` implements no
 * `createObjectURL`, so Node's own web-compatible implementations are installed
 * in their place; that is what makes the object-URL ownership assertions below
 * observations of a real allocator rather than of a hand-written counter.
 *
 * ## What is deliberately not asserted here
 *
 * jsdom performs no layout and implements no 2-D canvas context, so nothing in
 * this file asserts painted pixels or measured geometry. Bounding boxes,
 * `naturalWidth`, colour and revocation-after-switch are the browser suite's
 * business (`tests/browser/xlsx-selection.spec.ts`). What this suite owns is the
 * contract between the plugin and the viewer: what the viewer publishes, what the
 * documented hook receives, and what node the plugin builds from it.
 */

import { createHash } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { URL as NodeURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import { act, createElement, useEffect, type JSX } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  XlsxViewer,
  XlsxViewerProvider,
  useXlsxViewer,
  type XlsxImage,
  type XlsxImageRenderProps,
  type XlsxViewerController,
  type XlsxViewerProps,
} from '@extend-ai/react-xlsx'

import { createXlsxSelectionBridge } from '../../src/client/renderers/xlsx/selection-bridge.js'
import { XlsxBody, type XlsxBodyProps } from '../../src/client/renderers/xlsx/XlsxBody.js'
import { ensureXlsxWasmInitialized } from '../../src/client/renderers/xlsx/wasm.js'
import { mountTree, type MountedTree } from './helpers/react-mount.js'

/** The installed engine binary, at the path the build reads it from. */
const ENGINE_PATH = 'node_modules/@extend-ai/react-xlsx/dist/duke_sheets_wasm_bg.wasm'

/**
 * The engine payload the virtual module publishes, reproduced from the installed
 * binary.
 *
 * The build gzips the exact installed `duke_sheets_wasm_bg.wasm` and records its
 * length and SHA-256; the runtime's own integrity check compares those three
 * values. Recomputing them here is what makes this suite exercise the real engine
 * rather than a digest-shaped stand-in. The compression level is irrelevant to
 * all three checks, so the cheapest one is used.
 */
const ENGINE = ((): { rawBytes: number; sha256: string; gzipBase64: string } => {
  const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), ENGINE_PATH)))
  return {
    rawBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    gzipBase64: gzipSync(bytes, { level: 1 }).toString('base64'),
  }
})()

// Read through getters, not captured values: the module factory runs while the
// imports above are still being evaluated, which is before `ENGINE` exists.
vi.mock('virtual:dsa-xlsx-wasm-gzip', () => ({
  get XLSX_WASM_GZIP_BASE64(): string {
    return ENGINE.gzipBase64
  },
  get XLSX_WASM_RAW_BYTES(): number {
    return ENGINE.rawBytes
  },
  get XLSX_WASM_SHA256(): string {
    return ENGINE.sha256
  },
}))

/** The workbook every case in this file opens. */
const CHART_IMAGE_BYTES = new Uint8Array(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/xlsx/chart-image.xlsx')),
)

/** The marker the plugin's replacement renderer puts on the node it owns. */
const IMAGE_MARKER = 'data-dsa-xlsx-image'

/** The workbook surface published once every gate has passed and the engine is installed. */
const XLSX_CONTENT = '[data-dsa-xlsx-content]'

/** A workbook takes seconds to parse even in-process; the waits are polls, not delays. */
const PARSE_TIMEOUT = 60_000

beforeAll(async () => {
  // jsdom supplies neither of these; Node's own web-compatible implementations do.
  vi.stubGlobal('Blob', NodeBlob)
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = NodeURL.createObjectURL
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = NodeURL.revokeObjectURL

  // The engine gate the product runs, with the product's payload and the
  // product's failure modes. A payload that did not reproduce the installed
  // binary would fail here rather than produce a viewer with no parser.
  await ensureXlsxWasmInitialized()
})

/**
 * Settle React's queue and one macrotask, so an asynchronous parse can advance.
 *
 * The wait is inside `act` rather than a bare sleep: the workbook load is a
 * sequence of React state updates, and stepping it without the act queue would
 * both warn and observe the tree between commits.
 *
 * @param milliseconds - how long to let the parse run.
 */
async function settle(milliseconds = 25): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolveTick) => {
      setTimeout(resolveTick, milliseconds)
    })
  })
}

/**
 * Wait until a predicate over the mounted tree holds.
 *
 * Polling the DOM is the wait; there is no fixed delay standing in for the parse.
 * A predicate that never holds fails with what the wait was for and what the tree
 * held instead, so a rendering regression is reported as the state it produced
 * rather than as a bare timeout.
 *
 * @param read - the predicate.
 * @param message - what the wait was for.
 * @param timeoutMs - how long to keep stepping the tree.
 * @param state - what to report alongside a failure.
 */
async function waitFor(
  read: () => boolean,
  message: string,
  timeoutMs = PARSE_TIMEOUT,
  state?: () => unknown,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (read()) return
    await settle()
  }
  const observed = state === undefined ? '' : `; observed ${JSON.stringify(state())}`
  throw new Error(`timed out waiting for ${message}${observed}`)
}

/**
 * Republish the viewer controller's public image model as DOM attributes.
 *
 * `useXlsxViewer` is the library's documented way for consumer UI to reach the
 * workbook controller, and `controller.images` is part of the public
 * `XlsxViewerController` surface. Publishing it as attributes means the
 * assertions read a committed render rather than an object captured at an
 * arbitrary instant, and it keeps the model observable without the plugin
 * exposing anything it does not already expose.
 *
 * @param props - the attribute prefix.
 * @returns the probe element.
 */
function ImageModelProbe({ prefix }: { prefix: string }): JSX.Element {
  const controller: XlsxViewerController = useXlsxViewer()
  const images: XlsxImage[] = controller.images

  useEffect(() => undefined)

  return createElement('div', {
    [`${prefix}-count`]: String(images.length),
    [`${prefix}-readonly`]: String(controller.readOnly),
    [`${prefix}-first`]: images.length === 0 ? '' : JSON.stringify(images[0]),
  })
}

/** One recorded `renderImage` invocation. */
interface RenderCall {
  readonly image: XlsxImage
  readonly rect: XlsxImageRenderProps['rect']
  readonly style: XlsxImageRenderProps['style']
  readonly defaultNode: XlsxImageRenderProps['defaultNode']
}

/** Mounted trees created by a case, torn down afterwards. */
let trees: MountedTree[] = []

afterEach(() => {
  for (const tree of trees) tree.unmount()
  trees = []
})

/** The viewer configuration the production body mounts, without the plugin in the way. */
const VIEWER_PROPS: XlsxViewerProps = {
  readOnly: true,
  useWorker: false,
  showDefaultToolbar: false,
  experimentalCanvas: true,
}

/**
 * Mount the provider/viewer pair over the fixture, with a probe for the public model.
 *
 * @param renderImage - the replacement renderer under test; a marker-carrying
 *   `<img>` when the case is about the boundary itself.
 * @returns the mounted tree and the recorded `renderImage` calls.
 */
function mountViewer(
  renderImage?: (props: XlsxImageRenderProps) => JSX.Element,
): { tree: MountedTree; calls: RenderCall[] } {
  const calls: RenderCall[] = []
  const replacement =
    renderImage ??
    ((props: XlsxImageRenderProps): JSX.Element =>
      createElement('img', {
        [IMAGE_MARKER]: '',
        src: props.image.src,
        alt: props.image.description ?? props.image.name ?? '',
        draggable: false,
      }))

  const element = createElement(XlsxViewerProvider, {
    file: CHART_IMAGE_BYTES.buffer.slice(0) as ArrayBuffer,
    fileName: 'task11-chart-image.xlsx',
    readOnly: true,
    useWorker: false,
    children: [
      createElement(ImageModelProbe, { key: 'probe', prefix: 'data-model' }),
      createElement(XlsxViewer, {
        key: 'viewer',
        ...VIEWER_PROPS,
        showImages: true,
        renderImage: (props: XlsxImageRenderProps): JSX.Element => {
          calls.push({
            image: props.image,
            rect: props.rect,
            style: props.style,
            defaultNode: props.defaultNode,
          })
          return replacement(props)
        },
      }),
    ],
  })

  const tree = mountTree(element)
  trees.push(tree)
  return { tree, calls }
}

/**
 * Read the public image model the probe published.
 * @param tree - the mounted tree.
 * @returns the model entries.
 */
function readModel(tree: MountedTree): XlsxImage[] {
  const serialized = tree.container.querySelector('[data-model-first]')?.getAttribute('data-model-first')
  return serialized === undefined || serialized === null || serialized === ''
    ? []
    : [JSON.parse(serialized) as XlsxImage]
}

/**
 * Assert that a source is a client-local resource the viewer owns.
 * @param src - the source from the public model or from the rendered node.
 */
function expectLocalImageSource(src: string): void {
  expect(src.startsWith('blob:') || src.startsWith('data:image/')).toBe(true)
  for (const scheme of ['http:', 'https:', 'file:', 'filesystem:', 'javascript:']) {
    expect(src.startsWith(scheme), `the image source must not be a ${scheme} resource`).toBe(false)
  }
}

describe('XLSX embedded image: the pinned viewer’s public image contract', () => {
  it('publishes the fixture’s embedded PNG in the public controller image model', async () => {
    const { tree } = mountViewer()

    await waitFor(
      () => readModel(tree).length === 1,
      'the public controller image model to publish the embedded picture',
    )

    const image = readModel(tree)[0]!
    expectLocalImageSource(image.src)
    expect(image.mimeType).toBe('image/png')
    expect(image.workbookSheetIndex).toBe(0)
    expect(image.sheetIndex).toBe(0)
    // The media part the controller extracted, not a path the plugin resolved.
    expect(image.mediaPath ?? '').toContain('xl/media/')
    expect(image.id.length).toBeGreaterThan(0)

    // The anchor is the fixture's: column D, row 2, 64x64 pixels, one-cell style.
    expect(image.anchor.kind).not.toBe('absolute')
    if (image.anchor.kind !== 'absolute') {
      expect(image.anchor.from.col).toBe(3)
      expect(image.anchor.from.row).toBe(1)
    }
  })

  it('invokes the documented renderImage boundary with the model entry, geometry and style', async () => {
    const { tree, calls } = mountViewer()

    await waitFor(() => calls.length > 0, 'the public renderImage hook to be invoked')

    const call = calls.at(-1)!
    expectLocalImageSource(call.image.src)
    expect(call.image.mimeType).toBe('image/png')

    // The rectangle is the viewer's own calculation, in viewer pixels with the
    // current zoom applied. The plugin never computes one of these, so a finite
    // positive rectangle here is the hook carrying real geometry rather than a
    // shape the test supplied.
    for (const value of [call.rect.left, call.rect.top, call.rect.width, call.rect.height]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(call.rect.width).toBeGreaterThan(0)
    expect(call.rect.height).toBeGreaterThan(0)

    // The style is the positioned box the viewer placed: absolute, sized exactly
    // as the rectangle, and ordered against the workbook's other drawings.
    expect(call.style.position).toBe('absolute')
    expect(call.style.width).toBe(call.rect.width)
    expect(call.style.height).toBe(call.rect.height)
    expect(typeof call.style.zIndex).toBe('number')
    expect(call.defaultNode).toBeTruthy()

    // The entry handed to the hook is the one the controller publishes, so the
    // node built from it consumes the viewer's own resource rather than a second
    // copy of the media bytes.
    await waitFor(
      () => readModel(tree).length === 1,
      'the public controller image model to publish the embedded picture',
    )
    expect(readModel(tree)[0]?.src).toBe(call.image.src)

    const rendered = tree.container.querySelector(`[${IMAGE_MARKER}]`)
    expect(rendered?.getAttribute('src')).toBe(call.image.src)
    expect(tree.container.querySelectorAll(`[${IMAGE_MARKER}]`)).toHaveLength(1)
  })
})

describe('XLSX embedded image: the plugin’s production renderer', () => {
  /**
   * Mount the production body over the fixture.
   * @returns the mounted tree.
   */
  function mountBody(): MountedTree {
    const bridge = createXlsxSelectionBridge()
    // One signal per mounted body: the body's effects are keyed on the tab's
    // lifetime, so a stub minting a fresh signal per call would re-run them on
    // every render.
    const signal = new AbortController().signal
    const props = {
      resourceAddress: 'dsh-resource://file/session/s1/smoke-fixtures/task11-chart-image.xlsx',
      content: { kind: 'bytes', data: new Uint8Array(CHART_IMAGE_BYTES) },
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

  it('publishes the embedded picture as an image node consuming the viewer’s own source', async () => {
    // The plugin must not mint a second resource for bytes the viewer already
    // published, and must not release a resource it does not own. Every object
    // URL the page allocates is recorded, so both claims are read from the
    // platform's allocator rather than inferred from the code that was supposed
    // to satisfy them.
    const created: string[] = []
    const revoked: string[] = []
    const createObjectURL = NodeURL.createObjectURL.bind(NodeURL)
    const revokeObjectURL = NodeURL.revokeObjectURL.bind(NodeURL)
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = (object: Blob): string => {
      const url = createObjectURL(object as never)
      created.push(url)
      return url
    }
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = (url: string): void => {
      revoked.push(url)
      revokeObjectURL(url)
    }

    try {
      const tree = mountBody()

      // The gates and the engine ran for real: the selectable content surface
      // exists only after every one of them accepted the archive.
      await waitFor(
        () => tree.container.querySelector(XLSX_CONTENT) !== null,
        'the workbook to pass every gate and reach the viewer',
        30_000,
        () => tree.container.textContent,
      )

      // The failure this case exists for: the workbook can reach the viewer, hold
      // the picture in its public model, draw its chart — and publish no picture.
      await waitFor(
        () => tree.container.querySelector(`[${IMAGE_MARKER}]`) !== null,
        'the production renderer to publish the embedded picture',
        30_000,
        () => ({
          imageNodes: tree.container.querySelectorAll(`[${IMAGE_MARKER}]`).length,
          images: tree.container.querySelectorAll('img').length,
          charts: tree.container.querySelectorAll('svg').length,
          canvases: tree.container.querySelectorAll('canvas').length,
        }),
      )

      const image = tree.container.querySelector(`[${IMAGE_MARKER}]`)
      const src = image?.getAttribute('src') ?? ''
      expectLocalImageSource(src)

      // The source is the viewer's: the controller allocated it, and the plugin
      // neither allocated a second one for the same picture nor released a
      // resource whose lifetime belongs to the viewer.
      expect(created).toContain(src)
      expect(created.filter((url) => url === src)).toHaveLength(1)
      expect(revoked).not.toContain(src)

      // Read-only presentation: no drag affordance, and an accessible name
      // taken from the workbook's own metadata.
      expect(image?.getAttribute('draggable')).toBe('false')
      expect(image?.getAttribute('alt')).not.toBeNull()

      // A pointer gesture on the node is not a mutation path: the geometry the
      // viewer published is the geometry afterwards, and no export or edit route
      // is reached.
      const wrapper = image?.parentElement
      const before = wrapper?.getAttribute('style') ?? ''
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        image?.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
      }
      await settle()
      expect(wrapper?.getAttribute('style') ?? '').toBe(before)
      expect(image?.getAttribute('src')).toBe(src)
    } finally {
      ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
      ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL
    }
  }, PARSE_TIMEOUT)
})
