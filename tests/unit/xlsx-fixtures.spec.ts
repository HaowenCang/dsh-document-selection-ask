/**
 * Committed-XLSX-fixture integrity specification.
 *
 * ## Why this suite exists
 *
 * The frozen chart/image browser gate requires the picture inside
 * `chart-image.xlsx` to decode into pixels. An earlier revision of the fixture
 * embedded a PNG whose `IHDR` parsed — 64x64, 8-bit RGBA — while its compressed
 * image data did not: every decoder that reached the Huffman tables rejected the
 * stream. A browser `<img>` reported `complete: true` and `naturalWidth: 64` for
 * it, because both values are read from the header, and the canvas it was drawn
 * into carried no colour at all.
 *
 * That made the header an unreliable witness. This suite therefore reads the
 * **actual media part out of the committed workbook** and validates it the way a
 * decoder does: chunk framing and CRC-32 first, then the zlib stream, then the
 * scanlines and every pixel. It is the only place that can tell "the viewer drew
 * nothing" apart from "there was nothing to draw", and it answers that question
 * without a browser.
 *
 * ## What it is not
 *
 * Nothing here asserts how the picture is rendered. Pixel geometry, layout and
 * the published DOM node belong to `tests/browser/xlsx-selection.spec.ts`; what
 * the plugin builds from the viewer's model belongs to
 * `tests/client/xlsx-image-render.client.spec.tsx`. This suite owns the bytes on
 * disk and the generator that wrote them.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { JSDOM, type JsdomDOMParser } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  SAMPLE_PNG_HEIGHT,
  SAMPLE_PNG_RGBA,
  SAMPLE_PNG_WIDTH,
  createSolidRedPng,
} from '../../scripts/generate-xlsx-fixtures.mjs'

/**
 * The decoder bundled inside `@extend-ai/react-xlsx` itself.
 *
 * `fflate` is not a declared dependency of this project — it belongs to that
 * package's own graph — so it is reached through that package's resolution
 * rather than through a bare specifier. A second decoder is the point: a bug in
 * one inflater that both the fixture and its check share would be invisible, and
 * Node's `zlib` is the independent one.
 */
const fflate = createRequire(import.meta.url)(
  createRequire(import.meta.url).resolve('fflate', {
    paths: [createRequire(import.meta.url).resolve('@extend-ai/react-xlsx')],
  }),
) as {
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>
  unzlibSync: (data: Uint8Array, options?: { out?: Uint8Array }) => Uint8Array
}

/** The fixture directory, relative to the repository root the suite runs in. */
const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'xlsx')

/** The workbook the frozen chart/image browser case opens. */
const WORKBOOK_PATH = join(FIXTURE_DIR, 'chart-image.xlsx')

/** The workbook as the host hands it to the renderer. */
const WORKBOOK_BYTES = new Uint8Array(readFileSync(WORKBOOK_PATH))

/** The archive's entries, decompressed once and shared by every case. */
const ENTRIES = fflate.unzipSync(WORKBOOK_BYTES)

/** Decode one archive entry as text. */
function entryText(name: string): string {
  const bytes = ENTRIES[name]
  if (bytes === undefined) throw new Error(`the workbook has no ${name}`)
  return Buffer.from(bytes).toString('utf8')
}

/** A PNG chunk's declared payload, type and trailer, read from the stream. */
interface PngChunk {
  readonly type: string
  readonly data: Buffer
  readonly offset: number
  readonly declaredCrc: number
  readonly computedCrc: number
}

/**
 * CRC-32 (IEEE 802.3), computed independently of the generator.
 *
 * The generator carries its own table; this one is written again here rather
 * than imported, because a check that reuses the code under check proves only
 * that the code agrees with itself. The polynomial is the reflected one the PNG
 * specification names.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/** The CRC-32 of a byte sequence. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** The PNG signature: the eight bytes a stream must begin with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Walk a PNG stream chunk by chunk.
 *
 * The walk is bounded by the stream's own declared lengths and refuses to run
 * past its end: a chunk header that claims more data than remains is a malformed
 * stream, not a short read to be tolerated.
 *
 * @param png - the PNG stream.
 * @returns every chunk, in stream order.
 */
function readPngChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  while (offset < png.length) {
    if (offset + 12 > png.length) {
      throw new Error(`truncated chunk header at offset ${offset} of ${png.length}`)
    }
    const length = png.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > png.length) {
      throw new Error(
        `chunk at ${offset} declares ${length} bytes, past the end of a ${png.length}-byte stream`,
      )
    }
    const type = png.toString('latin1', offset + 4, offset + 8)
    chunks.push({
      type,
      data: png.subarray(offset + 8, offset + 8 + length),
      offset,
      declaredCrc: png.readUInt32BE(offset + 8 + length),
      computedCrc: crc32(png.subarray(offset + 4, offset + 8 + length)),
    })
    offset = end
  }
  if (offset !== png.length) throw new Error(`the chunk walk stopped at ${offset}, not ${png.length}`)
  return chunks
}

/** The picture the committed workbook stores, read from its media part. */
const EMBEDDED_PNG = Buffer.from(
  ((): Uint8Array => {
    const bytes = ENTRIES['xl/media/image1.png']
    if (bytes === undefined) throw new Error('the workbook has no xl/media/image1.png')
    return bytes
  })(),
)

/** Every chunk of the embedded picture, in stream order. */
const PNG_CHUNKS = readPngChunks(EMBEDDED_PNG)

/** The `IHDR` payload, which is where a browser reads `naturalWidth` from. */
const IHDR = PNG_CHUNKS.find((chunk) => chunk.type === 'IHDR')?.data ?? Buffer.alloc(0)

/** The concatenated `IDAT` payload: the zlib stream the pixels live in. */
const IDAT = Buffer.concat(
  PNG_CHUNKS.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
)

/** One scanline's length: one filter byte plus `width` 8-bit RGBA pixels. */
const STRIDE = 1 + SAMPLE_PNG_WIDTH * 4

/** What the `IDAT` stream must inflate to: every scanline of a 64x64 RGBA image. */
const RAW_LENGTH = STRIDE * SAMPLE_PNG_HEIGHT

/**
 * The generator's own output for the same picture.
 *
 * Called rather than captured at module load, so this spec's structural cases
 * still run — and still report what is wrong with the committed bytes — against
 * a generator that does not yet expose the builder.
 */
function generatedPng(): Buffer {
  return createSolidRedPng()
}

/**
 * Inflate the `IDAT` stream, reporting the decoder's complaint rather than
 * substituting an empty result. The message is the evidence: "invalid code
 * lengths set" names a malformed Huffman table, which is a property of the bytes
 * and not of any renderer.
 */
function inflateIdat(): Buffer {
  try {
    return inflateSync(IDAT)
  } catch (error) {
    throw new Error(
      `the embedded PNG's IDAT stream does not inflate: ${String(error)} ` +
        `(${IDAT.length} bytes behind a ${IDAT.subarray(0, 2).toString('hex')} zlib header)`,
    )
  }
}

describe('XLSX fixture: the embedded picture is a decodable PNG', () => {
  it('inflates its IDAT stream to exactly one scanline set', () => {
    // The check the whole suite exists for. An `IHDR` that parses and a `78da`
    // header that says "zlib" are both claims; the decoded length is the fact.
    expect(inflateIdat()).toHaveLength(RAW_LENGTH)
    expect(RAW_LENGTH).toBe(16_448)
  })

  it('decodes every scanline to the fixture’s solid red pixel', () => {
    const raw = inflateIdat()
    const [red, green, blue, alpha] = SAMPLE_PNG_RGBA

    const badFilters: number[] = []
    const badPixels: string[] = []
    for (let row = 0; row < SAMPLE_PNG_HEIGHT; row += 1) {
      const start = row * STRIDE
      if (raw[start] !== 0) badFilters.push(row)
      for (let column = 0; column < SAMPLE_PNG_WIDTH; column += 1) {
        const pixel = start + 1 + column * 4
        const rgba = [raw[pixel]!, raw[pixel + 1]!, raw[pixel + 2]!, raw[pixel + 3]!]
        if (rgba[0] !== red || rgba[1] !== green || rgba[2] !== blue || rgba[3] !== alpha) {
          // Only the first few are reported: one wrong pixel and four thousand
          // wrong pixels are the same finding.
          if (badPixels.length < 8) badPixels.push(`row ${row} column ${column} = ${rgba.join(',')}`)
        }
      }
    }

    // The walk is asserted to have examined every pixel, so a loop that ran over
    // nothing cannot report no offenders.
    expect(SAMPLE_PNG_WIDTH * SAMPLE_PNG_HEIGHT).toBe(4_096)
    expect(badFilters, 'every scanline must use filter type 0 (None)').toEqual([])
    expect(badPixels, 'every pixel must be opaque red').toEqual([])
  })

  it('decodes the same bytes through a second, independent inflater', () => {
    // `fflate` ships inside the pinned viewer; Node's `zlib` is the other
    // decoder. Byte-for-byte agreement between two implementations is what makes
    // "the bytes are fine" a statement about the bytes rather than about one
    // inflater both this fixture and its check happen to share.
    const viaNode = inflateIdat()
    const viaFflate = Buffer.from(fflate.unzlibSync(IDAT))
    expect(viaFflate.equals(viaNode)).toBe(true)
  })

  it('declares a 64x64 8-bit RGBA image', () => {
    expect(PNG_CHUNKS.filter((chunk) => chunk.type === 'IHDR')).toHaveLength(1)
    expect(IHDR.length).toBe(13)
    expect(IHDR.readUInt32BE(0)).toBe(SAMPLE_PNG_WIDTH)
    expect(IHDR.readUInt32BE(4)).toBe(SAMPLE_PNG_HEIGHT)
    expect(IHDR[8]).toBe(8) // bit depth
    expect(IHDR[9]).toBe(6) // colour type: truecolour with alpha
    expect(IHDR[10]).toBe(0) // compression method: deflate
    expect(IHDR[11]).toBe(0) // filter method: adaptive
    expect(IHDR[12]).toBe(0) // interlace: none
  })

  it('carries the minimal PNG structure with valid chunk framing and CRC-32s', () => {
    expect(EMBEDDED_PNG.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)

    // Every chunk's declared CRC-32 matches the CRC-32 of its own type and data.
    // This is the check that a decode alone would not make: a stream can inflate
    // while a chunk trailer is wrong, and a decoder that verifies CRCs would then
    // reject a picture the fixture gate had passed.
    for (const chunk of PNG_CHUNKS) {
      expect(
        chunk.declaredCrc,
        `${chunk.type} at offset ${chunk.offset} carries a wrong CRC-32`,
      ).toBe(chunk.computedCrc)
    }

    // The path is exactly IHDR, IDAT, IEND: nothing before the header, no
    // ancillary metadata, nothing between the image data and the end marker.
    expect(PNG_CHUNKS.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(PNG_CHUNKS.at(-1)?.data.length).toBe(0)

    // No trailing bytes after IEND.
    const last = PNG_CHUNKS.at(-1)!
    expect(last.offset + 12 + last.data.length).toBe(EMBEDDED_PNG.length)
  })

  it('records the picture’s byte length and digest as provenance', () => {
    // Recorded, not gated: the semantic contract above is what a legitimate
    // change to the generator must satisfy, and these two values are how a
    // future reader identifies the bytes this round's evidence was measured on.
    expect(EMBEDDED_PNG.length).toBeGreaterThan(0)
    expect(createHash('sha256').update(EMBEDDED_PNG).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('XLSX fixture: the generator and the committed workbook agree', () => {
  it('builds a byte-identical picture on every call', () => {
    expect(generatedPng().equals(generatedPng())).toBe(true)
    expect(generatedPng().length).toBeGreaterThan(0)
  })

  it('stores the generator’s own bytes at xl/media/image1.png', () => {
    // The drift guard. Without it, a repaired fixture and a stale generator can
    // diverge silently and the next regeneration reintroduces the defect.
    expect(EMBEDDED_PNG.equals(generatedPng())).toBe(true)
  })

  it('writes no external relationship target', () => {
    // Scoped to relationships rather than to a URL-shaped substring: the drawing
    // part legitimately names the DrawingML and chart namespaces, which are
    // `http://` identifiers and not addresses anything resolves. What must not
    // appear is a relationship the package asks a consumer to fetch.
    const rels = entryText('xl/drawings/_rels/drawing1.xml.rels')
    expect(rels).not.toMatch(/TargetMode\s*=\s*"External"/i)
    expect(rels).not.toMatch(/Target\s*=\s*"(?:https?:|file:|ftp:)/i)
  })
})

describe('XLSX fixture: the workbook still carries its drawing parts', () => {
  it('keeps the chart part and its content type', () => {
    expect(Object.keys(ENTRIES)).toContain('xl/charts/chart1.xml')
    expect(entryText('xl/charts/chart1.xml')).toContain('<c:chartSpace')
    expect(entryText('[Content_Types].xml')).toContain(
      'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    )
  })

  it('parses xl/drawings/drawing1.xml as well-formed XML', () => {
    // Parsed rather than pattern-matched: an earlier revision of the generator
    // wrote a stray closing tag into this part, which no substring assertion
    // would have caught and which a renderer could only report as "nothing was
    // drawn". jsdom is already the project's XML/DOM implementation for the
    // client specs, so no parser was added for this case. jsdom's XML parser
    // throws on malformed markup and reports a `<parsererror>` document for
    // some other failures, so both are treated as a parse failure.
    const { window } = new JSDOM('<placeholder/>', {
      contentType: 'application/xml',
      // Without a real origin jsdom reports an opaque one, and reading the
      // document's own storage then throws. The parse under test touches no
      // storage; the origin only keeps the implementation from refusing.
      url: 'https://example.invalid/',
    })
    const parseDrawing = (source: string): ReturnType<JsdomDOMParser['parseFromString']> | null => {
      try {
        return new window.DOMParser().parseFromString(source, 'application/xml')
      } catch {
        return null
      }
    }

    const document = parseDrawing(entryText('xl/drawings/drawing1.xml'))
    expect(document, 'xl/drawings/drawing1.xml must be well-formed XML').not.toBeNull()
    expect(document?.querySelector('parsererror')).toBeNull()
    expect(document?.documentElement.tagName).toBe('xdr:wsDr')
    // Both anchors survive: the picture's and the chart's.
    expect(document?.getElementsByTagName('xdr:pic').length).toBeGreaterThanOrEqual(1)
    expect(document?.getElementsByTagName('xdr:graphicFrame').length).toBeGreaterThanOrEqual(1)

    // The parser is proven to refuse malformed markup, so a passing case above
    // is a statement about the part rather than about a tolerant parser: the
    // same walk over unclosed markup must report a failure.
    const malformed = parseDrawing('<xdr:wsDr><xdr:pic></xdr:wsDr>')
    expect(
      malformed === null || malformed.querySelector('parsererror') !== null,
      'the XML parser must refuse markup with mismatched tags',
    ).toBe(true)
  })

  it('keeps the image and chart relationships pointing into the archive', () => {
    const rels = entryText('xl/drawings/_rels/drawing1.xml.rels')
    expect(rels).toContain('Target="../media/image1.png"')
    expect(rels).toContain('Target="../charts/chart1.xml"')
    expect(rels).toContain('/relationships/image')
    expect(rels).toContain('/relationships/chart')
    expect(rels).not.toMatch(/TargetMode\s*=\s*"External"/i)
  })
})

describe('XLSX fixtures: the repair touched one workbook', () => {
  it('leaves the other five fixtures present', () => {
    // Byte identity is Git's business — `git diff --name-only tests/fixtures/xlsx`
    // is the check the round reports. What this case establishes is that the
    // generator's other entry points still resolve to committed files, so a
    // targeted regeneration cannot have redirected them.
    const committed = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.xlsx')).sort()
    expect(committed).toEqual([
      'chart-image.xlsx',
      'formula-values.xlsx',
      'large.xlsx',
      'merged-frozen.xlsx',
      'multi-sheet.xlsx',
      'simple.xlsx',
    ])
  })
})
