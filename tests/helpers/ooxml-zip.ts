/**
 * Deterministic ZIP construction for the OOXML preflight suite.
 *
 * Every archive the preflight suite needs is built here rather than committed as
 * a binary, for a reason that is about test quality rather than repository size.
 * A security fixture is only meaningful if the property under test is *visible
 * in the fixture*: a checked-in ZIP that is supposed to contain `../evil.xml`
 * cannot be reviewed, and a fixture whose declared uncompressed size is a
 * hundred thousand bytes cannot be read out of a diff. Both builders below state
 * their archives in the test that needs them.
 *
 * The two builders exist because the archives divide into two kinds.
 *
 * {@link buildZip} is the ordinary one. It hands the entries to zip.js's own
 * writer, so the bytes are produced by the same library that will read them, and
 * an assertion about a normal Office-like archive is an assertion about what a
 * real writer emits.
 *
 * {@link buildMetadataZip} is the crafted one. A ZIP's central directory carries
 * its own copy of each entry's sizes and encryption flag, and that copy is what
 * the preflight reads — which is exactly the attack surface. A writer will not
 * emit a directory that disagrees with the content it just wrote, so the
 * disagreements that matter have to be assembled by hand. It writes inert,
 * internally consistent bytes and lets the caller declare whatever metadata the
 * case is about.
 *
 * Neither builder is production code and neither may be imported by `src/`.
 */

import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from '@zip.js/zip.js'

/**
 * The password used by the encrypted-entry case.
 *
 * It is a fixed, meaningless string on purpose. The preflight never decrypts
 * anything, so no real secret is involved, and a literal makes the case
 * reproducible from the source alone.
 */
export const TEST_ARCHIVE_PASSWORD = 'test-password'

/** A ZIP entry as {@link buildZip} accepts it. */
export interface ZipEntrySpec {
  /** The entry name, stored exactly as given. */
  readonly name: string
  /** Text content. Omit for a directory or an empty file. */
  readonly text?: string
  /** Binary content, used instead of `text` when a case needs exact bytes. */
  readonly bytes?: Uint8Array<ArrayBuffer>
  /** Encrypt the content with {@link TEST_ARCHIVE_PASSWORD}. */
  readonly encrypt?: boolean
}

/** A ZIP entry as {@link buildMetadataZip} accepts it. */
export interface MetadataEntrySpec {
  /** The entry name, encoded as UTF-8 and stored exactly as given. */
  readonly name: string
  /** Content bytes declared by both headers. Defaults to empty. */
  readonly data?: Uint8Array<ArrayBuffer>
  /**
   * Overrides the compressed size in both the local header and the central
   * directory, so a case can declare a size the content does not have.
   */
  readonly declaredCompressedSize?: number
  /**
   * Overrides the uncompressed size in both the local header and the central
   * directory.
   */
  readonly declaredUncompressedSize?: number
  /** Sets the central directory's encryption bit. */
  readonly encrypted?: boolean
}

/**
 * Build a real archive with zip.js's own writer.
 *
 * @param entries - the entries to write, in order.
 * @returns the archive's bytes.
 */
export async function buildZip(entries: readonly ZipEntrySpec[]): Promise<Uint8Array<ArrayBuffer>> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of entries) {
    const options = entry.encrypt === true ? { password: TEST_ARCHIVE_PASSWORD } : {}
    if (entry.bytes !== undefined) {
      await writer.add(entry.name, new Uint8ArrayReader(entry.bytes), options)
    } else if (entry.text !== undefined) {
      await writer.add(entry.name, new TextReader(entry.text), options)
    } else {
      await writer.add(entry.name, null, options)
    }
  }
  return writer.close()
}

/**
 * Build a minimal Office-like archive that the preflight must accept.
 *
 * The three entries are the ones every OOXML package opens with. Their contents
 * are deliberately not valid Office XML: this fixture exists to show that
 * ordinary archive metadata passes, and the preflight is not permitted to know
 * anything about Office structure, so a fixture with real Office schemas would
 * suggest a guarantee this task does not make.
 *
 * @returns the archive's bytes.
 */
export async function buildOfficeLikeZip(): Promise<Uint8Array<ArrayBuffer>> {
  return buildZip([
    { name: '[Content_Types].xml', text: '<Types/>' },
    { name: '_rels/.rels', text: '<Relationships/>' },
    { name: 'word/document.xml', text: '<w:document/>' },
  ])
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

const CRC32_TABLE = buildCrc32Table()

/**
 * Build the lookup table for CRC-32 (the reflected IEEE polynomial).
 * @returns 256 precomputed table entries.
 */
function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

/**
 * Compute a CRC-32 over some bytes.
 * @param bytes - the bytes to checksum.
 * @returns the checksum as an unsigned 32-bit number.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Write a 16-bit little-endian value.
 * @param value - the value.
 * @param out - the byte sink.
 */
function writeUint16(value: number, out: number[]): void {
  out.push(value & 0xff, (value >>> 8) & 0xff)
}

/**
 * Write a 32-bit little-endian value.
 * @param value - the value.
 * @param out - the byte sink.
 */
function writeUint32(value: number, out: number[]): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

/**
 * Assemble the central directory's copy of one entry's metadata.
 *
 * Compact enough to read as the field list it is, which is the point: the
 * offsets that decide what the preflight sees are visible in the source rather
 * than buried in a byte array.
 *
 * @param spec - the entry.
 * @param name - the encoded name.
 * @param localHeaderOffset - where this entry's local header begins.
 * @param size - the declared sizes and checksum.
 * @returns the central directory record, including its signature.
 */
function centralHeader(
  spec: MetadataEntrySpec,
  name: readonly number[],
  localHeaderOffset: number,
  size: { readonly compressed: number; readonly uncompressed: number; readonly crc: number },
): number[] {
  const out: number[] = []
  writeUint32(CENTRAL_HEADER_SIGNATURE, out)
  writeUint16(20, out) // version made by
  writeUint16(20, out) // version needed to extract
  writeUint16(spec.encrypted === true ? 0x0001 : 0x0800, out) // flags: encrypted, or UTF-8 name
  writeUint16(0, out) // compression method: stored
  writeUint16(0, out) // modification time
  writeUint16(0x2821, out) // modification date
  writeUint32(size.crc, out)
  writeUint32(size.compressed, out)
  writeUint32(size.uncompressed, out)
  writeUint16(name.length, out)
  writeUint16(0, out) // extra field length
  writeUint16(0, out) // comment length
  writeUint16(0, out) // disk number
  writeUint16(0, out) // internal attributes
  writeUint32(0, out) // external attributes
  writeUint32(localHeaderOffset, out)
  out.push(...name)
  return out
}

/**
 * Build a ZIP whose declared metadata is under the caller's control.
 *
 * Entries are written with the stored method and consistent checksums, so the
 * archive is parseable; only the sizes and the encryption flag are the caller's
 * to state. Names are UTF-8 and the language-encoding flag is set, so a name
 * containing a NUL or a non-ASCII character survives the round trip unchanged —
 * which is what makes the path cases testable at all.
 *
 * @param entries - the entries to write, in order.
 * @returns the archive's bytes.
 */
export function buildMetadataZip(entries: readonly MetadataEntrySpec[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const localParts: number[] = []
  const centralParts: number[] = []
  let offset = 0

  for (const spec of entries) {
    const name = [...encoder.encode(spec.name)]
    const data = [...(spec.data ?? new Uint8Array(0))]
    const compressed = spec.declaredCompressedSize ?? data.length
    const uncompressed = spec.declaredUncompressedSize ?? data.length
    const size = { compressed, uncompressed, crc: crc32(Uint8Array.from(data)) }

    const local: number[] = []
    writeUint32(LOCAL_HEADER_SIGNATURE, local)
    writeUint16(20, local) // version needed to extract
    writeUint16(spec.encrypted === true ? 0x0001 : 0x0800, local)
    writeUint16(0, local) // compression method: stored
    writeUint16(0, local) // modification time
    writeUint16(0x2821, local) // modification date
    writeUint32(size.crc, local)
    writeUint32(compressed, local)
    writeUint32(uncompressed, local)
    writeUint16(name.length, local)
    writeUint16(0, local) // extra field length
    local.push(...name, ...data)

    centralParts.push(...centralHeader(spec, name, offset, size))
    localParts.push(...local)
    offset += local.length
  }

  const out: number[] = [...localParts, ...centralParts]
  writeUint32(END_OF_CENTRAL_DIRECTORY_SIGNATURE, out)
  writeUint16(0, out) // disk number
  writeUint16(0, out) // disk with central directory
  writeUint16(entries.length, out)
  writeUint16(entries.length, out)
  writeUint32(centralParts.length, out)
  writeUint32(localParts.length, out)
  writeUint16(0, out) // comment length

  return Uint8Array.from(out)
}
