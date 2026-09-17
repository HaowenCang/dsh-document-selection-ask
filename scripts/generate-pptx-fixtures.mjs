import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pptxgen from 'pptxgenjs'
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js'

const OUT_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures', 'pptx')
mkdirSync(OUT_DIR, { recursive: true })

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEUlEQVR42mP8z8AARBgGxgcAZw4BAVqOsnkAAAAASUVORK5CYII='
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`

async function generateTextTwoSlides() {
  const pres = new pptxgen()

  // Slide 1
  const slide1 = pres.addSlide()
  slide1.addText('PPTX Slide One Alpha', {
    x: 0.8,
    y: 0.8,
    w: 8.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
  })
  slide1.addText('PPTX 中文选段一', {
    x: 0.8,
    y: 2.0,
    w: 8.0,
    h: 1.2,
    fontSize: 18,
    italic: true,
  })

  // Slide 2
  const slide2 = pres.addSlide()
  slide2.addText('PPTX Slide Two Beta', {
    x: 0.8,
    y: 0.8,
    w: 8.0,
    h: 0.8,
    fontSize: 24,
    bold: true,
  })
  slide2.addText('PPTX 中文选段二', {
    x: 0.8,
    y: 2.0,
    w: 8.0,
    h: 1.2,
    fontSize: 18,
    italic: true,
  })

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'text-two-slides.pptx'), buffer)
  console.log('Generated text-two-slides.pptx (%d bytes)', buffer.length)
}

async function generateTableImage() {
  const pres = new pptxgen()
  const slide = pres.addSlide()

  // 2x2 table
  const tableRows = [
    [
      { text: 'Header Col 1', options: { bold: true } },
      { text: 'Header Col 2', options: { bold: true } },
    ],
    [
      { text: 'Cell Row 1 Col 1' },
      { text: 'Cell Row 1 Col 2' },
    ],
  ]
  slide.addTable(tableRows, { x: 0.8, y: 0.8, w: 5.0, h: 1.5 })

  // Embedded image
  slide.addImage({
    data: TINY_PNG_DATA_URI,
    x: 0.8,
    y: 2.8,
    w: 2.0,
    h: 1.5,
  })

  // Caption text
  slide.addText('Embedded Image Caption', {
    x: 0.8,
    y: 4.5,
    w: 5.0,
    h: 0.5,
    fontSize: 14,
  })

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'table-image.pptx'), buffer)
  console.log('Generated table-image.pptx (%d bytes)', buffer.length)
}

async function generateChart() {
  const pres = new pptxgen()
  const slide = pres.addSlide()

  slide.addText('Quarterly Revenue Chart', {
    x: 0.8,
    y: 0.5,
    w: 8.0,
    h: 0.6,
    fontSize: 20,
    bold: true,
  })

  slide.addText('Selectable Chart Overview Text', {
    x: 0.8,
    y: 1.2,
    w: 8.0,
    h: 0.5,
    fontSize: 14,
  })

  const chartData = [
    {
      name: 'Revenue 2026',
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      values: [120, 180, 240, 310],
    },
  ]
  slide.addChart(pres.ChartType.bar, chartData, {
    x: 0.8,
    y: 2.0,
    w: 7.5,
    h: 4.0,
  })

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'chart.pptx'), buffer)
  console.log('Generated chart.pptx (%d bytes)', buffer.length)
}

async function generateLarge120Slides() {
  const pres = new pptxgen()

  for (let i = 1; i <= 120; i += 1) {
    const slide = pres.addSlide()
    slide.addText(`Slide ${i}`, {
      x: 1.0,
      y: 1.0,
      w: 6.0,
      h: 1.0,
      fontSize: 24,
    })
    slide.addText(`Content for slide ${i} with lightweight selectable text.`, {
      x: 1.0,
      y: 2.2,
      w: 8.0,
      h: 1.0,
      fontSize: 14,
    })
  }

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'large-120-slides.pptx'), buffer)
  console.log('Generated large-120-slides.pptx (%d bytes)', buffer.length)
}

async function generateExternalLinks() {
  const pres = new pptxgen()
  const slide = pres.addSlide()

  slide.addText('PPTX External Link Security Test', {
    x: 0.8,
    y: 0.8,
    w: 8.0,
    h: 0.6,
    fontSize: 20,
    bold: true,
  })

  slide.addText('Safe HTTPS', {
    x: 0.8,
    y: 1.8,
    w: 3.0,
    h: 0.6,
    fontSize: 16,
    hyperlink: { url: 'https://example.com/' },
  })

  slide.addText('Danger JS', {
    x: 0.8,
    y: 2.8,
    w: 3.0,
    h: 0.6,
    fontSize: 16,
    hyperlink: { url: 'javascript:window.__dsaPptxXss=(window.__dsaPptxXss||0)+1' },
  })

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'external-links.pptx'), buffer)
  console.log('Generated external-links.pptx (%d bytes)', buffer.length)
}

async function generateExternalMedia() {
  // Create base PPTX
  const pres = new pptxgen()
  const slide = pres.addSlide()
  slide.addText('External Media Probe Slide', {
    x: 0.8,
    y: 0.8,
    w: 8.0,
    h: 0.6,
    fontSize: 20,
  })

  const rawBytes = await pres.write({ outputType: 'uint8array' })

  // Post-process OOXML archive to inject an External image relationship
  const zipReader = new ZipReader(new Uint8ArrayReader(rawBytes))
  const zipWriter = new ZipWriter(new Uint8ArrayWriter())
  const entries = await zipReader.getEntries()

  for (const entry of entries) {
    if (entry.directory) continue
    let content = await entry.getData(new TextWriter())
    if (entry.filename === 'ppt/slides/_rels/slide1.xml.rels') {
      content = content.replace(
        '</Relationships>',
        '<Relationship Id="rIdProbe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/dsa-pptx-probe.png" TargetMode="External"/></Relationships>',
      )
    }
    await zipWriter.add(entry.filename, new TextReader(content))
  }

  await zipReader.close()
  const outBytes = await zipWriter.close()

  writeFileSync(join(OUT_DIR, 'external-media.pptx'), Buffer.from(outBytes))
  console.log('Generated external-media.pptx (%d bytes)', outBytes.length)
}

async function generateImageOnly() {
  const pres = new pptxgen()
  const slide = pres.addSlide()

  // Only image, no text
  slide.addImage({
    data: TINY_PNG_DATA_URI,
    x: 1.0,
    y: 1.0,
    w: 4.0,
    h: 3.0,
  })

  const buffer = await pres.write({ outputType: 'nodebuffer' })
  writeFileSync(join(OUT_DIR, 'image-only.pptx'), buffer)
  console.log('Generated image-only.pptx (%d bytes)', buffer.length)
}

async function main() {
  await generateTextTwoSlides()
  await generateTableImage()
  await generateChart()
  await generateLarge120Slides()
  await generateExternalLinks()
  await generateExternalMedia()
  await generateImageOnly()
}

main().catch((err) => {
  console.error('Fixture generation failed:', err)
  process.exit(1)
})
