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
  DOCX_BLOCKED_LINK_ATTRIBUTE,
  DOCX_PAGE_ATTRIBUTE,
  DOCX_WRAPPER_CLASS_NAME,
} from '../../src/client/renderers/docx/identity.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'docx')

const PARAGRAPHS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'paragraphs.docx')))
const MANUAL_BREAK_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'manual-page-break.docx')))
const TABLE_IMAGE_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'table-image.docx')))
const ALTCHUNK_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'altchunk.docx')))
const EXTERNAL_LINKS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'external-links.docx')))

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

  it('sanitizes external hyperlinks in rendered docx and hardens safe schemes before publication', async () => {
    const ac = new AbortController()
    await renderDocx(EXTERNAL_LINKS_DOCX, body, styleHost, ac.signal)

    expect(body.textContent).toContain('DOCX External Link Security')

    // 1. Safe HTTPS link
    const httpsAnchor = Array.from(body.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Safe HTTPS',
    )
    expect(httpsAnchor).toBeDefined()
    expect(httpsAnchor!.getAttribute('href')).toBe('https://example.com/path')
    expect(httpsAnchor!.getAttribute('target')).toBe('_blank')
    expect(httpsAnchor!.getAttribute('rel')).toBe('noopener noreferrer')
    expect(httpsAnchor!.getAttribute('referrerpolicy')).toBe('no-referrer')

    // 2. Safe Mail link
    const mailAnchor = Array.from(body.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Safe Mail',
    )
    expect(mailAnchor).toBeDefined()
    expect(mailAnchor!.getAttribute('href')).toBe('mailto:test@example.com')
    expect(mailAnchor!.getAttribute('target')).toBeNull()

    // 3. Internal Bookmark link
    const bookmarkAnchor = Array.from(body.querySelectorAll('a')).find(
      (a) => a.textContent?.trim() === 'Internal Bookmark',
    )
    expect(bookmarkAnchor).toBeDefined()
    expect(bookmarkAnchor!.getAttribute('href')).toBe('#dsa-bookmark')
    expect(bookmarkAnchor!.getAttribute('target')).toBeNull()

    // 4. Blocked dangerous links (javascript, data, file, custom)
    const dangerousLabels = ['Danger JS', 'Danger Data', 'Danger File', 'Danger Custom']
    for (const label of dangerousLabels) {
      const anchor = Array.from(body.querySelectorAll('a')).find(
        (a) => a.textContent?.trim() === label,
      )
      expect(anchor, `anchor for ${label} must exist`).toBeDefined()
      expect(anchor!.hasAttribute('href'), `${label} must have href stripped`).toBe(false)
      expect(anchor!.hasAttribute('target')).toBe(false)
      expect(anchor!.hasAttribute('rel')).toBe(false)
      expect(anchor!.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
      expect(anchor!.textContent?.trim()).toBe(label)
    }
  })

  it('renders into detached staging so live DOM has zero nodes while rendering is in progress', async () => {
    const ac = new AbortController()
    let duringRenderBodyChildren = -1
    let duringRenderStyleChildren = -1

    const customRenderer = async (
      _data: any,
      bodyContainer: HTMLElement,
      styleContainer: HTMLElement,
    ) => {
      // While third-party renderer is actively running and populating staging containers:
      bodyContainer.innerHTML = '<p>Unreviewed Staged Output</p>'
      styleContainer.innerHTML = '<style>.staged{}</style>'

      // Inspect live containers: they must be completely empty!
      duringRenderBodyChildren = body.childNodes.length
      duringRenderStyleChildren = styleHost.childNodes.length
    }

    await renderDocx(PARAGRAPHS_DOCX, body, styleHost, ac.signal, customRenderer as any)

    expect(duringRenderBodyChildren).toBe(0)
    expect(duringRenderStyleChildren).toBe(0)
    expect(body.textContent).toContain('Unreviewed Staged Output')
    expect(styleHost.innerHTML).toContain('.staged')
  })

  it('discards staged DOM and leaves live hosts empty when aborted during render', async () => {
    const ac = new AbortController()

    const slowRenderer = async (
      _data: any,
      bodyContainer: HTMLElement,
    ) => {
      bodyContainer.innerHTML = '<p>Malicious Unreviewed Content</p>'
      // Abort during render execution
      ac.abort()
    }

    await expect(
      renderDocx(PARAGRAPHS_DOCX, body, styleHost, ac.signal, slowRenderer as any),
    ).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))

    // Staging output must not leak to live preview hosts
    expect(body.childNodes.length).toBe(0)
    expect(styleHost.childNodes.length).toBe(0)
  })

  it('discards staged DOM and fails closed when sanitizer fails', async () => {
    const ac = new AbortController()

    const badDomRenderer = async (
      _data: any,
      bodyContainer: HTMLElement,
    ) => {
      // Break querySelectorAll to simulate unexpected sanitizer failure
      bodyContainer.querySelectorAll = () => {
        throw new Error('Simulated DOM query failure in sanitizer')
      }
    }

    await expect(
      renderDocx(PARAGRAPHS_DOCX, body, styleHost, ac.signal, badDomRenderer as any),
    ).rejects.toThrow('Simulated DOM query failure in sanitizer')

    // Must fail closed: nothing published
    expect(body.childNodes.length).toBe(0)
    expect(styleHost.childNodes.length).toBe(0)
  })
})
