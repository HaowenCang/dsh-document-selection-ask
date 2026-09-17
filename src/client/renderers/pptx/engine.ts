/**
 * PPTX preview rendering engine.
 *
 * Coordinates OOXML preflight security gating, bounded streaming extraction verification,
 * lazy media parsing, external relationship security gating, lazy slide presentation
 * model construction, windowed list rendering via PptxViewer, and serialized resize management.
 *
 * ## Security and Architecture Pipeline
 *
 * 1. `preflightOoxml`: Central-directory metadata limits, entry bounds, ratio, path checks.
 * 2. `verifyOoxmlExtraction`: Proves actual == declared output without retention.
 * 3. `parseZipLazyMedia`: Indexed media without eager decompression, enforcing RECOMMENDED_ZIP_LIMITS.
 * 4. `assertSafePptxRelationships`: Fail-closed check: only external hyperlinks allowed.
 * 5. `buildPresentation`: Lazy slide node materialization (`lazySlides: true`).
 * 6. `PptxViewer`: Strict `pdfjs: false` (no remote/embedded PDF fallback), windowed list rendering.
 * 7. Lifecycle integration: `onSlideRendered` marks 1-based provenance, `onSlideUnmounted` invalidates selection.
 */

import {
  buildPresentation,
  parseZipLazyMedia,
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
} from '@aiden0z/pptx-renderer'

import { DEFAULT_OOXML_LIMITS } from '../../ooxml/limits.js'
import { preflightOoxml } from '../../ooxml/preflight.js'
import { verifyOoxmlExtraction } from '../../ooxml/verify-extraction.js'
import { assertSafePptxRelationships } from './security.js'
import { markRenderedSlide } from './slide-markers.js'

/**
 * Handle returned to manage the active PPTX viewing session.
 */
export interface PptxEngineSession {
  /** Total number of slides in the loaded presentation. */
  readonly slideCount: number
  /** Re-render presentation at an updated viewport width without re-parsing OOXML. */
  resize(width: number): Promise<void>
  /** Destroy viewer, abort pending renders, revoke cached media URLs, and clear DOM. */
  dispose(): void
}

/**
 * Hooks provided by the preview host to react to DOM invalidations.
 */
export interface PptxEngineHooks {
  /** Called when rendered slide DOM is unmounted or rebuilt during resize. */
  onSelectableDomInvalidated(): void
}

/**
 * Render a PPTX presentation into the provided host element through the OOXML
 * security pipeline and PptxViewer windowed list renderer.
 *
 * @param bytes - raw PPTX binary data.
 * @param host - container element where slides are mounted.
 * @param scrollContainer - scroll host for IntersectionObserver windowing.
 * @param initialWidth - initial measured width in CSS pixels.
 * @param signal - abort signal controlling the rendering lifecycle.
 * @param hooks - lifecycle callbacks.
 * @returns active engine session.
 */
export async function renderPptx(
  bytes: Uint8Array<ArrayBuffer>,
  host: HTMLElement,
  scrollContainer: HTMLElement,
  initialWidth: number,
  signal: AbortSignal,
  hooks: PptxEngineHooks,
): Promise<PptxEngineSession> {
  signal.throwIfAborted()

  // Gate 1: Central-directory metadata preflight
  await preflightOoxml(bytes, DEFAULT_OOXML_LIMITS, signal)
  signal.throwIfAborted()

  // Gate 2: Bounded streaming extraction verification
  await verifyOoxmlExtraction(bytes, DEFAULT_OOXML_LIMITS, signal)
  signal.throwIfAborted()

  // Gate 3: Lazy media ZIP parsing using library's RECOMMENDED_ZIP_LIMITS
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  const files = await parseZipLazyMedia(arrayBuffer, RECOMMENDED_ZIP_LIMITS)
  signal.throwIfAborted()

  // Gate 4: External relationship security policy (fail-closed, only hyperlinks permitted)
  assertSafePptxRelationships(files)
  signal.throwIfAborted()

  // Gate 5: Build presentation model with lazy slide parsing
  const presentation = buildPresentation(files, { lazySlides: true })
  signal.throwIfAborted()

  let currentViewer: PptxViewer | null = null
  let disposed = false
  let currentGeneration = 0
  let renderChain: Promise<void> = Promise.resolve()

  function createViewer(width: number): PptxViewer {
    const viewer = new PptxViewer(host, {
      fitMode: 'contain',
      width,
      scrollContainer,
      pdfjs: false,
      onSlideRendered: (index, element) => {
        markRenderedSlide(element, index)
      },
      onSlideUnmounted: () => {
        hooks.onSelectableDomInvalidated()
      },
      onSlideError: () => {
        // Non-fatal slide error: continue displaying other slides
      },
    })
    return viewer
  }

  async function renderGeneration(viewer: PptxViewer, generation: number): Promise<void> {
    if (disposed || generation !== currentGeneration) {
      viewer.destroy()
      return
    }

    viewer.load(presentation)
    await viewer.renderList({
      windowed: true,
      initialSlides: 4,
      batchSize: 8,
      overscanViewport: 1.5,
      showSlideLabels: false,
    })

    if (disposed || generation !== currentGeneration) {
      viewer.destroy()
    }
  }

  // Clear host and perform initial render
  host.replaceChildren()
  currentGeneration += 1
  const initialGen = currentGeneration
  const viewer = createViewer(initialWidth)
  currentViewer = viewer

  renderChain = renderGeneration(viewer, initialGen)
  await renderChain

  if (signal.aborted) {
    if (currentViewer) {
      currentViewer.destroy()
      currentViewer = null
    }
    host.replaceChildren()
    signal.throwIfAborted()
  }

  const session: PptxEngineSession = {
    get slideCount(): number {
      return presentation.slides.length
    },

    async resize(width: number): Promise<void> {
      if (disposed) {
        return
      }

      currentGeneration += 1
      const gen = currentGeneration

      // Queue serialized resize
      renderChain = renderChain.then(async () => {
        if (disposed || gen !== currentGeneration) {
          return
        }

        // Destroy old viewer, remove old selectable DOM, and notify lifecycle
        if (currentViewer) {
          currentViewer.destroy()
          currentViewer = null
        }
        host.replaceChildren()
        hooks.onSelectableDomInvalidated()

        const newViewer = createViewer(width)
        currentViewer = newViewer
        await renderGeneration(newViewer, gen)
      })

      await renderChain
    },

    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      currentGeneration += 1

      if (currentViewer) {
        currentViewer.destroy()
        currentViewer = null
      }

      host.replaceChildren()
      hooks.onSelectableDomInvalidated()
    },
  }

  return session
}
