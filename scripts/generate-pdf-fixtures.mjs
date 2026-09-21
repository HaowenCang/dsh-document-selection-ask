#!/usr/bin/env node
/**
 * Deterministic PDF fixtures for the browser suite.
 *
 * Four files are written into `tests/fixtures/pdf/` and committed, because the
 * browser smoke needs a real PDF in the DSH session workspace and a test run must
 * never reach the network for one:
 *
 * ```text
 * single-page.pdf      one page, "Alpha Beta Gamma" and a Latin-only paragraph
 * two-page.pdf         six pages whose first-line text names the page
 * cjk.pdf              one page of Chinese text, with the font embedded
 * image-only.pdf       one page of drawn shapes and no text operator at all
 * alignment-probe.pdf  one page, four isolated lines and nothing else
 * ```
 *
 * `alignment-probe.pdf` is Task 16's fixture. The high-DPI defect it guards was a
 * text layer that did not sit on the glyphs it selected, and detecting that needs a
 * page whose raster contains **only** text: the other four fixtures all draw more
 * than one line or draw shapes, so a scan of their canvas cannot separate "the
 * selection is on the glyphs" from "the selection is on some other ink". Its lines
 * are large, left-aligned, widely separated and Latin-only so the raster ink of
 * each one is a single unambiguous band.
 *
 * **Determinism.** The generator uses `pdf-lib`, which writes no timestamp into a
 * PDF unless asked, and the document metadata is pinned to a fixed date. Two runs
 * on the same inputs therefore produce byte-identical files, which is what makes
 * a committed fixture reviewable.
 *
 * **The CJK font is not committed.** `cjk.pdf` needs a font with CJK coverage
 * embedded in it, and every usable one is megabytes; committing the font would
 * put a binary blob in the repository for four glyphs, and committing *only* the
 * PDF would leave regeneration dependent on whatever font the regenerating machine
 * happens to have. The generator therefore resolves a font from a documented list
 * of local, freely licensed, embedding-permitted candidates, verifies the license
 * and the embedding permission **from the font's own `name` and `OS/2` tables**,
 * subsets it, and embeds the subset in the PDF. That subset — not the font — is
 * what the repository carries, and `tests/fixtures/pdf/README.md` records the
 * provenance it was generated from.
 *
 * A font whose `OS/2.fsType` forbids embedding, or whose license string is not a
 * recognised free license, is refused rather than embedded: the check is the
 * whole reason this script owns the decision.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/generate-pdf-fixtures.mjs                    # write the committed set
 * node scripts/generate-pdf-fixtures.mjs --out smoke-fixtures/pdf
 * node scripts/generate-pdf-fixtures.mjs --font <path>      # override the CJK font
 * ```
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, degrees, rgb } from 'pdf-lib'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The fixed document date, so two runs produce identical bytes. */
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z')

/**
 * Local candidates for the CJK font, in preference order.
 *
 * Each is a freely licensed font that permits embedding. The order is not a
 * statement about quality; it is the order in which a machine is likely to have
 * one, and the generator verifies whichever it finds before using it.
 */
const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/Noto Sans SC (TrueType).otf',
  'C:/Windows/Fonts/NotoSansSC-VF.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/System/Library/Fonts/PingFang.ttc',
]

/**
 * `OS/2.fsType` flags that forbid or restrict embedding.
 *
 * The whole point of reading them is that the permission travels with the font:
 * a font that says it may not be embedded must not be, whatever its name
 * suggests. fontkit exposes the field as decoded booleans.
 */
const FSTYPE_FORBIDS_EMBEDDING = ['noEmbedding', 'viewOnly']
const FSTYPE_RESTRICTS_SUBSETTING = ['noSubsetting']

/** License strings accepted as free, matched case-insensitively against the font's own description. */
const ACCEPTED_LICENSE_PATTERNS = [
  /SIL OPEN FONT LICENSE/i,
  /OPEN FONT LICENSE/i,
  /APACHE LICENSE/i,
  /UBUNTU FONT LICENCE/i,
  /GNU GENERAL PUBLIC LICENSE/i,
  /MIT LICENSE/i,
  /CC0/i,
]

/**
 * Print a diagnostic and exit.
 * @param message - the message.
 * @param code - the exit status.
 */
function fail(message, code = 1) {
  console.error(`generate-pdf-fixtures: ${message}`)
  process.exit(code)
}

/**
 * Parse the command line.
 * @param argv - `process.argv.slice(2)`.
 * @returns the output directory and the font override, if any.
 */
function parseArgs(argv) {
  let out = resolve(REPO_ROOT, 'tests', 'fixtures', 'pdf')
  let font
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      out = resolve(REPO_ROOT, argv[index + 1] ?? '')
      index += 1
    } else if (argv[index] === '--font') {
      font = argv[index + 1]
      index += 1
    }
  }
  return { out, font }
}

/**
 * Read a font's provenance and embedding permission from the font itself.
 *
 * @param path - the font file.
 * @returns the family name, the license description and the `fsType` flags.
 * @throws Error when the font cannot be parsed or declares no license.
 */
function inspectFont(path) {
  const font = fontkit.create(readFileSync(path))
  const records = font.name.records ?? {}

  // fontkit decodes each name record to `{ <language>: <string> }`; the English
  // entry is the one every candidate here carries, and the fallback keeps a
  // font whose only record is another language usable rather than unexplained.
  const pick = (key) => {
    const record = records[key]
    if (record === undefined) return undefined
    const value = record['en'] ?? Object.values(record).find((entry) => typeof entry === 'string')
    return typeof value === 'string' ? value : undefined
  }

  const license = pick('license') ?? pick('licenseDescription') ?? pick('copyright')
  if (license === undefined) {
    throw new Error(`${path} declares no license in its name table; refusing to embed it`)
  }

  const fsType = font['OS/2']?.fsType ?? {}

  return {
    family: pick('preferredFamily') ?? pick('fontFamily') ?? '(unnamed)',
    license,
    licenseUrl: pick('licenseURL'),
    fsType,
  }
}

/**
 * Confirm a font may be embedded and is freely licensed.
 *
 * @param path - the font file.
 * @returns what the font says about itself.
 * @throws Error when embedding is forbidden or the license is unrecognised.
 */
function requireEmbeddableFont(path) {
  const info = inspectFont(path)

  if (FSTYPE_FORBIDS_EMBEDDING.some((flag) => info.fsType[flag] === true)) {
    throw new Error(`${path} sets OS/2.fsType ${JSON.stringify(info.fsType)}, which forbids embedding`)
  }
  if (FSTYPE_RESTRICTS_SUBSETTING.some((flag) => info.fsType[flag] === true)) {
    throw new Error(`${path} sets OS/2.fsType ${JSON.stringify(info.fsType)}, which forbids subsetting`)
  }
  if (!ACCEPTED_LICENSE_PATTERNS.some((pattern) => pattern.test(info.license))) {
    throw new Error(`${path} declares an unrecognised license: ${info.license.slice(0, 120)}`)
  }

  return info
}

/**
 * Find a CJK font to embed.
 * @param override - an explicit path, if one was given.
 * @returns the path and what the font says about itself.
 */
function locateCjkFont(override) {
  const candidates = override === undefined ? CJK_FONT_CANDIDATES : [override]
  const problems = []

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      problems.push(`${candidate} is absent`)
      continue
    }
    try {
      return { path: candidate, info: requireEmbeddableFont(candidate) }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }

  fail(
    'no embeddable CJK font was found; pass --font <path> to name one.\n  ' + problems.join('\n  '),
  )
}

/**
 * Create an empty document with deterministic metadata.
 * @param title - the document title.
 * @returns the document.
 */
async function createDocument(title) {
  const document = await PDFDocument.create()
  document.setTitle(title)
  document.setProducer('dsh-document-selection-ask fixture generator')
  document.setCreator('dsh-document-selection-ask fixture generator')
  document.setCreationDate(FIXED_DATE)
  document.setModificationDate(FIXED_DATE)
  return document
}

/**
 * Assert that a generated file contains no instruction to fetch anything.
 *
 * The project forbids remote parser assets, and a fixture that referenced a
 * remote font or image would make the browser smoke depend on the network
 * without the plugin doing anything wrong.
 *
 * @param name - the file's name, for the message.
 * @param bytes - the generated bytes.
 * @throws Error when the file names a remote resource.
 */
function requireSelfContained(name, bytes) {
  const text = Buffer.from(bytes).toString('latin1')
  for (const marker of ['/URI', 'http://', 'https://']) {
    if (text.includes(marker)) {
      throw new Error(`${name} contains "${marker}"; fixtures must be self-contained`)
    }
  }
}

/**
 * Write one fixture.
 * @param outDir - the output directory.
 * @param name - the file name.
 * @param bytes - the file's bytes.
 * @returns the file name and its size.
 */
function writeFixture(outDir, name, bytes) {
  requireSelfContained(name, bytes)
  const path = resolve(outDir, name)
  writeFileSync(path, bytes)
  return { name, size: bytes.length }
}

/**
 * Build `single-page.pdf`: one page, two lines of Latin text.
 * @param outDir - the output directory.
 * @returns the written file's record.
 */
async function buildSinglePage(outDir) {
  const document = await createDocument('dsa fixture: single page')
  const page = document.addPage([595.28, 841.89]) // A4, in PDF points
  const font = await document.embedFont('Helvetica')

  page.drawText('Alpha Beta Gamma', { x: 72, y: 760, size: 24, font, color: rgb(0, 0, 0) })
  page.drawText('The quick brown fox jumps over the lazy dog.', {
    x: 72,
    y: 720,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  })

  return writeFixture(outDir, 'single-page.pdf', await document.save({ useObjectStreams: false }))
}

/**
 * Build `two-page.pdf`: six pages, each naming itself in its first line.
 *
 * The file is named for the case it serves — a document with more than one page —
 * and it carries six of them for a measured reason. A page is rendered when an
 * `IntersectionObserver` with a `1200px 0px` root margin reports it within range
 * of the viewport — a viewport-rooted observer rather than scroll-container-rooted.
 * Six A2 pages put pages 5 and 6 beyond that reach, which is what the case needs to observe.
 *
 * @param outDir - the output directory.
 * @returns the written file's record.
 */
async function buildTwoPage(outDir) {
  const document = await createDocument('dsa fixture: six pages')
  const font = await document.embedFont('Helvetica')

  const pages = [
    ['Alpha page one', 'The first page names itself so a smoke can prove which page it read.'],
    ['Beta page two', 'The second page names itself.'],
    ['Gamma page three', 'The third page names itself.'],
    ['Delta page four', 'The fourth page names itself.'],
    ['Epsilon page five', 'The fifth page is the first one that stays unrendered until it is scrolled to.'],
    ['Zeta page six', 'The sixth page is the one a scroll has to reach.'],
  ]

  for (const [index, text] of pages.entries()) {
    const page = document.addPage([1190.55, 1683.78]) // A2, in PDF points
    page.drawText(text[0], { x: 96, y: 1520, size: 36, font, color: rgb(0, 0, 0) })
    page.drawText(text[1], { x: 96, y: 1450, size: 16, font, color: rgb(0, 0, 0) })
    page.drawText(`page ${String(index + 1)} of 6`, {
      x: 96,
      y: 1400,
      size: 14,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
  }

  return writeFixture(outDir, 'two-page.pdf', await document.save({ useObjectStreams: false }))
}

/**
 * Build `cjk.pdf`: Chinese text with the font subset embedded.
 *
 * @param outDir - the output directory.
 * @param font - the located CJK font.
 * @returns the written file's record.
 */
async function buildCjk(outDir, font) {
  const document = await createDocument('dsa fixture: cjk')
  document.registerFontkit(fontkit)
  const embedded = await document.embedFont(readFileSync(font.path), { subset: true, customName: 'DSACJK' })
  const page = document.addPage([595.28, 841.89])

  page.drawText('中文选段测试', { x: 72, y: 760, size: 24, font: embedded, color: rgb(0, 0, 0) })
  page.drawText('第二行：可以在预览中选择这段文字。', {
    x: 72,
    y: 720,
    size: 14,
    font: embedded,
    color: rgb(0, 0, 0),
  })

  return writeFixture(outDir, 'cjk.pdf', await document.save({ useObjectStreams: false }))
}

/**
 * Build `image-only.pdf`: drawn shapes and no text operator at all.
 *
 * The content stream contains no `Tj`/`TJ`, so a text layer built over it is
 * empty by construction — which is the property the smoke asserts, and the
 * reason this fixture cannot be produced by drawing text and hoping it is
 * invisible.
 *
 * @param outDir - the output directory.
 * @returns the written file's record.
 */
async function buildImageOnly(outDir) {
  const document = await createDocument('dsa fixture: image only')
  const page = document.addPage([595.28, 841.89])

  page.drawRectangle({ x: 72, y: 560, width: 451, height: 220, color: rgb(0.16, 0.35, 0.62) })
  page.drawCircle({ x: 200, y: 400, size: 90, color: rgb(0.85, 0.55, 0.2) })
  page.drawRectangle({
    x: 320,
    y: 310,
    width: 180,
    height: 180,
    color: rgb(0.2, 0.6, 0.4),
    rotate: degrees(12),
  })

  return writeFixture(outDir, 'image-only.pdf', await document.save({ useObjectStreams: false }))
}

/**
 * Build `alignment-probe.pdf`: four isolated lines of black text on white, and
 * nothing else on the page.
 *
 * The page is what a glyph-level alignment check needs. A browser suite can read
 * the canvas raster with `getImageData()`, and on this page every dark pixel in it
 * belongs to a glyph of one of these four lines — so the ink's own bounding box is
 * a statement about where the glyphs are, and it can be compared with the
 * rectangle the text layer reports for the same words. Any other fixture would
 * confound that comparison with ink from shapes or a second column.
 *
 * The lines are ordered by size and separated by more than twice the largest line
 * height, so a scan for ink in one band cannot reach the next line, and each line
 * is short enough that its own ink is a single horizontal run. Latin-only keeps the
 * expected advance widths a property of the embedded standard font rather than of
 * a subset, which is what makes a tolerance in pixels meaningful.
 *
 * @param outDir - the output directory.
 * @returns the written file's record.
 */
async function buildAlignmentProbe(outDir) {
  const document = await createDocument('dsa fixture: alignment probe')
  const page = document.addPage([595.28, 841.89]) // A4, in PDF points
  const font = await document.embedFont('Helvetica')

  page.drawText('ALIGNMENT PROBE 12345', { x: 72, y: 720, size: 40, font, color: rgb(0, 0, 0) })
  page.drawText('alignment probe 67890', { x: 72, y: 650, size: 24, font, color: rgb(0, 0, 0) })
  page.drawText('glyph alignment 24680', { x: 72, y: 600, size: 16, font, color: rgb(0, 0, 0) })
  page.drawText('text layer 13579', { x: 72, y: 560, size: 12, font, color: rgb(0, 0, 0) })

  return writeFixture(outDir, 'alignment-probe.pdf', await document.save({ useObjectStreams: false }))
}

const { out, font } = parseArgs(process.argv.slice(2))
mkdirSync(out, { recursive: true })

const cjkFont = locateCjkFont(font)
console.log(
  `generate-pdf-fixtures: cjk font = ${cjkFont.path}\n` +
    `generate-pdf-fixtures:   family = ${cjkFont.info.family}\n` +
    `generate-pdf-fixtures:   license = ${cjkFont.info.license.slice(0, 80)}\n` +
    `generate-pdf-fixtures:   fsType = ${JSON.stringify(cjkFont.info.fsType)}`,
)

const written = [
  await buildSinglePage(out),
  await buildTwoPage(out),
  await buildCjk(out, cjkFont),
  await buildImageOnly(out),
  await buildAlignmentProbe(out),
]

for (const fixture of written) {
  console.log(`generate-pdf-fixtures: ${fixture.name} = ${String(fixture.size)} bytes`)
}
console.log(`generate-pdf-fixtures: wrote ${String(written.length)} fixtures into ${out}`)
