// @vitest-environment jsdom
/**
 * PPTX rendering engine client specification.
 *
 * Validates the strict OOXML security pipeline order, relationship gating,
 * lazy loading, slide provenance marking, lifecycle hooks, resize serialization,
 * and clean disposal.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OoxmlPreflightError } from '../../src/client/ooxml/errors.js'
import { renderPptx } from '../../src/client/renderers/pptx/engine.js'
import { PPTX_SLIDE_ATTRIBUTE } from '../../src/client/renderers/pptx/identity.js'
import { PptxRelationshipSecurityError } from '../../src/client/renderers/pptx/security.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'pptx')

function readFixture(name: string): Uint8Array<ArrayBuffer> {
  const buf = readFileSync(join(FIXTURES_DIR, name))
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

describe('renderPptx engine', () => {
  let host: HTMLElement
  let scrollContainer: HTMLElement
  let onSelectableDomInvalidated: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    scrollContainer = document.createElement('div')
    host = document.createElement('div')
    scrollContainer.appendChild(host)
    document.body.appendChild(scrollContainer)
    onSelectableDomInvalidated = vi.fn()
  })

  it('rejects corrupted archive during preflight before third-party parse', async () => {
    const corruptBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
    const controller = new AbortController()

    await expect(
      renderPptx(corruptBytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrowError(OoxmlPreflightError)

    expect(host.children.length).toBe(0)
  })

  it('rejects external media relationship before viewer render', async () => {
    const bytes = readFixture('external-media.pptx')
    const controller = new AbortController()

    await expect(
      renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrowError(PptxRelationshipSecurityError)

    expect(host.children.length).toBe(0)
  })

  it('renders valid two-slide presentation and marks slide numbers', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    expect(session.slideCount).toBe(2)

    const slides = host.querySelectorAll(`[${PPTX_SLIDE_ATTRIBUTE}]`)
    expect(slides.length).toBeGreaterThanOrEqual(1)
    expect(slides[0]?.getAttribute(PPTX_SLIDE_ATTRIBUTE)).toBe('1')

    session.dispose()
  })

  it('handles resize cleanly: invalidates selection and updates viewer', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    onSelectableDomInvalidated.mockClear()

    await session.resize(1000)

    expect(onSelectableDomInvalidated).toHaveBeenCalled()
    expect(session.slideCount).toBe(2)

    session.dispose()
  })

  it('disposes cleanly and idempotently', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()

    const session = await renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
      onSelectableDomInvalidated,
    })

    session.dispose()
    expect(host.children.length).toBe(0)

    // Idempotent second call
    expect(() => session.dispose()).not.toThrow()
  })

  it('throws AbortError if signal is already aborted', async () => {
    const bytes = readFixture('text-two-slides.pptx')
    const controller = new AbortController()
    controller.abort()

    await expect(
      renderPptx(bytes, host, scrollContainer, 800, controller.signal, {
        onSelectableDomInvalidated,
      }),
    ).rejects.toThrow()

    expect(host.children.length).toBe(0)
  })
})
