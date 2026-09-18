// @vitest-environment jsdom
/**
 * XLSX relationship security specification.
 *
 * The scanner is the archive-level half of the XLSX boundary: it opens the
 * package itself, reads every `.rels` part, and refuses the document when a
 * relationship points outside it in a way the policy does not allow. Three
 * properties are asserted here and nowhere else.
 *
 * The first is the policy: only an exact Transitional or Strict hyperlink type
 * whose target carries an `http:`, `https:` or `mailto:` scheme is external
 * content this plugin will tolerate. Everything else — an external image, an
 * external workbook, `externalData`, OLE, a custom external type, or a
 * hyperlink whose target is `javascript:`, `data:`, `file:` or `blob:` — is a
 * refusal.
 *
 * The second is integrity: a `.rels` part whose stored bytes do not match the
 * CRC the archive declares for it must be refused rather than parsed. The
 * scanner reads relationship XML to decide whether the document is safe, so an
 * entry whose bytes are not the bytes the archive promised is a part whose
 * contents cannot be trusted, and "could not verify" has to mean "refuse".
 *
 * The third is cancellation: an aborted scan rejects with an `AbortError`. A
 * scan that returned quietly on abort would report a cancelled security check as
 * a completed one.
 *
 * @zip.js/zip.js builds the archives so the fixtures are real ZIP central
 * directories rather than hand-assembled byte strings, and so the corruption
 * cases corrupt a genuinely valid archive.
 */

import {
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'
import { describe, expect, it, vi } from 'vitest'

import {
  assertSafeXlsxRelationships,
  assertSafeXlsxRelationshipXml,
  runXlsxRelationshipScan,
  XLSX_RELATIONSHIP_READER_OPTIONS,
  XlsxRelationshipSecurityError,
} from '../../src/client/renderers/xlsx/security.js'

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

/**
 * Wrap relationship rows in the package's own relationships document.
 * @param rows - the `<Relationship …/>` rows.
 * @returns the XML text.
 */
function relsXml(rows: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_NS}">\n${rows}\n</Relationships>`
}

/** The Transitional hyperlink relationship type. */
const HYPERLINK_TRANSITIONAL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

/** The Strict hyperlink relationship type. */
const HYPERLINK_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink'

/**
 * Build a valid XLSX-shaped archive from text parts.
 *
 * `level: 0` stores the parts uncompressed. That is what makes the corruption
 * case below a *targeted* edit: the relationship XML appears verbatim in the
 * archive, so one byte of it can be changed without disturbing the central
 * directory, the local headers, or the declared CRC — which is exactly the
 * mismatch the scanner has to notice.
 *
 * @param parts - entry name to text.
 * @returns the archive bytes.
 */
async function buildArchive(parts: Record<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const [name, text] of Object.entries(parts)) {
    await writer.add(name, new TextReader(text), { level: 0 })
  }
  return await writer.close()
}

/**
 * A minimal but structurally valid workbook whose only relationship part is the
 * one under test.
 * @param rows - the relationship rows for `xl/_rels/workbook.xml.rels`.
 * @returns the archive bytes.
 */
async function buildWorkbook(rows: string): Promise<Uint8Array> {
  return await buildArchive({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '</Types>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
    'xl/_rels/workbook.xml.rels': relsXml(rows),
  })
}

/**
 * Find an ASCII marker inside raw archive bytes.
 * @param bytes - the archive.
 * @param marker - the ASCII text to locate.
 * @returns the byte offset, or `-1`.
 */
function indexOfAscii(bytes: Uint8Array, marker: string): number {
  const needle = [...marker].map((character) => character.charCodeAt(0))
  outer: for (let start = 0; start <= bytes.length - needle.length; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[start + offset] !== needle[offset]) continue outer
    }
    return start
  }
  return -1
}

/**
 * Flip one byte of a marker inside an archive, leaving CRC and headers intact.
 * @param bytes - a valid archive containing the marker.
 * @param marker - the ASCII text to corrupt.
 * @returns the corrupted archive.
 * @throws Error when the marker is not present, so a test cannot silently
 *   assert on an unmodified archive.
 */
function corruptMarker(bytes: Uint8Array, marker: string): Uint8Array {
  const offset = indexOfAscii(bytes, marker)
  if (offset < 0) throw new Error(`corruptMarker: ${marker} is not present in the archive`)
  const corrupted = new Uint8Array(bytes)
  corrupted[offset + marker.length - 1] = corrupted[offset + marker.length - 1]! ^ 0x01
  return corrupted
}

/**
 * A reader double for the scan seam, so cleanup and cancellation can be driven
 * without a real archive, and so the options each entry is read under can be
 * observed.
 *
 * @param xml - the relationship XML the single entry resolves to.
 * @param overrides - replacements for the default members.
 * @returns a reader whose `close` and per-entry read options are recorded.
 */
function fakeReader(
  xml: string,
  overrides: {
    filename?: string
    getData?: (options: Record<string, unknown> | undefined) => Promise<string>
    close?: () => Promise<void>
  } = {},
): {
  reader: Parameters<typeof runXlsxRelationshipScan>[0]
  closes: number[]
  readOptions: (Record<string, unknown> | undefined)[]
} {
  const closes: number[] = []
  const readOptions: (Record<string, unknown> | undefined)[] = []
  const reader = {
    getEntries: async () => [
      {
        filename: overrides.filename ?? 'xl/_rels/workbook.xml.rels',
        directory: false,
        getData: async (_writer: unknown, options?: Record<string, unknown>) => {
          readOptions.push(options)
          return overrides.getData ? await overrides.getData(options) : xml
        },
      },
    ],
    close: async () => {
      closes.push(1)
      if (overrides.close) await overrides.close()
    },
  }
  return { reader, closes, readOptions }
}

describe('assertSafeXlsxRelationshipXml policy', () => {
  it('permits a Transitional hyperlink over https', () => {
    const xml = relsXml(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="https://example.com/a" TargetMode="External"/>`,
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).not.toThrow()
  })

  it('permits a Strict hyperlink over http, https and mailto', () => {
    const xml = relsXml(
      [
        `<Relationship Id="rId1" Type="${HYPERLINK_STRICT}" Target="http://example.com/" TargetMode="External"/>`,
        `<Relationship Id="rId2" Type="${HYPERLINK_STRICT}" Target="https://example.com/" TargetMode="External"/>`,
        `<Relationship Id="rId3" Type="${HYPERLINK_STRICT}" Target="mailto:someone@example.com" TargetMode="External"/>`,
      ].join('\n'),
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).not.toThrow()
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['file:', 'file:///C:/Windows/System32/drivers/etc/hosts'],
    ['blob:', 'blob:https://example.com/00000000-0000-0000-0000-000000000000'],
    ['ftp:', 'ftp://example.com/pub'],
    ['relative', '../outside.xml'],
  ])('refuses a hyperlink whose target scheme is %s', (_label, target) => {
    const xml = relsXml(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="${target.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}" TargetMode="External"/>`,
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).toThrowError(XlsxRelationshipSecurityError)
  })

  it.each([
    ['external image', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'],
    ['external workbook (externalLink)', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink'],
    ['externalData', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalData'],
    ['OLE object', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject'],
    ['unknown custom type', 'https://attacker.invalid/custom/hyperlink'],
    ['unknown OOXML-like type', 'http://example.invalid/officeDocument/relationships/hyperlink'],
  ])('refuses an external %s relationship', (_label, type) => {
    const xml = relsXml(
      `<Relationship Id="rId1" Type="${type}" Target="https://example.invalid/probe" TargetMode="External"/>`,
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).toThrowError(XlsxRelationshipSecurityError)
  })

  it('refuses case-insensitive TargetMode="external"', () => {
    // A lowercase mode marker is still an external relationship, so the
    // disallowed type it carries has to be refused. (A lowercase marker on a
    // permitted hyperlink is accepted, because `TargetMode` is not
    // case-sensitive and the relationship itself is safe.)
    const xml = relsXml(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="external"/>',
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).toThrowError(XlsxRelationshipSecurityError)
  })

  it('permits a permitted hyperlink whose TargetMode is written in lower case', () => {
    const xml = relsXml(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="https://example.com/" TargetMode="external"/>`,
    )
    expect(() => assertSafeXlsxRelationshipXml(xml)).not.toThrow()
  })

  it('refuses malformed relationship XML rather than treating it as empty', () => {
    expect(() => assertSafeXlsxRelationshipXml('<Relationships><Relationship unclosed')).toThrowError(
      XlsxRelationshipSecurityError,
    )
  })
})

describe('assertSafeXlsxRelationships over a real archive', () => {
  it('accepts a workbook whose only external relationship is a safe hyperlink', async () => {
    const bytes = await buildWorkbook(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="https://example.com/" TargetMode="External"/>`,
    )
    await expect(assertSafeXlsxRelationships(bytes)).resolves.toBeUndefined()
  })

  it('rejects a workbook carrying an external image relationship', async () => {
    const bytes = await buildWorkbook(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>',
    )
    await expect(assertSafeXlsxRelationships(bytes)).rejects.toThrowError(
      XlsxRelationshipSecurityError,
    )
  })

  it('rejects a workbook whose relationship part no longer matches its declared CRC', async () => {
    const bytes = await buildWorkbook(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="https://example.com/" TargetMode="External"/>`,
    )
    // The archive is valid; only the stored relationship bytes change. A reader
    // that skips CRC verification parses the altered XML and reports the
    // document as safe.
    const corrupted = corruptMarker(bytes, 'example.com')
    await expect(assertSafeXlsxRelationships(corrupted)).rejects.toThrow()
  })

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const bytes = await buildWorkbook(
      `<Relationship Id="rId1" Type="${HYPERLINK_TRANSITIONAL}" Target="https://example.com/" TargetMode="External"/>`,
    )
    const controller = new AbortController()
    controller.abort()
    await expect(assertSafeXlsxRelationships(bytes, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('pins the reader options to CRC verification, overlap detection and the calling thread', async () => {
    // `checkSignature` is zip.js's deprecated alias for `checkCrc32`; the shared
    // OOXML verifier states both integrity options by name and keeps the read on
    // the calling thread, and the two gates must agree so a reader of either
    // file sees the same policy.
    expect(XLSX_RELATIONSHIP_READER_OPTIONS).toEqual({
      checkCrc32: true,
      checkOverlappingEntry: true,
      useWebWorkers: false,
    })
    expect(XLSX_RELATIONSHIP_READER_OPTIONS).not.toHaveProperty('checkSignature')
  })

  it('reads each relationship entry on the calling thread rather than through a codec worker', async () => {
    // zip.js defaults to a `Blob` codec worker. A security gate that spawns one
    // before it has decided the archive is safe, and that cannot run at all under
    // a policy refusing blob workers, is not a gate; the option is asserted on
    // the call the scan actually makes.
    const { reader, readOptions } = fakeReader(relsXml(''))

    await runXlsxRelationshipScan(reader)

    expect(readOptions).toHaveLength(1)
    expect(readOptions[0]).toMatchObject({
      checkCrc32: true,
      checkOverlappingEntry: true,
      useWebWorkers: false,
    })
    expect(readOptions[0]).not.toHaveProperty('signal')
  })

  it('forwards the caller signal into each entry read', async () => {
    const { reader, readOptions } = fakeReader(relsXml(''))
    const controller = new AbortController()

    await runXlsxRelationshipScan(reader, controller.signal)

    expect(readOptions[0]?.['signal']).toBe(controller.signal)
  })
})

describe('relationship scan cancellation and cleanup', () => {
  it('rejects with an AbortError when the signal aborts before enumeration', async () => {
    const { reader, closes } = fakeReader(relsXml(''))
    const controller = new AbortController()
    controller.abort()

    await expect(runXlsxRelationshipScan(reader, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(closes).toEqual([1])
  })

  it('rejects with an AbortError when the signal aborts between entries', async () => {
    const controller = new AbortController()
    const entries = ['xl/_rels/workbook.xml.rels', 'xl/worksheets/_rels/sheet1.xml.rels'].map(
      (filename) => ({
        filename,
        directory: false,
        getData: async () => {
          // Abort arrives while the first entry is being read, so the second
          // entry is never inspected.
          controller.abort()
          return relsXml('')
        },
      }),
    )
    const reader = { getEntries: async () => entries, close: async () => undefined }

    await expect(runXlsxRelationshipScan(reader, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('reports an abort as a rejection rather than a completed scan', async () => {
    const controller = new AbortController()
    const onData = vi.fn(async () => {
      controller.abort()
      return relsXml('')
    })
    const { reader } = fakeReader('', { getData: onData })

    const outcome = await runXlsxRelationshipScan(reader, controller.signal).then(
      () => 'resolved' as const,
      (error: unknown) => (error as { name?: string }).name ?? 'unknown',
    )
    expect(outcome).toBe('AbortError')
  })

  it('preserves the security verdict when releasing the reader also fails', async () => {
    const xml = relsXml(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/probe.png" TargetMode="External"/>',
    )
    const { reader, closes } = fakeReader(xml, {
      close: async () => {
        throw new Error('close failed')
      },
    })

    await expect(runXlsxRelationshipScan(reader)).rejects.toThrowError(
      XlsxRelationshipSecurityError,
    )
    expect(closes).toEqual([1])
  })

  it('preserves an AbortError when releasing the reader also fails', async () => {
    const controller = new AbortController()
    controller.abort()
    const { reader } = fakeReader(relsXml(''), {
      close: async () => {
        throw new Error('close failed')
      },
    })

    await expect(runXlsxRelationshipScan(reader, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('propagates a cleanup failure when the scan accepted the archive', async () => {
    const { reader } = fakeReader(relsXml(''), {
      close: async () => {
        throw new Error('close failed')
      },
    })

    await expect(runXlsxRelationshipScan(reader)).rejects.toThrowError('close failed')
  })
})
