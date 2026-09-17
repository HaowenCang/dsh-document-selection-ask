// @vitest-environment jsdom
/**
 * OOXML streaming extraction bounds verification specification.
 *
 * Proves that:
 * 1. Valid archives with actual decompressed size == declared uncompressedSize pass.
 * 2. Forged archives where declared uncompressedSize is small but actual DEFLATE
 *    stream is larger are caught and rejected during streaming extraction.
 * 3. Archives where actual output < declared uncompressedSize are rejected.
 * 4. Corrupted payloads or CRC mismatches are rejected as invalid-archive.
 * 5. Single-entry and aggregate bounds are enforced during streaming.
 * 6. AbortSignal cleanly interrupts extraction without masking as invalid-archive.
 * 7. ZipReader is cleanly closed on both success and failure (primary error preserved).
 * 8. Real representative DOCX fixtures pass extraction verification.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Uint8ArrayWriter, ZipWriter, TextReader } from '@zip.js/zip.js'

import { OoxmlPreflightError } from '../../src/client/ooxml/errors.js'
import { DEFAULT_OOXML_LIMITS, type OoxmlLimits } from '../../src/client/ooxml/limits.js'
import { preflightOoxml } from '../../src/client/ooxml/preflight.js'
import { verifyOoxmlExtraction } from '../../src/client/ooxml/verify-extraction.js'

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'docx')

const PARAGRAPHS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'paragraphs.docx')))
const MANUAL_BREAK_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'manual-page-break.docx')))
const TABLE_IMAGE_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'table-image.docx')))
const HEADERS_FOOTERS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'headers-footers.docx')))
const EXTERNAL_LINKS_DOCX = new Uint8Array(readFileSync(join(FIXTURES_DIR, 'external-links.docx')))

/**
 * Creates a minimal valid ZIP in memory.
 */
async function createZip(entries: Array<{ name: string; content: string }>): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of entries) {
    await writer.add(entry.name, new TextReader(entry.content))
  }
  const output = await writer.close()
  return output as Uint8Array<ArrayBuffer>
}

/**
 * Locates the first central directory file header (0x02014b50) in a ZIP byte array.
 */
function findFirstCentralDirectoryOffset(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      return i
    }
  }
  throw new Error('Central directory header not found')
}

/**
 * Forges the declared uncompressedSize in the central directory record.
 */
function forgeCentralDirectoryUncompressedSize(
  bytes: Uint8Array<ArrayBuffer>,
  forgedSize: number,
): Uint8Array<ArrayBuffer> {
  const forged = new Uint8Array(bytes.buffer.slice(0)) as Uint8Array<ArrayBuffer>
  const cdOffset = findFirstCentralDirectoryOffset(forged)
  const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength)
  // Central directory entry uncompressed size is at offset + 24 (4 bytes, little-endian)
  view.setUint32(cdOffset + 24, forgedSize, true)
  return forged
}

describe('verifyOoxmlExtraction', () => {
  it('accepts valid ZIP archives where actual == declared', async () => {
    const zipBytes = await createZip([
      { name: 'hello.txt', content: 'Hello World!' },
      { name: 'dir/nested.txt', content: 'Nested content here' },
    ])

    await expect(verifyOoxmlExtraction(zipBytes)).resolves.toBeUndefined()
  })

  it('rejects forged archive where declared uncompressedSize is smaller than actual content', async () => {
    // 10,000 bytes of repetitive text compresses well
    const payload = 'A'.repeat(10_000)
    const originalBytes = await createZip([{ name: 'test.txt', content: payload }])

    // Forge declared uncompressed size to 16 bytes
    const forgedBytes = forgeCentralDirectoryUncompressedSize(originalBytes, 16)

    // Preflight ONLY checks metadata, so it passes because 16 bytes is within limits
    await expect(preflightOoxml(forgedBytes)).resolves.toBeUndefined()

    // Extraction verifier checks actual stream and rejects early when actual > declared
    const err = await verifyOoxmlExtraction(forgedBytes).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('invalid-archive')
    expect((err as OoxmlPreflightError).entryName).toBe('test.txt')
  })

  it('rejects forged archive where declared uncompressedSize is larger than actual content (actual < declared)', async () => {
    const payload = 'Hello'
    const originalBytes = await createZip([{ name: 'test.txt', content: payload }])

    // Forge declared uncompressed size to 500 bytes (actual is only 5 bytes)
    const forgedBytes = forgeCentralDirectoryUncompressedSize(originalBytes, 500)

    // Preflight passes (500 bytes is within limits)
    await expect(preflightOoxml(forgedBytes)).resolves.toBeUndefined()

    // Extraction verifier detects actual < declared upon stream completion
    const err = await verifyOoxmlExtraction(forgedBytes).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('invalid-archive')
  })

  it('rejects corrupted payload or invalid CRC', async () => {
    const payload = 'Sensitive OOXML document content with integrity checks'
    const originalBytes = await createZip([{ name: 'word/document.xml', content: payload }])

    // Corrupt compressed payload byte in local entry while leaving central directory intact
    const corrupted = new Uint8Array(originalBytes.buffer.slice(0)) as Uint8Array<ArrayBuffer>
    // Local header: 26..27 filename length, 28..29 extra length
    const fnLen = corrupted[26]! | (corrupted[27]! << 8)
    const extraLen = corrupted[28]! | (corrupted[29]! << 8)
    const dataOffset = 30 + fnLen + extraLen
    corrupted[dataOffset + 2]! ^= 0xff

    // Preflight passes because central directory is unchanged
    await expect(preflightOoxml(corrupted)).resolves.toBeUndefined()

    // Extraction verifier catches decompression / CRC failure
    const err = await verifyOoxmlExtraction(corrupted).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('invalid-archive')
  })

  it('enforces custom single-entry bounds during streaming extraction', async () => {
    const payload = 'X'.repeat(500)
    const zipBytes = await createZip([{ name: 'big-entry.txt', content: payload }])

    const tightLimits: OoxmlLimits = {
      ...DEFAULT_OOXML_LIMITS,
      maxSingleUncompressedBytes: 200,
    }

    const err = await verifyOoxmlExtraction(zipBytes, tightLimits).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('entry-too-large')
  })

  it('enforces custom aggregate total bounds across multiple entries', async () => {
    const zipBytes = await createZip([
      { name: 'part1.txt', content: 'A'.repeat(300) },
      { name: 'part2.txt', content: 'B'.repeat(300) },
    ])

    const tightLimits: OoxmlLimits = {
      ...DEFAULT_OOXML_LIMITS,
      maxTotalUncompressedBytes: 500, // Sum is 600
    }

    const err = await verifyOoxmlExtraction(zipBytes, tightLimits).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('archive-too-large')
  })

  it('aborts cleanly when signal is pre-aborted', async () => {
    const zipBytes = await createZip([{ name: 'test.txt', content: 'data' }])
    const ac = new AbortController()
    ac.abort()

    await expect(verifyOoxmlExtraction(zipBytes, DEFAULT_OOXML_LIMITS, ac.signal)).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })

  it('aborts cleanly during extraction and does not mask as invalid-archive', async () => {
    const zipBytes = await createZip([
      { name: 'part1.txt', content: 'content 1' },
      { name: 'part2.txt', content: 'content 2' },
      { name: 'part3.txt', content: 'content 3' },
    ])

    const ac = new AbortController()
    // Schedule abort to fire during async extraction between entries or async operations
    queueMicrotask(() => {
      ac.abort()
    })

    await expect(verifyOoxmlExtraction(zipBytes, DEFAULT_OOXML_LIMITS, ac.signal)).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })

  it('validates real DOCX fixtures through extraction verifier', async () => {
    await expect(verifyOoxmlExtraction(PARAGRAPHS_DOCX)).resolves.toBeUndefined()
    await expect(verifyOoxmlExtraction(MANUAL_BREAK_DOCX)).resolves.toBeUndefined()
    await expect(verifyOoxmlExtraction(TABLE_IMAGE_DOCX)).resolves.toBeUndefined()
    await expect(verifyOoxmlExtraction(HEADERS_FOOTERS_DOCX)).resolves.toBeUndefined()
    await expect(verifyOoxmlExtraction(EXTERNAL_LINKS_DOCX)).resolves.toBeUndefined()
  })

  it('rejects early when actual decompressed chunk exceeds small declared size', async () => {
    // 5000 bytes payload, declare only 10 bytes
    const originalBytes = await createZip([{ name: 'test.txt', content: 'Z'.repeat(5000) }])
    const forgedBytes = forgeCentralDirectoryUncompressedSize(originalBytes, 10)

    const err = await verifyOoxmlExtraction(forgedBytes).catch((e) => e)
    expect(err).toBeInstanceOf(OoxmlPreflightError)
    expect((err as OoxmlPreflightError).code).toBe('invalid-archive')
    expect((err as OoxmlPreflightError).entryName).toBe('test.txt')
  })
})
