import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLIENT_BUNDLE_PATH = join(import.meta.dirname, '..', '..', 'lib', 'client.js')

describe('PPTX and client bundle integrity', () => {
  it('bundles required PPTX and chart dependencies with zero bare specifier requires in lib/client.js', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')

    // Pinned bundling contract: no bare external requires for PPTX/ECharts/ZRender/JSZip
    expect(content).not.toMatch(/require\(["']@aiden0z\/pptx-renderer(?:\/.*)?["']\)/)
    expect(content).not.toMatch(/require\(["']echarts(?:\/.*)?["']\)/)
    expect(content).not.toMatch(/require\(["']zrender(?:\/.*)?["']\)/)
    expect(content).not.toMatch(/require\(["']jszip(?:\/.*)?["']\)/)

    // No bare ESM imports
    expect(content).not.toMatch(/^\s*import\s+.*?from\s+["']@aiden0z\/pptx-renderer(?:\/.*)?["']/m)
    expect(content).not.toMatch(/^\s*import\s+.*?from\s+["']echarts(?:\/.*)?["']/m)
    expect(content).not.toMatch(/^\s*import\s+.*?from\s+["']zrender(?:\/.*)?["']/m)

    // No bare Node module requires from Office renderer graph
    for (const mod of ['stream', 'buffer', 'events', 'util', 'fs', 'path']) {
      expect(content).not.toMatch(new RegExp(`require\\(["']${mod}["']\\)`))
    }

    // Dev-only fixture generator pptxgenjs must NOT be in shipping bundle
    expect(content).not.toMatch(/require\(["']pptxgenjs["']\)/)

    // mtx-decompressor must NOT be present in shipping bundle
    expect(content).not.toContain('mtx-decompressor')

    // Classic module loader wrapper must be intact
    expect(content).toContain('window.__ModuleLoader__.load')

    // PPTX renderer and adapter identity must be present
    expect(content).toContain('dsh-document-selection-ask/pptx')
    expect(content).toContain('dsh-selectable-pptx')
    expect(content).toContain('data-dsa-pptx-content')
    expect(content).toContain('data-dsa-pptx-slide')

    // Previous renderers still intact
    expect(content).toContain('dsh-document-selection-ask/pdf')
    expect(content).toContain('dsh-selectable-pdf')
    expect(content).toContain('dsh-document-selection-ask/docx')
    expect(content).toContain('dsh-selectable-docx')

    // React must NOT be duplicated (externalized to DSH loader require)
    expect(content).toMatch(/require\(["']react["']\)/)
  })

  it('keeps client bundle size bounded and within expected range', () => {
    const stats = statSync(CLIENT_BUNDLE_PATH)
    // Bundle includes PDF.js + docx-preview + JSZip + zip.js + pptx-renderer + echarts + zrender
    expect(stats.size).toBeGreaterThan(8_000_000)
    expect(stats.size).toBeLessThan(18_000_000)
  })
})
