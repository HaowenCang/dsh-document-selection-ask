// @vitest-environment jsdom
/**
 * DOCX hyperlink security and scheme policy client specification.
 *
 * Verifies explicit allowlist enforcement on rendered anchor tags,
 * attribute hardening (target="_blank", noopener, noreferrer, no-referrer)
 * for HTTP(S), preservation of fragments/mailto/tel, and stripping of dangerous,
 * unknown, relative, or protocol-relative hyperlink targets.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  DOCX_BLOCKED_LINK_ATTRIBUTE,
  sanitizeDocxLinks,
} from '../../src/client/renderers/docx/security.js'

describe('sanitizeDocxLinks scheme policy', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
  })

  it('preserves and hardens safe HTTPS links', () => {
    container.innerHTML = '<a href="https://example.com/path">Safe Link</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 1, blocked: 0, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/path')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
    expect(a.textContent).toBe('Safe Link')
  })

  it('preserves and hardens safe HTTP links', () => {
    container.innerHTML = '<a href="http://example.com/insecure">Insecure Link</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 1, blocked: 0, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('http://example.com/insecure')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
  })

  it('preserves mailto links without target="_blank"', () => {
    container.innerHTML = '<a href="mailto:test@example.com">Email Us</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 1, blocked: 0, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('mailto:test@example.com')
    expect(a.getAttribute('target')).toBeNull()
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
    expect(a.textContent).toBe('Email Us')
  })

  it('preserves tel links without target="_blank"', () => {
    container.innerHTML = '<a href="tel:+1234567890">Call Us</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 1, blocked: 0, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('tel:+1234567890')
    expect(a.getAttribute('target')).toBeNull()
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
    expect(a.textContent).toBe('Call Us')
  })

  it('preserves internal bookmark fragments without target="_blank"', () => {
    container.innerHTML = '<a href="#dsa-bookmark">Jump to Section</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 0, blocked: 0, internal: 1 })
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('#dsa-bookmark')
    expect(a.getAttribute('target')).toBeNull()
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
    expect(a.textContent).toBe('Jump to Section')
  })

  it('blocks javascript scheme links, removes href, sets blocked marker, and preserves text', () => {
    container.innerHTML =
      '<a href="javascript:alert(1)" target="_self" rel="prev"><span>Malicious Action</span></a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 0, blocked: 1, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.hasAttribute('target')).toBe(false)
    expect(a.hasAttribute('rel')).toBe(false)
    expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    expect(a.textContent).toBe('Malicious Action')
    expect(a.querySelector('span')).not.toBeNull()
  })

  it('blocks mixed-case and whitespace-padded javascript links', () => {
    const malicious = [
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      'javascript:alert(1)  ',
      '\t\njavascript:alert(1)\r\n',
      'JAVASCRIPT:alert(1)',
    ]

    for (const href of malicious) {
      container.innerHTML = `<a href="${href}">Link</a>`
      const result = sanitizeDocxLinks(container)
      expect(result.blocked).toBe(1)
      const a = container.querySelector('a')!
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    }
  })

  it('blocks data URIs', () => {
    container.innerHTML = '<a href="data:text/html,<script>alert(1)</script>">Data Link</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 0, blocked: 1, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    expect(a.textContent).toBe('Data Link')
  })

  it('blocks vbscript, file, and blob schemes', () => {
    const disallowed = [
      'vbscript:msgbox(1)',
      'file:///C:/Windows/System32/',
      'blob:http://example.com/uuid-1234',
      'filesystem:http://example.com/temporary/myfile.png',
      'about:blank',
    ]

    for (const href of disallowed) {
      container.innerHTML = `<a href="${href}">Link</a>`
      const result = sanitizeDocxLinks(container)
      expect(result.blocked).toBe(1)
      const a = container.querySelector('a')!
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    }
  })

  it('blocks unknown custom schemes to prove allowlist enforcement rather than blacklist', () => {
    const customSchemes = [
      'custom-scheme://example',
      'custom+foo:bar',
      'foo.bar://target',
      'dsh-internal://action',
    ]

    for (const href of customSchemes) {
      container.innerHTML = `<a href="${href}">Custom Scheme</a>`
      const result = sanitizeDocxLinks(container)
      expect(result.blocked).toBe(1)
      const a = container.querySelector('a')!
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    }
  })

  it('blocks relative external targets and protocol-relative URLs', () => {
    const relativeHrefs = [
      'foo/bar',
      '../outside/secret.docx',
      './sibling',
      '/root/absolute',
      '//evil.com/phishing',
    ]

    for (const href of relativeHrefs) {
      container.innerHTML = `<a href="${href}">Relative Link</a>`
      const result = sanitizeDocxLinks(container)
      expect(result.blocked).toBe(1)
      const a = container.querySelector('a')!
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    }
  })

  it('blocks empty and whitespace-only href attributes', () => {
    const emptyHrefs = ['', '   ', '\t\n']

    for (const href of emptyHrefs) {
      container.innerHTML = `<a href="${href}">Empty Link</a>`
      const result = sanitizeDocxLinks(container)
      expect(result.blocked).toBe(1)
      const a = container.querySelector('a')!
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.getAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe('')
    }
  })

  it('ignores anchors without href attribute', () => {
    container.innerHTML = '<a id="target-name">Anchor Target</a>'
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({ allowed: 0, blocked: 0, internal: 0 })
    const a = container.querySelector('a')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.hasAttribute(DOCX_BLOCKED_LINK_ATTRIBUTE)).toBe(false)
  })

  it('accurately counts multiple mixed links in a document tree', () => {
    container.innerHTML = `
      <p>
        <a href="https://example.com/one">Safe 1</a>
        <a href="javascript:evil()">Danger 1</a>
        <a href="#bookmark-1">Bookmark 1</a>
        <a href="mailto:a@b.com">Mail</a>
        <a href="data:text/plain,hello">Danger 2</a>
        <a href="tel:1234">Tel</a>
        <a href="../relative">Danger 3</a>
        <a href="#bookmark-2">Bookmark 2</a>
      </p>
    `
    const result = sanitizeDocxLinks(container)

    expect(result).toEqual({
      allowed: 3, // https, mailto, tel
      blocked: 3, // javascript, data, relative
      internal: 2, // bookmark-1, bookmark-2
    })
  })
})
