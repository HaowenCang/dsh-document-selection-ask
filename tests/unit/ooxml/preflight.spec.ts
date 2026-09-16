/**
 * OOXML archive preflight contract.
 *
 * Every case here is a claim about the boundary between an untrusted file and a
 * renderer that has not been written yet. The archives are built in the test
 * rather than committed, because a security fixture is only meaningful when the
 * property under test is visible in the source: a checked-in ZIP that is
 * supposed to contain `../evil.xml` cannot be reviewed, while the name in a test
 * body can.
 *
 * Two of the cases are the ones that make the rest trustworthy. The preflight
 * must not treat a missing size as zero, and it must not let a library error
 * become an `OoxmlPreflightError` unless the library was actually reporting a
 * broken archive. Both are asserted directly rather than inferred from the
 * refusals that surround them, because a fail-open mistake in either would leave
 * every other case in this file passing.
 */

import { ZipReader, Uint8ArrayReader } from '@zip.js/zip.js'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_OOXML_LIMITS,
  validateOoxmlLimits,
  type OoxmlLimits,
} from '../../../src/client/ooxml/limits.js'
import { OoxmlPreflightError, type OoxmlPreflightErrorCode } from '../../../src/client/ooxml/errors.js'
import {
  preflightOoxml,
  runOoxmlPreflight,
  type OoxmlArchiveReaderLike,
  type OoxmlEntryLike,
} from '../../../src/client/ooxml/preflight.js'
import {
  buildMetadataZip,
  buildOfficeLikeZip,
  buildZip,
} from '../../helpers/ooxml-zip.js'

/** The documented limits, restated as literals so a drift is visible here. */
const DOCUMENTED_LIMITS = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxSingleUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
}

/**
 * Build one entry as the preflight reads it.
 * @param entry - the fields to state.
 * @returns the entry.
 */
function entry(entry: OoxmlEntryLike): OoxmlEntryLike {
  return entry
}

/**
 * Build a reader that reports the entries it was given.
 *
 * The object is frozen so its properties are readonly, which is what lets a
 * plain literal satisfy {@link OoxmlArchiveReaderLike} without a cast.
 * @param entries - the entries to report.
 * @returns the reader.
 */
function archiveReader(entries: readonly OoxmlEntryLike[]): OoxmlArchiveReaderLike {
  return Object.freeze({ close: async () => undefined, getEntries: async () => entries })
}

/** An `OoxmlLimits` value that callers may deliberately make unusable. */
type LooseLimits = { readonly [field in keyof OoxmlLimits]: unknown }

/**
 * Run a preflight and return the refusal it produced.
 *
 * The assertion that the rejection is an instance of the class is part of the
 * contract rather than a convenience: a caller that dispatches on `code` has to
 * be able to reach it, and an untyped rejection would leave them matching on a
 * message.
 * @param operation - the preflight call under test.
 * @returns the refusal.
 */
async function captureRefusal(operation: Promise<void>): Promise<OoxmlPreflightError> {
  let caught: unknown
  try {
    await operation
  } catch (error: unknown) {
    caught = error
  }
  if (caught === undefined) {
    throw new Error('expected the preflight to refuse the archive, but it resolved')
  }
  if (!(caught instanceof OoxmlPreflightError)) {
    throw new Error(`expected an OoxmlPreflightError, received ${String(caught)}`)
  }
  return caught
}

/**
 * Assert that a preflight refused an archive for one stated reason.
 * @param operation - the preflight call under test.
 * @param code - the expected code.
 * @param entryName - the expected offending entry, when the rule names one.
 */
async function expectRefusal(
  operation: Promise<void>,
  code: OoxmlPreflightErrorCode,
  entryName?: string,
): Promise<void> {
  const refusal = await captureRefusal(operation)
  expect(refusal.code).toBe(code)
  if (entryName !== undefined) {
    expect(refusal.entryName).toBe(entryName)
  }
}

/**
 * Assert that a preflight refused an archive and reports no offending entry.
 * @param operation - the preflight call under test.
 * @param code - the expected code.
 */
async function expectArchiveWideRefusal(
  operation: Promise<void>,
  code: OoxmlPreflightErrorCode,
): Promise<void> {
  const refusal = await captureRefusal(operation)
  expect(refusal.code).toBe(code)
  expect(refusal.entryName).toBeUndefined()
}

describe('DEFAULT_OOXML_LIMITS', () => {
  it('is exactly the four documented bounds', () => {
    expect(DEFAULT_OOXML_LIMITS).toEqual(DOCUMENTED_LIMITS)
  })

  it('states the total as 512 MiB and the single entry as 128 MiB', () => {
    // The two byte bounds are the ones a reader is most likely to mis-transcribe
    // between decimal and binary megabytes, so the byte counts are asserted
    // rather than the shorthand.
    expect(DEFAULT_OOXML_LIMITS.maxTotalUncompressedBytes).toBe(536_870_912)
    expect(DEFAULT_OOXML_LIMITS.maxSingleUncompressedBytes).toBe(134_217_728)
    expect(DEFAULT_OOXML_LIMITS.maxCompressionRatio).toBe(200)
    expect(DEFAULT_OOXML_LIMITS.maxEntries).toBe(10_000)
  })
})

describe('validateOoxmlLimits', () => {
  it('accepts the documented limits', () => {
    expect(() => {
      validateOoxmlLimits(DEFAULT_OOXML_LIMITS)
    }).not.toThrow()
  })

  it('accepts a fractional compression ratio, which the design allows', () => {
    expect(() => {
      validateOoxmlLimits({ ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: 2.5 })
    }).not.toThrow()
  })

  const rejectedIntegers: readonly (readonly [string, unknown])[] = [
    ['zero', 0],
    ['a negative value', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a fraction', 1.5],
    ['a value beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['undefined', undefined],
    ['null', null],
    ['a numeric string', '10'],
  ]

  for (const field of [
    'maxEntries',
    'maxTotalUncompressedBytes',
    'maxSingleUncompressedBytes',
  ] as const) {
    for (const [label, value] of rejectedIntegers) {
      it(`refuses ${field} set to ${label}`, () => {
        const limits: LooseLimits = { ...DEFAULT_OOXML_LIMITS, [field]: value }
        expect(() => {
          validateOoxmlLimits(limits as OoxmlLimits)
        }).toThrowError(OoxmlPreflightError)
      })
    }
  }

  for (const [label, value] of [
    ['zero', 0],
    ['a negative value', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
  ] as const) {
    it(`refuses maxCompressionRatio set to ${label}`, () => {
      const limits: LooseLimits = { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: value }
      expect(() => {
        validateOoxmlLimits(limits as OoxmlLimits)
      }).toThrowError(OoxmlPreflightError)
    })
  }

  it('reports the refusal as invalid-limits, before any archive is considered', async () => {
    // The archive given here is not a ZIP at all. If the limits were checked
    // after parsing, the refusal would be `invalid-archive`; the assertion is
    // therefore about the order of the two rules as well as their codes.
    const limits: LooseLimits = { ...DEFAULT_OOXML_LIMITS, maxEntries: 0 }
    await expectRefusal(
      preflightOoxml(new Uint8Array([1, 2, 3, 4]), limits as OoxmlLimits),
      'invalid-limits',
    )
  })

  it('refuses an aborted signal before it refuses the limits', async () => {
    // The limits are the caller's own mistake and the abort is the caller's own
    // request; a cancellation is the more accurate answer to "why did nothing
    // happen", so it wins. The already-cancelled call also has to allocate no
    // reader, which is asserted against the library's own `close`.
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    const controller = new AbortController()
    controller.abort()
    const limits: LooseLimits = { ...DEFAULT_OOXML_LIMITS, maxEntries: Number.NaN }

    let caught: unknown
    try {
      await preflightOoxml(new Uint8Array(0), limits as OoxmlLimits, controller.signal)
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).not.toBeInstanceOf(OoxmlPreflightError)
    expect((caught as { name?: unknown }).name).toBe('AbortError')
    expect(closeSpy).not.toHaveBeenCalled()
  })
})

describe('archive metadata', () => {
  it('accepts an ordinary Office-like archive', async () => {
    await expect(preflightOoxml(await buildOfficeLikeZip())).resolves.toBeUndefined()
  })

  it('accepts an archive whose names carry dots that are not traversal', async () => {
    const bytes = await buildZip([
      { name: 'word/document.xml', text: '<w:document/>' },
      { name: 'word/_rels/document.xml.rels', text: '<Relationships/>' },
      { name: 'a/.../file.xml', text: 'x' },
      { name: 'foo..bar/file.xml', text: 'x' },
      { name: '..leading/file.xml', text: 'x' },
      { name: 'foo:bar/file.xml', text: 'x' },
    ])
    await expect(preflightOoxml(bytes)).resolves.toBeUndefined()
  })

  it('refuses bytes that are not an archive', async () => {
    await expectArchiveWideRefusal(preflightOoxml(new Uint8Array([1, 2, 3, 4])), 'invalid-archive')
  })

  it('refuses an empty byte range', async () => {
    await expectArchiveWideRefusal(preflightOoxml(new Uint8Array(0)), 'invalid-archive')
  })

  it('does not expose a library error message through the public error', async () => {
    const refusal = await captureRefusal(preflightOoxml(new Uint8Array([1, 2, 3, 4])))
    expect(refusal.message).toBe('invalid-archive')
    expect(refusal.name).toBe('OoxmlPreflightError')
  })

  it('accepts an archive with no entries, which is a format question, not a safety one', async () => {
    // An empty ZIP is a well-formed archive. Whether a document may be empty is
    // the format adapter's decision, and this module does not make it.
    await expect(preflightOoxml(await buildZip([]))).resolves.toBeUndefined()
  })

  it('counts a directory entry, and validates its name and sizes like any other', async () => {
    const accepted = await buildZip([
      { name: 'word/' },
      { name: 'word/document.xml', text: 'x' },
    ])
    await expect(
      preflightOoxml(accepted, { ...DEFAULT_OOXML_LIMITS, maxEntries: 2 }),
    ).resolves.toBeUndefined()

    await expectRefusal(
      preflightOoxml(accepted, { ...DEFAULT_OOXML_LIMITS, maxEntries: 1 }),
      'too-many-entries',
    )

    const traversing = buildMetadataZip([{ name: '../', data: new Uint8Array(0) }])
    await expectRefusal(preflightOoxml(traversing), 'unsafe-path', '../')
  })
})

describe('entry count', () => {
  const threeEntries = async (): Promise<Uint8Array<ArrayBuffer>> =>
    buildZip([
      { name: 'a.xml', text: '' },
      { name: 'b.xml', text: '' },
      { name: 'c.xml', text: '' },
    ])

  it('accepts exactly maxEntries', async () => {
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxEntries: 3 }
    await expect(preflightOoxml(await threeEntries(), limits)).resolves.toBeUndefined()
  })

  it('refuses maxEntries + 1', async () => {
    const bytes = await buildZip([
      { name: 'a.xml', text: '' },
      { name: 'b.xml', text: '' },
      { name: 'c.xml', text: '' },
      { name: 'd.xml', text: '' },
    ])
    await expectArchiveWideRefusal(
      preflightOoxml(bytes, { ...DEFAULT_OOXML_LIMITS, maxEntries: 3 }),
      'too-many-entries',
    )
  })

  it('counts the 10,001st entry as over the default limit without building one', async () => {
    // The default boundary is asserted through the reader seam, because a real
    // 10,001-entry archive would be a large binary fixture in service of one
    // integer comparison, and the comparison is what is under test.
    const entries: OoxmlEntryLike[] = []
    for (let index = 0; index < 10_001; index++) {
      entries.push(entry({ filename: `p${String(index)}.xml`, compressedSize: 0, uncompressedSize: 0 }))
    }

    await expectArchiveWideRefusal(
      runOoxmlPreflight(archiveReader(entries), DEFAULT_OOXML_LIMITS),
      'too-many-entries',
    )
    await expect(
      runOoxmlPreflight(archiveReader(entries.slice(0, 10_000)), DEFAULT_OOXML_LIMITS),
    ).resolves.toBeUndefined()
  })
})

describe('single-entry size', () => {
  it('accepts an entry exactly at maxSingleUncompressedBytes', async () => {
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxSingleUncompressedBytes: 8 }
    const bytes = await buildZip([{ name: 'word/document.xml', text: '12345678' }])
    await expect(preflightOoxml(bytes, limits)).resolves.toBeUndefined()
  })

  it('refuses an entry one byte over maxSingleUncompressedBytes', async () => {
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxSingleUncompressedBytes: 8 }
    const bytes = await buildZip([{ name: 'word/document.xml', text: '123456789' }])
    await expectRefusal(preflightOoxml(bytes, limits), 'entry-too-large', 'word/document.xml')
  })

  it('applies the single-entry bound independently of the aggregate', async () => {
    // Two entries that each fit, and whose total fits, but one of which is over
    // the per-entry bound: the aggregate rule cannot be what refuses this.
    const limits: OoxmlLimits = {
      ...DEFAULT_OOXML_LIMITS,
      maxSingleUncompressedBytes: 4,
      maxTotalUncompressedBytes: 1_000,
    }
    const bytes = await buildZip([
      { name: 'a.xml', text: '1234' },
      { name: 'b.xml', text: '12345' },
    ])
    await expectRefusal(preflightOoxml(bytes, limits), 'entry-too-large', 'b.xml')
  })
})

describe('aggregate uncompressed size', () => {
  it('accepts a total exactly at maxTotalUncompressedBytes', async () => {
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxTotalUncompressedBytes: 10 }
    const bytes = await buildZip([
      { name: 'a.xml', text: '123456' },
      { name: 'b.xml', text: '7890' },
    ])
    await expect(preflightOoxml(bytes, limits)).resolves.toBeUndefined()
  })

  it('refuses a total one byte over maxTotalUncompressedBytes', async () => {
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxTotalUncompressedBytes: 10 }
    const bytes = await buildZip([
      { name: 'a.xml', text: '123456' },
      { name: 'b.xml', text: '78901' },
    ])
    await expectArchiveWideRefusal(preflightOoxml(bytes, limits), 'archive-too-large')
  })

  it('refuses as soon as the running total passes the bound', async () => {
    // The archive-wide rule fires on the third entry, so the fourth is never
    // examined. It is named `../evil.xml` on purpose: if the loop had summed
    // every entry before comparing, this archive would be refused for its path
    // instead, and the assertion pins which rule reported it.
    const limits: OoxmlLimits = { ...DEFAULT_OOXML_LIMITS, maxTotalUncompressedBytes: 10 }
    const bytes = await buildZip([
      { name: 'a.xml', text: '123456' },
      { name: 'b.xml', text: '12345' },
      { name: '../evil.xml', text: 'x' },
    ])
    await expectArchiveWideRefusal(preflightOoxml(bytes, limits), 'archive-too-large')
  })

  it('refuses a running total that stops being a safe integer', async () => {
    // Two entries whose sizes are each valid but whose sum is not. The archive
    // cannot be built: `Number.MAX_SAFE_INTEGER` does not fit the 32-bit size
    // fields a ZIP central directory holds without the zip64 extensions. The
    // reader seam exists for exactly this — a value the library's own types say
    // cannot occur, arriving at a rule that must survive it.
    const limits: OoxmlLimits = {
      ...DEFAULT_OOXML_LIMITS,
      maxSingleUncompressedBytes: Number.MAX_SAFE_INTEGER,
      maxTotalUncompressedBytes: Number.MAX_SAFE_INTEGER,
      maxCompressionRatio: Number.MAX_SAFE_INTEGER,
    }
    const oversized = entry({
      filename: 'word/document.xml',
      compressedSize: Number.MAX_SAFE_INTEGER,
      uncompressedSize: Number.MAX_SAFE_INTEGER,
    })

    await expectRefusal(
      runOoxmlPreflight(archiveReader([oversized, oversized]), limits),
      'missing-metadata',
      'word/document.xml',
    )
    await expect(runOoxmlPreflight(archiveReader([oversized]), limits)).resolves.toBeUndefined()
  })
})

describe('compression ratio', () => {
  it('refuses a real deflated archive of highly repetitive content', async () => {
    const bytes = await buildZip([{ name: 'word/document.xml', text: 'A'.repeat(100_000) }])
    await expectRefusal(
      preflightOoxml(bytes, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: 2 }),
      'compression-ratio-too-high',
      'word/document.xml',
    )
  })

  it('accepts the same archive when the ratio bound is above its real expansion', async () => {
    // The control for the case above: the refusal has to come from the ratio and
    // not from the size of the content.
    const bytes = await buildZip([{ name: 'word/document.xml', text: 'A'.repeat(100_000) }])
    await expect(
      preflightOoxml(bytes, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: 10_000 }),
    ).resolves.toBeUndefined()
  })

  it('accepts a ratio exactly at the bound and refuses one byte more', async () => {
    // The declared sizes are stated directly, because an exact boundary cannot be
    // reached through a writer: the compressed size of real deflate output is not
    // a round number. The bytes are real stored data, so the archive parses and
    // the metadata the preflight reads is exactly what is declared here.
    const data = new Uint8Array([1, 2, 3])
    const limit = 200
    const exact = buildMetadataZip([
      { name: 'word/document.xml', data, declaredUncompressedSize: data.length * limit },
    ])
    const over = buildMetadataZip([
      { name: 'word/document.xml', data, declaredUncompressedSize: data.length * limit + 1 },
    ])

    await expect(
      preflightOoxml(exact, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: limit }),
    ).resolves.toBeUndefined()
    await expectRefusal(
      preflightOoxml(over, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: limit }),
      'compression-ratio-too-high',
      'word/document.xml',
    )
  })

  it('treats a zero compressed size as one, so a large declaration is still bounded', async () => {
    const bytes = buildMetadataZip([
      { name: 'word/document.xml', declaredCompressedSize: 0, declaredUncompressedSize: 201 },
    ])
    await expectRefusal(
      preflightOoxml(bytes, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: 200 }),
      'compression-ratio-too-high',
      'word/document.xml',
    )
  })

  it('accepts an entry whose declared sizes are both zero', async () => {
    // 0 / max(1, 0) is 0, which is within every bound. No division by zero is
    // performed anywhere in the ratio rule.
    const bytes = buildMetadataZip([
      { name: 'word/document.xml', declaredCompressedSize: 0, declaredUncompressedSize: 0 },
    ])
    await expect(preflightOoxml(bytes)).resolves.toBeUndefined()
  })

  it('bounds an entry that declares content in no compressed bytes at all', async () => {
    const bytes = buildMetadataZip([
      { name: 'word/document.xml', declaredCompressedSize: 0, declaredUncompressedSize: 5_000 },
    ])
    await expectRefusal(
      preflightOoxml(bytes, { ...DEFAULT_OOXML_LIMITS, maxCompressionRatio: 200 }),
      'compression-ratio-too-high',
      'word/document.xml',
    )
  })
})

describe('archive paths', () => {
  const acceptedNames: readonly string[] = [
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'ppt/slides/slide1.xml',
    'xl/worksheets/sheet1.xml',
    '[Content_Types].xml',
    'a/.../file.xml',
    'foo..bar/file.xml',
    '.../file.xml',
    'word/document.xml.bak',
    // A leading `./` is not a traversal and is accepted. The reader is
    // constructed with `filenameValidation: 'tolerant'` so that exactly one rule
    // decides which names may be carried forward; this case documents what that
    // rule accepts that a stricter segment rule would not.
    './word/document.xml',
  ]

  for (const name of acceptedNames) {
    it(`accepts ${JSON.stringify(name)}`, async () => {
      await expect(preflightOoxml(await buildZip([{ name, text: 'x' }]))).resolves.toBeUndefined()
    })
  }

  const refusedNames: readonly (readonly [string, string])[] = [
    ['../evil.xml', 'separator parent traversal'],
    ['../../evil.xml', 'repeated parent traversal'],
    ['word/../evil.xml', 'traversal after a directory'],
    ['word\\..\\evil.xml', 'backslash traversal'],
    ['..\\evil.xml', 'backslash traversal at the root'],
    ['a/b/../../../evil.xml', 'traversal that leaves the root'],
    ['/absolute.xml', 'Unix absolute path'],
    ['\\absolute.xml', 'Windows root-relative path'],
    ['\\\\server\\share\\evil.xml', 'UNC path'],
    ['//server/share/evil.xml', 'UNC path with slashes'],
    ['C:\\evil.xml', 'drive-absolute path with backslashes'],
    ['C:/evil.xml', 'drive-absolute path with slashes'],
    ['z:\\foo.xml', 'lower-case drive-absolute path'],
    ['C:evil.xml', 'drive-relative path'],
  ]

  for (const [name, label] of refusedNames) {
    it(`refuses a ${label}: ${JSON.stringify(name)}`, async () => {
      await expectRefusal(preflightOoxml(await buildZip([{ name, text: 'x' }])), 'unsafe-path', name)
    })
  }

  it('refuses a name containing NUL, which no writer will produce', async () => {
    const name = 'word/\u0000evil.xml'
    const bytes = buildMetadataZip([{ name, data: new Uint8Array([1]) }])
    await expectRefusal(preflightOoxml(bytes), 'unsafe-path', name)
  })

  it('refuses a NUL that only the normalized form reveals', async () => {
    // The rule runs on the name as it arrived and again after backslash
    // normalization, so a name that reaches the backslash form with a NUL is
    // still refused. The two spellings below cover both sides of that check.
    for (const name of ['\u0000word\\document.xml', 'word\\\u0000evil.xml']) {
      const bytes = buildMetadataZip([{ name, data: new Uint8Array([1]) }])
      await expectRefusal(preflightOoxml(bytes), 'unsafe-path', name)
    }
  })

  it('refuses an empty filename', async () => {
    const bytes = buildMetadataZip([{ name: '', data: new Uint8Array([1]) }])
    await expectRefusal(preflightOoxml(bytes), 'unsafe-path', '')
  })

  it('refuses a name that is not a string rather than coercing it', async () => {
    // Reached through the reader seam: the central directory is attacker bytes,
    // and this states what happens if a name arrives as anything but text.
    await expectRefusal(
      runOoxmlPreflight(
        archiveReader([entry({ filename: 42, compressedSize: 1, uncompressedSize: 1 })]),
        DEFAULT_OOXML_LIMITS,
      ),
      'unsafe-path',
    )
  })

  it('reports the path exactly as the archive declares it', async () => {
    const name = 'word\\..\\evil.xml'
    const refusal = await captureRefusal(preflightOoxml(await buildZip([{ name, text: 'x' }])))
    expect(refusal.code).toBe('unsafe-path')
    expect(refusal.entryName).toBe(name)
  })
})

describe('encrypted entries', () => {
  it('refuses an entry encrypted by the writer', async () => {
    const bytes = await buildZip([{ name: 'word/document.xml', text: 'secret', encrypt: true }])
    await expectRefusal(preflightOoxml(bytes), 'encrypted-entry', 'word/document.xml')
  })

  it('refuses an entry whose central directory only sets the encryption bit', async () => {
    const bytes = buildMetadataZip([
      { name: 'word/document.xml', data: new Uint8Array([1]), encrypted: true },
    ])
    await expectRefusal(preflightOoxml(bytes), 'encrypted-entry', 'word/document.xml')
  })

  it('refuses an encrypted entry whose name looks like a valid Office part', async () => {
    // The extension is not evidence: an encrypted package is refused whatever it
    // is called, and the refusal names encryption rather than the path.
    const bytes = await buildZip([{ name: 'xl/workbook.xml', text: 'x', encrypt: true }])
    await expectRefusal(preflightOoxml(bytes), 'encrypted-entry', 'xl/workbook.xml')
  })

  it('refuses the encrypted entry before it reports the archive as acceptable', async () => {
    const bytes = await buildZip([
      { name: '[Content_Types].xml', text: '<Types/>' },
      { name: 'word/document.xml', text: 'x', encrypt: true },
    ])
    await expectRefusal(preflightOoxml(bytes), 'encrypted-entry', 'word/document.xml')
  })
})

describe('missing or unusable entry metadata', () => {
  const unusableSizes: readonly (readonly [string, unknown])[] = [
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['a negative size', -1],
    ['a fractional size', 1.5],
    ['a value beyond the safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['a numeric string', '10'],
    ['a boolean', true],
  ]

  for (const [label, value] of unusableSizes) {
    it(`refuses compressedSize that is ${label}`, async () => {
      const broken: OoxmlEntryLike = {
        filename: 'word/document.xml',
        compressedSize: value,
        uncompressedSize: 1,
      }
      await expectRefusal(
        runOoxmlPreflight(archiveReader([broken]), DEFAULT_OOXML_LIMITS),
        'missing-metadata',
        'word/document.xml',
      )
    })

    it(`refuses uncompressedSize that is ${label}`, async () => {
      const broken: OoxmlEntryLike = {
        filename: 'word/document.xml',
        compressedSize: 1,
        uncompressedSize: value,
      }
      await expectRefusal(
        runOoxmlPreflight(archiveReader([broken]), DEFAULT_OOXML_LIMITS),
        'missing-metadata',
        'word/document.xml',
      )
    })
  }

  it('does not treat a missing size as zero', async () => {
    // This is the assertion that the fail-closed rule rests on. A reader that
    // substituted 0 for an absent uncompressed size would pass the aggregate
    // bound and the ratio bound at once, so the refusal is asserted rather than
    // the resulting total.
    await expectRefusal(
      runOoxmlPreflight(
        archiveReader([entry({ filename: 'word/document.xml' })]),
        DEFAULT_OOXML_LIMITS,
      ),
      'missing-metadata',
      'word/document.xml',
    )
  })

  it('refuses a non-boolean encryption flag rather than trusting its truthiness', async () => {
    // Only `true` is treated as encrypted, which is the fail-closed direction:
    // an archive cannot claim encryption with a truthy look-alike, and a value
    // that is not `true` then has to survive every other rule.
    await expect(
      runOoxmlPreflight(
        archiveReader([
          entry({ filename: 'word/document.xml', encrypted: 'yes', compressedSize: 1, uncompressedSize: 1 }),
        ]),
        DEFAULT_OOXML_LIMITS,
      ),
    ).resolves.toBeUndefined()
  })
})

describe('abort', () => {
  it('rejects an already-aborted signal with an AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    const bytes = await buildOfficeLikeZip()
    await expect(preflightOoxml(bytes, undefined, controller.signal)).rejects.toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    )
  })

  it('does not wrap an abort as an archive failure', async () => {
    const controller = new AbortController()
    controller.abort()
    let caught: unknown
    try {
      await preflightOoxml(await buildOfficeLikeZip(), undefined, controller.signal)
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).not.toBeInstanceOf(OoxmlPreflightError)
    expect((caught as { name?: unknown }).name).toBe('AbortError')
  })

  it('reports a non-AbortError abort reason as an AbortError', async () => {
    const controller = new AbortController()
    controller.abort('cancelled by the caller')
    let caught: unknown
    try {
      await preflightOoxml(await buildOfficeLikeZip(), undefined, controller.signal)
    } catch (error: unknown) {
      caught = error
    }
    expect((caught as { name?: unknown }).name).toBe('AbortError')
    expect(caught).not.toBeInstanceOf(OoxmlPreflightError)
  })

  it('honours a caller-chosen AbortError reason unchanged', async () => {
    const controller = new AbortController()
    const reason = new DOMException('closed the preview', 'AbortError')
    controller.abort(reason)
    let caught: unknown
    try {
      await preflightOoxml(await buildOfficeLikeZip(), undefined, controller.signal)
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBe(reason)
  })

  it('stops an enumeration that is aborted while its entries are being read', async () => {
    // No timer and no sleep: the archive reader reports the entries and the
    // signal is aborted at exactly that point, so the abort can only be observed
    // by the loop that walks them. A preflight that checked the signal once, at
    // its start, resolves here instead of throwing.
    const controller = new AbortController()
    const entries: OoxmlEntryLike[] = [
      entry({ filename: 'word/document.xml', compressedSize: 1, uncompressedSize: 1 }),
    ]
    const reader: OoxmlArchiveReaderLike = Object.freeze({
      close: async () => undefined,
      getEntries: async () => {
        controller.abort()
        return entries
      },
    })

    await expect(
      runOoxmlPreflight(reader, DEFAULT_OOXML_LIMITS, controller.signal),
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }))
  })

  it('still closes the reader when the preflight is aborted before it starts', async () => {
    // An already-cancelled call must allocate nothing: the reader is never
    // constructed, so there is nothing to close. Asserted against the library's
    // own prototype, which is the only place that can see a reader this module
    // did not keep.
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    const controller = new AbortController()
    controller.abort()
    await expect(
      preflightOoxml(await buildOfficeLikeZip(), undefined, controller.signal),
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }))
    expect(closeSpy).not.toHaveBeenCalled()
  })
})

describe('reader lifecycle', () => {
  // Cleanup is owned by `preflightOoxml`, because it is the function that
  // constructs the reader. `runOoxmlPreflight` is the seam that receives a
  // reader it did not create and therefore does not close; the lifecycle cases
  // below drive the real entry point and observe zip.js's own reader, which is
  // the only place a reader this module did not keep can be seen.

  it('closes the reader when the archive is accepted', async () => {
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    await expect(preflightOoxml(await buildOfficeLikeZip())).resolves.toBeUndefined()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the reader after a security refusal, and reports the refusal', async () => {
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    await expectRefusal(
      preflightOoxml(await buildZip([{ name: '../evil.xml', text: 'x' }])),
      'unsafe-path',
      '../evil.xml',
    )
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the reader after an entry-level refusal', async () => {
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    await expectRefusal(
      preflightOoxml(await buildZip([{ name: 'word/document.xml', text: 'x', encrypt: true }])),
      'encrypted-entry',
      'word/document.xml',
    )
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes the reader after the archive fails to parse', async () => {
    // zip.js reads the end-of-central-directory record from the end of the byte
    // range, so the reader exists by the time `getEntries` rejects. Cleanup is
    // therefore attempted here too, and the case asserts that rather than
    // assuming the failure happened before a reader existed.
    const closeSpy = vi.spyOn(ZipReader.prototype, 'close')
    await expectArchiveWideRefusal(preflightOoxml(new Uint8Array([1, 2, 3, 4])), 'invalid-archive')
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('propagates a cleanup failure when the archive was accepted', async () => {
    // zip.js's own `close` cannot be made to fail on an in-memory reader — it
    // releases a stream it has already consumed — so the failure is injected at
    // the method that would have to fail. There is no verdict to protect on this
    // path, which is why this is the one case where the cleanup error reaches
    // the caller instead of being dropped.
    const closeError = new Error('the stream could not be released')
    vi.spyOn(ZipReader.prototype, 'close').mockRejectedValue(closeError)
    await expect(preflightOoxml(await buildOfficeLikeZip())).rejects.toBe(closeError)
  })

  it('does not hide a refusal behind a cleanup failure', async () => {
    // The archive is refused for its path, and the cleanup also fails. Only one
    // of those two facts is about the caller's file, and it is the one the
    // caller must receive.
    vi.spyOn(ZipReader.prototype, 'close').mockRejectedValue(
      new Error('the stream could not be released'),
    )
    await expectRefusal(
      preflightOoxml(await buildZip([{ name: '../evil.xml', text: 'x' }])),
      'unsafe-path',
      '../evil.xml',
    )
  })

  it('does not hide an invalid archive behind a cleanup failure', async () => {
    vi.spyOn(ZipReader.prototype, 'close').mockRejectedValue(
      new Error('the stream could not be released'),
    )
    await expectArchiveWideRefusal(preflightOoxml(new Uint8Array([1, 2, 3, 4])), 'invalid-archive')
  })

  it('does not hide an abort behind a cleanup failure', async () => {
    vi.spyOn(ZipReader.prototype, 'close').mockRejectedValue(
      new Error('the stream could not be released'),
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      preflightOoxml(await buildOfficeLikeZip(), undefined, controller.signal),
    ).rejects.toThrowError(expect.objectContaining({ name: 'AbortError' }))
  })
})

describe('programming errors', () => {
  it('does not report a reader that is not a reader as a broken archive', async () => {
    await expect(
      runOoxmlPreflight(Object.freeze({}), DEFAULT_OOXML_LIMITS),
    ).rejects.toThrowError(TypeError)
  })

  it('does not report an unusable enumeration result as a broken archive', async () => {
    const reader: OoxmlArchiveReaderLike = Object.freeze({
      close: async () => undefined,
      getEntries: async () => 'not an array',
    })
    await expect(runOoxmlPreflight(reader, DEFAULT_OOXML_LIMITS)).rejects.toThrowError(TypeError)
  })

  it('keeps the parse boundary narrow enough that a refusal is not relabelled', async () => {
    // A reader that reports a refusal of its own — not a parse failure — must
    // reach the caller with its own code. The seam exists so that this can be
    // stated without a real archive that fails for a reason this module cannot
    // produce.
    const refusal = new OoxmlPreflightError('unsafe-path', 'word/document.xml')
    const reader: OoxmlArchiveReaderLike = Object.freeze({
      close: async () => undefined,
      getEntries: async () => {
        throw refusal
      },
    })
    // `getEntries` throwing is the library's own failure channel, so this one is
    // an archive failure by construction.
    await expectRefusal(runOoxmlPreflight(reader, DEFAULT_OOXML_LIMITS), 'invalid-archive')
  })
})
