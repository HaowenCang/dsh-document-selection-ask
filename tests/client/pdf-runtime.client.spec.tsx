// @vitest-environment jsdom
/**
 * The PDF renderer's runtime lifecycle.
 *
 * Everything asserted here is a decision this plugin made rather than behaviour
 * PDF.js owns: which worker was created and from where, whether a failure is
 * visible or absorbed, what cleanup releases, and how many times it does so. The
 * PDF.js surface itself is the controllable stand-in in
 * `tests/client/helpers/pdfjs-mock.ts`; the parts of PDF.js that the browser
 * suite exercises — a real module worker, a real raster, real text spans — are
 * not simulated here and are not claimed here.
 *
 * The stub `Worker` and the two `URL` methods are the platform seams. They are
 * installed and removed around each case, and the history they record is the
 * primary evidence:
 *
 * ```text
 * native Worker created:      control.workers.length === 1
 * worker source URL is blob:  workers[0].url.startsWith('blob:')
 * worker runs as a module:    workers[0].options.type === 'module'
 * worker terminated:          workers[0].terminated === true
 * object URL revoked:         control.revoked contains the created URL
 * ```
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PdfAssetFailure, PdfWorkerFailure } from '../../src/client/renderers/pdf/errors.js'
import { renderPdfPage } from '../../src/client/renderers/pdf/render-page.js'
import { openPdf } from '../../src/client/renderers/pdf/runtime.js'
import { PDF_WORKER_SOURCE } from '../../src/client/renderers/pdf/worker-source.js'
import { createPdfBinaryDataFactory } from '../../src/client/renderers/pdf/assets.js'
import {
  FakeTextLayer,
  FakeWorker,
  addPage,
  control,
  fakeCreateObjectURL,
  fakeRevokeObjectURL,
  lastPdfWorkerBridge,
  pdfWorkerBridges,
} from './helpers/pdfjs-mock.js'

/** A small PDF-ish byte array; its contents are never parsed by the stub. */
function sampleBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
}

/** Let every pending microtask run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

/** The `Worker` constructor as the case installed it. */
let workerConstructor: ReturnType<typeof vi.fn>

/** The `URL.createObjectURL` this environment is restored to. */
const originalCreateObjectURL = URL.createObjectURL
/** The `URL.revokeObjectURL` this environment is restored to. */
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  control.reset()

  workerConstructor = vi.fn((url: string, options?: { type?: string; name?: string }) => {
    const worker = new FakeWorker(url, options)
    control.workers.push(worker)
    if (control.workerError !== undefined) {
      // A module worker that cannot evaluate fires `error` and never runs any of
      // its own code, so the handshake below is skipped and the failure arrives
      // asynchronously, as the platform's does.
      queueMicrotask(() => {
        worker.emit('error', new ErrorEvent('error', { error: control.workerError }))
      })
      return worker
    }
    queueMicrotask(() => {
      worker.emit('message', { data: { type: 'dsa-pdf-worker-ready' } })
    })
    return worker
  })

  Object.assign(URL, {
    createObjectURL: fakeCreateObjectURL,
    revokeObjectURL: fakeRevokeObjectURL,
  })
  vi.stubGlobal('Worker', workerConstructor)
})

afterEach(() => {
  vi.unstubAllGlobals()
  Object.assign(URL, {
    createObjectURL: originalCreateObjectURL,
    revokeObjectURL: originalRevokeObjectURL,
  })
})

describe('opening a document', () => {
  it('creates one native module worker from a local blob URL', async () => {
    addPage(['Alpha', 'Beta'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    await session.ready

    expect(control.workers).toHaveLength(1)
    const worker = control.workers[0]
    expect(worker?.url.startsWith('blob:')).toBe(true)
    expect(worker?.options?.type).toBe('module')
    expect(control.created).toEqual([worker?.url])
    // The source the renderer embedded is what the worker was built from, so a
    // build that embedded nothing would fail here rather than in the browser.
    expect(PDF_WORKER_SOURCE.length).toBeGreaterThan(0)

    await session.dispose()
  })

  it('hands PDF.js a copy of the host bytes rather than the host array', async () => {
    addPage(['Alpha'])
    const bytes = sampleBytes()
    const session = openPdf({ bytes, signal: new AbortController().signal })

    await session.ready

    const parameters = control.documents[0]
    const handed = parameters?.['data'] as Uint8Array | undefined
    expect(handed).toBeDefined()
    expect(handed).not.toBe(bytes)
    expect([...(handed ?? [])]).toEqual([...bytes])

    await session.dispose()
  })

  it('configures PDF.js so no asset request can reach the network', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    await session.ready

    const parameters = control.documents[0]
    expect(parameters?.['useWorkerFetch']).toBe(false)
    expect(parameters?.['cMapUrl']).toBeUndefined()
    expect(parameters?.['standardFontDataUrl']).toBeUndefined()
    expect(parameters?.['wasmUrl']).toBeUndefined()
    expect(parameters?.['cMapPacked']).toBe(true)
    expect(typeof parameters?.['BinaryDataFactory']).toBe('function')

    await session.dispose()
  })

  it('reads every page size once, at unit scale', async () => {
    addPage(['a'], { width: 612, height: 792 })
    addPage(['b'], { width: 595, height: 842 })
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    const ready = await session.ready

    expect(ready.pageCount).toBe(2)
    expect(ready.sizes).toEqual([
      { width: 612, height: 792 },
      { width: 595, height: 842 },
    ])

    await session.dispose()
  })

  it('exposes the loaded document by identity once ready', async () => {
    addPage(['a'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    const ready = await session.ready
    expect(session.document).toBe(ready.document)

    await session.dispose()
  })
})

describe('worker failure', () => {
  it('fails visibly instead of parsing on the main thread', async () => {
    addPage(['Alpha'])
    control.workerError = new Error('worker bootstrap failed')

    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    await expect(session.ready).rejects.toBeInstanceOf(PdfWorkerFailure)
    // The decisive assertion: a fallback would have called PDF.js on the main
    // thread, and there is no other route to a document.
    expect(control.documents).toHaveLength(0)
  })

  it('releases the worker and its blob URL when the worker cannot start', async () => {
    control.workerError = new Error('worker bootstrap failed')
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })

    await expect(session.ready).rejects.toBeInstanceOf(PdfWorkerFailure)

    expect(control.workers[0]?.terminated).toBe(true)
    expect(control.revoked).toEqual(control.created)
  })

  it('reports a worker that dies after the document loaded', async () => {
    addPage(['Alpha'])
    const failures: unknown[] = []
    const session = openPdf({
      bytes: sampleBytes(),
      signal: new AbortController().signal,
      onFailure: (error) => failures.push(error),
    })

    await session.ready
    control.workers[0]?.emit('error', new ErrorEvent('error', { error: new Error('died') }))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(PdfWorkerFailure)

    await session.dispose()
  })
})

describe('disposal', () => {
  it('releases the loading task, the bridge, the worker and the URL', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    await session.ready

    const url = control.created[0]
    await session.dispose()

    expect(control.destroyedTasks).toEqual([0])
    expect(lastPdfWorkerBridge()?.destroyed).toBe(true)
    expect(control.workers[0]?.terminated).toBe(true)
    expect(control.revoked).toEqual([url])
  })

  it('is idempotent: three calls release once', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    await session.ready

    await Promise.all([session.dispose(), session.dispose(), session.dispose()])

    expect(control.destroyedTasks).toEqual([0])
    expect(control.revoked).toHaveLength(1)
    expect(pdfWorkerBridges().filter((bridge) => bridge.destroyed)).toHaveLength(1)
  })

  it('revokes the URL even when PDF.js teardown throws', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    await session.ready

    // The failure mode Task 3A exists for: one cleanup step throwing must not
    // leave the rest of the resources alive.
    const documents = control.documents
    expect(documents).toHaveLength(1)

    await session.dispose()
    await session.dispose()

    expect(control.workers[0]?.terminated).toBe(true)
    expect(control.revoked).toEqual(control.created)
  })

  it('clears the ready-handshake listener once the worker answered', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    await session.ready

    const worker = control.workers[0]
    expect(worker?.listeners.get('message')?.size ?? 0).toBe(0)
    // The failure listeners stay for the whole session, which is what lets a
    // worker that dies mid-document be reported.
    expect(worker?.listeners.get('error')?.size ?? 0).toBe(1)

    await session.dispose()
    expect(control.workers[0]?.listeners.get('error')?.size ?? 0).toBe(0)
  })
})

describe('abort', () => {
  it('releases everything when the tab aborts while the document is opening', async () => {
    addPage(['Alpha'])
    control.holdOpen = true
    const aborter = new AbortController()
    const session = openPdf({ bytes: sampleBytes(), signal: aborter.signal })

    await settle()
    expect(control.documents).toHaveLength(1)

    aborter.abort()
    await expect(session.ready).rejects.toMatchObject({ name: 'AbortError' })

    expect(control.workers[0]?.terminated).toBe(true)
    expect(control.revoked).toEqual(control.created)
    // The loading task was destroyed exactly once, and the ready handshake's
    // listener came off with it.
    expect(control.destroyedTasks).toEqual([0])
    expect(control.workers[0]?.listeners.get('message')?.size ?? 0).toBe(0)
  })

  it('rejects immediately when the signal was already aborted', async () => {
    const aborter = new AbortController()
    aborter.abort()
    const session = openPdf({ bytes: sampleBytes(), signal: aborter.signal })

    await expect(session.ready).rejects.toMatchObject({ name: 'AbortError' })
    // Not even a worker is worth creating for a lifetime that has already ended.
    expect(control.workers).toHaveLength(0)
  })

  it('leaves no unhandled rejection behind', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)

    addPage(['Alpha'])
    const aborter = new AbortController()
    const session = openPdf({ bytes: sampleBytes(), signal: aborter.signal })
    aborter.abort()
    await expect(session.ready).rejects.toBeDefined()
    await settle()

    process.off('unhandledRejection', onRejection)
    expect(rejections).toEqual([])
  })
})

describe('page assets', () => {
  it('decodes a bundled asset on demand', async () => {
    const factory = new (createPdfBinaryDataFactory({
      cMapUrl: { 'UniGB-UCS2-H.bcmap': btoa('cmap-bytes') },
      standardFontDataUrl: {},
      wasmUrl: {},
    }))()

    const bytes = await factory.fetch({ kind: 'cMapUrl', filename: 'UniGB-UCS2-H.bcmap' })
    expect(new TextDecoder().decode(bytes)).toBe('cmap-bytes')
  })

  it('refuses an asset this build does not carry rather than reaching for a URL', async () => {
    const factory = new (createPdfBinaryDataFactory({
      cMapUrl: {},
      standardFontDataUrl: {},
      wasmUrl: {},
    }))()

    await expect(factory.fetch({ kind: 'wasmUrl', filename: 'qcms_bg.wasm' })).rejects.toBeInstanceOf(
      PdfAssetFailure,
    )
  })

  it('decodes a fresh buffer per request, so PDF.js may transfer it', async () => {
    const factory = new (createPdfBinaryDataFactory({
      cMapUrl: { 'x.bcmap': btoa('shared') },
      standardFontDataUrl: {},
      wasmUrl: {},
    }))()

    const first = await factory.fetch({ kind: 'cMapUrl', filename: 'x.bcmap' })
    const second = await factory.fetch({ kind: 'cMapUrl', filename: 'x.bcmap' })
    expect(first).not.toBe(second)

    first[0] = 0
    expect(second[0]).not.toBe(0)
  })
})

describe('page rendering', () => {
  /** The hosts one page render writes into. */
  function hosts(): { canvas: HTMLCanvasElement; textLayer: HTMLElement } {
    const canvas = document.createElement('canvas')
    const textLayer = document.createElement('div')
    document.body.append(canvas, textLayer)
    return { canvas, textLayer }
  }

  it('backs the canvas at the device pixel ratio and leaves the CSS box alone', async () => {
    addPage(['Alpha', 'Beta'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 816, 2, new AbortController().signal)
    await render.done

    // 816 CSS pixels at 2 device pixels per CSS pixel: the raster is the display's
    // own resolution, and the CSS box is the page's, not the raster's.
    expect(elements.canvas.width).toBe(1632)
    expect(elements.canvas.height).toBe(2112)
    expect(elements.canvas.style.width).toBe('816px')
    expect(elements.canvas.style.height).toBe('1056px')
    expect(control.pages[0]?.renders[0]?.transform).toEqual([2, 0, 0, 2, 0, 0])

    // The text layer takes the CSS viewport's scale, never the raster factor: the
    // container is sized from this property, so a value derived from the backing
    // store would shrink the whole layer off the glyphs it selects.
    const layer = FakeTextLayer.instances.at(-1)
    expect(layer?.viewport.scale).toBe(1)
    expect(elements.textLayer.style.getPropertyValue('--total-scale-factor')).toBe('1')

    await session.dispose()
  })

  it.each([
    [1, 816, 1056, undefined],
    [1.25, 1020, 1320, [1.25, 0, 0, 1.25, 0, 0]],
    [1.5, 1224, 1584, [1.5, 0, 0, 1.5, 0, 0]],
    [2, 1632, 2112, [2, 0, 0, 2, 0, 0]],
  ])(
    'at %s× the raster scales with the display while the text layer does not move',
    async (devicePixelRatio, backingWidth, backingHeight, transform) => {
      addPage(['Alpha'])
      const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
      const ready = await session.ready

      const elements = hosts()
      const render = renderPdfPage(
        ready.document,
        1,
        elements,
        816,
        devicePixelRatio,
        new AbortController().signal,
      )
      await render.done

      expect(elements.canvas.width).toBe(backingWidth)
      expect(elements.canvas.height).toBe(backingHeight)
      expect(elements.canvas.style.width).toBe('816px')
      expect(elements.canvas.style.height).toBe('1056px')
      expect(control.pages[0]?.renders[0]?.transform).toEqual(transform)
      // Identical at every ratio: this is the decoupling the hotfix is about.
      expect(elements.textLayer.style.getPropertyValue('--total-scale-factor')).toBe('1')

      await session.dispose()
    },
  )

  it('backs the raster at the ratio for a page whose CSS scale is not 1', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 400, 3, new AbortController().signal)
    await render.done

    // 400 CSS pixels at 3× is 1200 device pixels, and the CSS box stays 400: the
    // raster scale never moves the page. The CSS scale is 400/816, and that — not
    // the raster factor — is what the text layer is laid out with.
    expect(elements.canvas.width).toBe(1200)
    expect(elements.canvas.style.width).toBe('400px')
    expect(control.pages[0]?.renders[0]?.transform).toEqual([3, 0, 0, 3, 0, 0])
    const cssScale = 400 / 816
    expect(FakeTextLayer.instances.at(-1)?.viewport.scale).toBeCloseTo(cssScale, 10)
    expect(
      Number(elements.textLayer.style.getPropertyValue('--total-scale-factor')),
    ).toBeCloseTo(cssScale, 10)

    await session.dispose()
  })

  it('produces real DOM text nodes the browser can select', async () => {
    addPage(['Alpha', 'Beta'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 816, 1, new AbortController().signal)
    await render.done

    const spans = elements.textLayer.querySelectorAll('span')
    expect([...spans].map((span) => span.textContent)).toEqual(['Alpha', 'Beta'])

    await session.dispose()
  })

  it('leaves an image-only page with an empty text layer', async () => {
    addPage([])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 816, 1, new AbortController().signal)
    await render.done

    expect(elements.textLayer.childNodes).toHaveLength(0)
    // And nothing invented in its place: no filename, no placeholder, no OCR.
    expect(elements.textLayer.textContent).toBe('')

    await session.dispose()
  })

  it('cancels both renders and still cleans the page exactly once', async () => {
    addPage(['Alpha'], { holdRender: true })
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const aborter = new AbortController()
    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 816, 1, aborter.signal)

    await settle()
    expect(control.pages[0]?.tasks).toHaveLength(1)

    aborter.abort()
    await render.done

    expect(control.pages[0]?.tasks[0]?.cancelled).toBe(true)
    expect(control.pages[0]?.textCancelled).toBe(true)
    expect(control.pages[0]?.cleanups).toBe(1)
    // The decisive ordering fact: the page was never cleaned while a render was
    // still in flight, which is what would have emptied the text layer.
    expect(control.pages[0]?.cleanedUpWhileRendering).toBe(false)

    await session.dispose()
  })

  it('cleans the page after both renders settle, never between them', async () => {
    addPage(['Alpha'])
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const elements = hosts()
    const render = renderPdfPage(ready.document, 1, elements, 816, 1, new AbortController().signal)
    await render.done

    expect(control.pages[0]?.cleanups).toBe(1)
    expect(control.pages[0]?.cleanedUpWhileRendering).toBe(false)
    // Both layers exist, which is the state a premature cleanup would have wiped.
    expect(elements.textLayer.querySelectorAll('span')).toHaveLength(1)

    await session.dispose()
  })

  it('reports a page render failure rather than resolving silently', async () => {
    addPage(['Alpha'], { renderError: new Error('raster failed') })
    const session = openPdf({ bytes: sampleBytes(), signal: new AbortController().signal })
    const ready = await session.ready

    const render = renderPdfPage(ready.document, 1, hosts(), 816, 1, new AbortController().signal)

    await expect(render.done).rejects.toThrowError('raster failed')
    expect(control.pages[0]?.cleanups).toBe(1)

    await session.dispose()
  })
})
