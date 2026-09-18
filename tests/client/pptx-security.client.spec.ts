// @vitest-environment jsdom
/**
 * PPTX relationship security specification.
 *
 * Enforces fail-closed validation of external relationships in PPTX packages.
 * Only external hyperlink relationships are permitted; all other external
 * resources (images, audio, video, OLE objects, external data, unknown types)
 * and malformed XML must be rejected before any rendering takes place.
 */

import { describe, expect, it } from 'vitest'

import type { PptxFiles } from '@aiden0z/pptx-renderer'
import {
  assertSafePptxRelationships,
  assertSafePptxRelationshipXml,
  PptxRelationshipSecurityError,
} from '../../src/client/renderers/pptx/security.js'

function makeXml(rels: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`
}

function makeMockPptxFiles(overrides: Partial<PptxFiles> = {}): PptxFiles {
  return {
    contentTypes: '<Types/>',
    presentation: '<p:presentation/>',
    presentationRels: makeXml(''),
    slides: new Map([['slide1', '<p:sld/>']]),
    slideRels: new Map([['slide1', makeXml('')]]),
    slideLayouts: new Map(),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    media: new Map(),
    charts: new Map(),
    chartStyles: new Map(),
    chartColors: new Map(),
    diagramDrawings: new Map(),
    ...overrides,
  }
}

describe('assertSafePptxRelationshipXml', () => {
  it('allows XML with no external relationships', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).not.toThrow()
  })

  it('allows internal relationships even if TargetMode is explicitly Internal', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png" TargetMode="Internal"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).not.toThrow()
  })

  it('allows safe external hyperlink relationship with Transitional OOXML type', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).not.toThrow()
  })

  it('allows safe external hyperlink relationship with Strict OOXML type', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).not.toThrow()
  })

  it('rejects external relationship with custom /hyperlink suffix', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="https://attacker.invalid/custom/hyperlink" Target="https://example.com" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects external relationship with unknown OOXML-like suffix', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://example.invalid/officeDocument/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects external image relationship', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/evil.png" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects external audio relationship', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="https://example.com/sound.mp3" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects external video relationship', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="https://example.com/movie.mp4" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects unknown external relationship', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://custom.schema/external/data" Target="https://example.com/data.json" TargetMode="External"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects case-insensitive TargetMode="external"', () => {
    const xml = makeXml(`
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/leak.png" TargetMode="external"/>
    `)
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects malformed relationship XML (fail-closed)', () => {
    const xml = '<Relationships><Relationship unclosed'
    expect(() => assertSafePptxRelationshipXml(xml)).toThrowError(PptxRelationshipSecurityError)
  })
})

describe('assertSafePptxRelationships', () => {
  it('passes when all presentation rels are safe', () => {
    const files = makeMockPptxFiles({
      presentationRels: makeXml(`
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      `),
      slideRels: new Map([
        ['slide1', makeXml(`
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
        `)],
      ]),
    })
    expect(() => assertSafePptxRelationships(files)).not.toThrow()
  })

  it('rejects when slideRels has external media', () => {
    const files = makeMockPptxFiles({
      slideRels: new Map([
        ['slide1', makeXml(`
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>
        `)],
      ]),
    })
    expect(() => assertSafePptxRelationships(files)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects when slideLayoutRels has external media', () => {
    const files = makeMockPptxFiles({
      slideLayoutRels: new Map([
        ['layout1', makeXml(`
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>
        `)],
      ]),
    })
    expect(() => assertSafePptxRelationships(files)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects when slideMasterRels has external media', () => {
    const files = makeMockPptxFiles({
      slideMasterRels: new Map([
        ['master1', makeXml(`
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>
        `)],
      ]),
    })
    expect(() => assertSafePptxRelationships(files)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects when chartRels has external media', () => {
    const files = makeMockPptxFiles({
      chartRels: new Map([
        ['chart1', makeXml(`
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalData" Target="https://example.invalid/probe.xlsx" TargetMode="External"/>
        `)],
      ]),
    })
    expect(() => assertSafePptxRelationships(files)).toThrowError(PptxRelationshipSecurityError)
  })

  it('rejects when presentationRels has external media', () => {
    const files = makeMockPptxFiles({
      presentationRels: makeXml(`
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>
      `),
    })
    expect(() => assertSafePptxRelationships(files)).toThrowError(PptxRelationshipSecurityError)
  })
})
