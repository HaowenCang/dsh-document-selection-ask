import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js'

const OUT_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures', 'docx')
mkdirSync(OUT_DIR, { recursive: true })

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEUlEQVR42mP8z8AARBgGxgcAZw4BAVqOsnkAAAAASUVORK5CYII='
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_BASE64, 'base64')

async function generateParagraphs() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'DOCX Alpha: ', bold: true }),
              new TextRun({ text: 'Leading paragraph with bold text for native selection.' }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'DOCX Beta: ', italics: true }),
              new TextRun({ text: 'Secondary paragraph featuring italic styling.' }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'DOCX Gamma: ' }),
              new TextRun({ text: 'Third paragraph containing Unicode text: DOCX 中文选段。' }),
            ],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  writeFileSync(join(OUT_DIR, 'paragraphs.docx'), buffer)
  console.log('Generated paragraphs.docx (%d bytes)', buffer.length)
}

async function generateManualPageBreak() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'DOCX page one Alpha' }),
              new PageBreak(),
              new TextRun({ text: 'DOCX page two Beta' }),
            ],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  writeFileSync(join(OUT_DIR, 'manual-page-break.docx'), buffer)
  console.log('Generated manual-page-break.docx (%d bytes)', buffer.length)
}

async function generateTableImage() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'DOCX Table and Image Document', bold: true })],
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Table Cell 1-1')],
                    width: { size: 4000, type: WidthType.DXA },
                  }),
                  new TableCell({
                    children: [new Paragraph('Table Cell 1-2')],
                    width: { size: 4000, type: WidthType.DXA },
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Table Cell 2-1')],
                    width: { size: 4000, type: WidthType.DXA },
                  }),
                  new TableCell({
                    children: [new Paragraph('Table Cell 2-2')],
                    width: { size: 4000, type: WidthType.DXA },
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Embedded Generated Image Below:' }),
            ],
          }),
          new Paragraph({
            children: [
              new ImageRun({
                data: TINY_PNG_BYTES,
                transformation: {
                  width: 32,
                  height: 32,
                },
                type: 'png',
              }),
            ],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  writeFileSync(join(OUT_DIR, 'table-image.docx'), buffer)
  console.log('Generated table-image.docx (%d bytes)', buffer.length)
}

async function generateHeadersFooters() {
  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph('header marker - Task 9 Header')],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph('footer marker - Task 9 Footer')],
          }),
        },
        children: [
          new Paragraph({
            children: [new TextRun('body marker - Task 9 Body Content')],
          }),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  writeFileSync(join(OUT_DIR, 'headers-footers.docx'), buffer)
  console.log('Generated headers-footers.docx (%d bytes)', buffer.length)
}

async function generateAltChunk() {
  // Base document using docx, then inject an altChunk element and part via @zip.js/zip.js
  const baseDoc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun('DOCX AltChunk Security Test Body')],
          }),
        ],
      },
    ],
  })

  const baseBuffer = await Packer.toBuffer(baseDoc)
  const zipReader = new ZipReader(new Uint8ArrayReader(new Uint8Array(baseBuffer)))
  const entries = await zipReader.getEntries()

  const zipWriter = new ZipWriter(new Uint8ArrayWriter())

  for (const entry of entries) {
    if (entry.directory) continue
    let content = await entry.getData(new TextWriter())
    if (entry.filename === '[Content_Types].xml') {
      content = content.replace(
        '</Types>',
        '<Override PartName="/word/afchunk.html" ContentType="text/html"/></Types>',
      )
    } else if (entry.filename === 'word/_rels/document.xml.rels') {
      content = content.replace(
        '</Relationships>',
        '<Relationship Id="altChunkId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/></Relationships>',
      )
    } else if (entry.filename === 'word/document.xml') {
      content = content.replace(
        '</w:body>',
        '<w:altChunk r:id="altChunkId1"/></w:body>',
      )
    }
    await zipWriter.add(entry.filename, new TextReader(content))
  }

  // Add the external altchunk HTML part
  const htmlContent =
    '<html><body><script>window.__UNSAFE_ALTCHUNK_EXECUTED__ = true</script><p id="unsafe-altchunk">UNSAFE_ALTCHUNK_HTML</p></body></html>'
  await zipWriter.add('word/afchunk.html', new TextReader(htmlContent))

  await zipReader.close()
  const outBytes = await zipWriter.close()

  writeFileSync(join(OUT_DIR, 'altchunk.docx'), Buffer.from(outBytes))
  console.log('Generated altchunk.docx (%d bytes)', outBytes.length)
}

async function main() {
  await generateParagraphs()
  await generateManualPageBreak()
  await generateTableImage()
  await generateHeadersFooters()
  await generateAltChunk()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
