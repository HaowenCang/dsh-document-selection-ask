/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import {
  DOCX_ENGINE_CLASS_NAME,
  DOCX_PAGE_ATTRIBUTE,
  DOCX_WRAPPER_CLASS_NAME,
} from '../../src/client/renderers/docx/identity.js'
import { markRenderedPages } from '../../src/client/renderers/docx/page-markers.js'

describe('markRenderedPages', () => {
  it('marks direct section children of expected wrapper with 1-based page attributes', () => {
    const root = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.className = DOCX_WRAPPER_CLASS_NAME

    const sec1 = document.createElement('section')
    sec1.className = DOCX_ENGINE_CLASS_NAME
    const sec2 = document.createElement('section')
    sec2.className = DOCX_ENGINE_CLASS_NAME
    const sec3 = document.createElement('section')
    sec3.className = DOCX_ENGINE_CLASS_NAME

    wrapper.appendChild(sec1)
    wrapper.appendChild(sec2)
    wrapper.appendChild(sec3)
    root.appendChild(wrapper)

    const count = markRenderedPages(root)

    expect(count).toBe(3)
    expect(sec1.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('1')
    expect(sec2.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('2')
    expect(sec3.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('3')
  })

  it('fails softly and returns 0 when no wrapper exists', () => {
    const root = document.createElement('div')
    const sec = document.createElement('section')
    sec.className = DOCX_ENGINE_CLASS_NAME
    root.appendChild(sec)

    const count = markRenderedPages(root)

    expect(count).toBe(0)
    expect(sec.hasAttribute(DOCX_PAGE_ATTRIBUTE)).toBe(false)
  })

  it('fails softly and returns 0 when wrapper has no direct sections', () => {
    const root = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.className = DOCX_WRAPPER_CLASS_NAME

    const p = document.createElement('p')
    wrapper.appendChild(p)
    root.appendChild(wrapper)

    const count = markRenderedPages(root)

    expect(count).toBe(0)
    expect(p.hasAttribute(DOCX_PAGE_ATTRIBUTE)).toBe(false)
  })

  it('does not mark nested sections inside a section or other element', () => {
    const root = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.className = DOCX_WRAPPER_CLASS_NAME

    const sec1 = document.createElement('section')
    sec1.className = DOCX_ENGINE_CLASS_NAME
    const nestedDiv = document.createElement('div')
    const nestedSec = document.createElement('section')
    nestedSec.className = DOCX_ENGINE_CLASS_NAME
    nestedDiv.appendChild(nestedSec)
    sec1.appendChild(nestedDiv)

    wrapper.appendChild(sec1)
    root.appendChild(wrapper)

    const count = markRenderedPages(root)

    expect(count).toBe(1)
    expect(sec1.getAttribute(DOCX_PAGE_ATTRIBUTE)).toBe('1')
    expect(nestedSec.hasAttribute(DOCX_PAGE_ATTRIBUTE)).toBe(false)
  })

  it('fails softly if multiple wrappers are present to avoid ambiguity', () => {
    const root = document.createElement('div')
    const w1 = document.createElement('div')
    w1.className = DOCX_WRAPPER_CLASS_NAME
    const w2 = document.createElement('div')
    w2.className = DOCX_WRAPPER_CLASS_NAME

    const sec1 = document.createElement('section')
    sec1.className = DOCX_ENGINE_CLASS_NAME
    w1.appendChild(sec1)

    const sec2 = document.createElement('section')
    sec2.className = DOCX_ENGINE_CLASS_NAME
    w2.appendChild(sec2)

    root.appendChild(w1)
    root.appendChild(w2)

    const count = markRenderedPages(root)

    expect(count).toBe(0)
    expect(sec1.hasAttribute(DOCX_PAGE_ATTRIBUTE)).toBe(false)
    expect(sec2.hasAttribute(DOCX_PAGE_ATTRIBUTE)).toBe(false)
  })
})
