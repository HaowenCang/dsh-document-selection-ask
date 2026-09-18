import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLIENT_BUNDLE_PATH = join(import.meta.dirname, '..', '..', 'lib', 'client.js')

describe('DOCX and client bundle integrity', () => {
  it('bundles required Office dependencies with zero bare specifier requires in lib/client.js', () => {
    const content = readFileSync(CLIENT_BUNDLE_PATH, 'utf8')

    // Pinned bundling contract: no unbundled bare external requires for Office/PDF libs
    expect(content).not.toMatch(/require\(["']docx-preview["']\)/)
    expect(content).not.toMatch(/require\(["']jszip["']\)/)
    expect(content).not.toMatch(/require\(["']@zip\.js\/zip\.js["']\)/)
    expect(content).not.toMatch(/require\(["']pdfjs-dist["']\)/)
    expect(content).not.toMatch(/from\s+["']docx-preview["']/)
    expect(content).not.toMatch(/from\s+["']jszip["']/)
    expect(content).not.toMatch(/from\s+["']@zip\.js\/zip\.js["']/)

    // Dev-only fixture generator docx must NOT be in shipping bundle
    expect(content).not.toMatch(/require\(["']docx["']\)/)

    // Classic module loader wrapper must be intact
    expect(content).toContain('window.__ModuleLoader__.load')

    // DOCX renderer and adapter identity must be present
    expect(content).toContain('dsh-document-selection-ask/docx')
    expect(content).toContain('dsh-selectable-docx')

    // Document styling contract attributes must be present
    expect(content).toContain('data-dsa-document-kind')
    expect(content).toContain('data-dsa-docx-content')
    expect(content).toContain('data-dsa-docx-page')

    // React and React-DOM must NOT be bundled
    expect(content).toMatch(/require\(["']react["']\)/)
  })

  it('keeps client bundle size bounded and within expected range', () => {
    const stats = statSync(CLIENT_BUNDLE_PATH)
    // Bundle includes PDF.js + docx-preview + JSZip + zip.js + pptx-renderer + echarts + zrender + react-xlsx
    expect(stats.size).toBeGreaterThan(6_000_000)
    expect(stats.size).toBeLessThan(18_000_000)
  })
})
