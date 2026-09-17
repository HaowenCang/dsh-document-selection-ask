// @vitest-environment jsdom
/**
 * DOCX renderer engine and security client specification.
 *
 * Verifies OOXML preflight gating, safe renderAsync configuration (renderAltChunks: false,
 * useBase64URL: true), DOM marking, AbortSignal handling, and asset lifecycles.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Uint8ArrayWriter, ZipWriter, TextReader } from '@zip.js/zip.js'

import { OoxmlPreflightError } from '../../src/client/ooxml/errors.js'
import { renderDocx } from '../../src/client/renderers/docx/engine.js'
import {
  DOCX_PAGE_ATTRIBUTE,
  DOCX_WRAPPER_CLASS_NAME,
} from '../../src/client/renderers/docx/identity.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'docx')

const PARAGRAPHS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'paragraphs.docx')))
const MANUAL_BREAK_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'manual-page-break.docx')))
const TABLE_IMAGE_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'table-image.docx')))
const ALTCHUNK_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'altchunk.docx')))

describe('renderDocx engine & security', () => {
  let body: HTMLElement
  let styleHost: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    body = document.createElement('div')
    styleHost = document.createElement('div')
    document.body.appendChild(body)
    document.body.appendChild(styleHost)
    vi.restoreAllMocks()
  })

  it('renders normal docx after successful OOXML preflight', async () => {
    const ac = new AbortController()
    const result = await renderDocx(PARAGRAPHS_DOCX, body, styleHost, ac.signal)

    expect(body.querySelector(`.${DOCX_WRAPPER_CLASS_NAME}`)).not.toBeNull()
    expect(body.textContent).toContain('DOCX Alpha')
    expect(body.textContent).toContain('DOCX Beta')
    expect(body.textContent).toContain('DOCX Gamma')
    expect(body.textContent).toContain('DOCX 中文选段')

    expect(result.renderedPages).toBeGreaterThanOrEqual(1)
  })

  it('marks multiple rendered pages on manual page breaks', async () => {
    const ac = new AbortController()
    const result = await renderDocx(MANUAL_BREAK_DOCX, body, styleHost, ac.signal)

    expect(result.renderedPages).toBe(2)
    const pages = body.querySelectorAll(`[${DOCX_PAGE_ATTRIBUTE}]`)
    expect(pages).toHaveLength(2)
    expect(pages[0]!.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('1')
    expect(pages[1]!.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('2')
    expect(pages[0]!.textContent).toContain('DOCX page one Alpha')
    expect(pages[1]!.textContent).toContain('DOCX page two Beta')
  })

  it('preflight rejects corrupted or invalid archives before docx-preview is called', async () => {
    const invalidBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    const ac = new AbortController()

    await expect(renderDocx(invalidBytes, body, styleHost, ac.signal)).rejects.toThrow(
      OoxmlPreflightError,
    )
    expect(body.children.length).toBe(0)
    expect(styleHost.children.length).toBe(0)
  })

  it('preflight rejects archive with zip-slip traversal path before docx-preview is called', async () => {
    // Create an in-memory zip archive with path traversal
    const zipWriter = new ZipWriter(new Uint8ArrayWriter())
    await zipWriter.add('../evil.xml', new TextReader('<evil/>'))
    const evilBytes = await zipWriter.close()

    const ac = new AbortController()
    const err = await renderDocx(evilBytes, body, styleHost, ac.signal).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('unsafe-path')
    expect(body.children.length).toBe(0)
    expect(styleHost.children.length).toBe(0)
  })

  it('preflight rejects encrypted archive before docx-preview is called', async () => {
    // Create an encrypted zip archive
    const zipWriter = new ZipWriter(new Uint8ArrayWriter(), { password: 'secret-password' })
    await zipWriter.add('word/document.xml', new TextReader('<document/>'))
    const encryptedBytes = await zipWriter.close()

    const ac = new AbortController()
    const err = await renderDocx(encryptedBytes, body, styleHost, ac.signal).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('encrypted-entry')
    expect(body.children.length).toBe(0)
    expect(styleHost.children.length).toBe(0)
  })

  it('aborts immediately when signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()

    await expect(renderDocx(PARAGRAPHS_DOCX, body, styleHost, ac.signal)).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
    expect(body.children.length).toBe(0)
    expect(styleHost.children.length).toBe(0)
  })

  it('does not render altChunk HTML or execute script (security gate)', async () => {
    const ac = new AbortController()
    await renderDocx(ALTCHUNK_DOCX, body, styleHost, ac.signal)

    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('#unsafe-altchunk')).toBeNull()
    expect(body.textContent).not.toContain('UNSAFE_ALTCHUNK_HTML')
    expect(body.textContent).toContain('DOCX AltChunk Security Test Body')
  })

  it('renders embedded images as data URLs without creating Blob URLs (asset lifecycle)', async () => {
    const createObjectUrlMock = vi.fn()
    ;(URL as unknown as { createObjectURL: typeof createObjectUrlMock }).createObjectURL = createObjectUrlMock

    const ac = new AbortController()
    await renderDocx(TABLE_IMAGE_DOCX, body, styleHost, ac.signal)

    const img = body.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(createObjectUrlMock).not.toHaveBeenCalled()

    // Table cells should also be readable
    expect(body.textContent).toContain('Table Cell 1-1')
    expect(body.textContent).toContain('Table Cell 2-2')
  })
})
