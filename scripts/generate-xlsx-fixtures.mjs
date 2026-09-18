/**
 * Generator for XLSX test fixtures using exceljs and fflate.
 *
 * Produces:
 * - simple.xlsx: 3x3 table with headers
 * - formula-values.xlsx: formulas (SUM), currency, percentage, date
 * - multi-sheet.xlsx: Summary, Data 2026, 中文表
 * - merged-frozen.xlsx: merged headers and frozen panes
 * - chart-image.xlsx: embedded PNG image and OOXML chart part
 * - large.xlsx: 2000 rows x 15 columns for worker parsing / virtualization
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ExcelJS from 'exceljs'

const req = createRequire(import.meta.url)
const fflate = req(req.resolve('fflate', { paths: [req.resolve('@extend-ai/react-xlsx')] }))
const { unzipSync, zipSync, strToU8, strFromU8 } = fflate

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'tests', 'fixtures', 'xlsx')
mkdirSync(OUT_DIR, { recursive: true })

// 64x64 valid red PNG data buffer
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA' +
  'B3RJTUUH5gkOEAca74pGSwAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUH' +
  'AAAAWUlEQVR42u3PMQEAAAgEIDu/qVvBy8GBNJA1e20BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB' +
  'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAeEA24gAAbw2kZ8AAAAASUVORK5CYII='
const SAMPLE_PNG_BUFFER = Buffer.from(SAMPLE_PNG_BASE64, 'base64')

export async function generateSimple() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')

  ws.getCell('A1').value = 'Name'
  ws.getCell('B1').value = 'Qty'
  ws.getCell('C1').value = 'Price'

  ws.getCell('A2').value = 'Apple'
  ws.getCell('B2').value = 2
  ws.getCell('C2').value = 3.50
  ws.getCell('C2').numFmt = '0.00'

  ws.getCell('A3').value = 'Pear'
  ws.getCell('B3').value = 4
  ws.getCell('C3').value = 2.25
  ws.getCell('C3').numFmt = '0.00'

  ws.getCell('A4').value = '中文'
  ws.getCell('B4').value = 6
  ws.getCell('C4').value = 1.00
  ws.getCell('C4').numFmt = '0.00'

  const buffer = await wb.xlsx.writeBuffer()
  const path = join(OUT_DIR, 'simple.xlsx')
  writeFileSync(path, Buffer.from(buffer))
  console.log('Generated simple.xlsx (%d bytes)', buffer.byteLength)
}

export async function generateFormulaValues() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')

  ws.getCell('A1').value = 10
  ws.getCell('A2').value = 20
  ws.getCell('A3').value = {
    formula: 'SUM(A1:A2)',
    result: 30,
  }

  // Formatted currency: $1,234.50
  ws.getCell('B1').value = 1234.5
  ws.getCell('B1').numFmt = '$#,##0.00'

  // Formatted percentage: 12.5%
  ws.getCell('B2').value = 0.125
  ws.getCell('B2').numFmt = '0.0%'

  // Formatted date: 2026-09-18
  ws.getCell('B3').value = new Date('2026-09-18T00:00:00.000Z')
  ws.getCell('B3').numFmt = 'yyyy-mm-dd'

  const buffer = await wb.xlsx.writeBuffer()
  const path = join(OUT_DIR, 'formula-values.xlsx')
  writeFileSync(path, Buffer.from(buffer))
  console.log('Generated formula-values.xlsx (%d bytes)', buffer.byteLength)
}

export async function generateMultiSheet() {
  const wb = new ExcelJS.Workbook()

  const s1 = wb.addWorksheet('Summary')
  s1.getCell('A1').value = 'Summary Marker'
  s1.getCell('B2').value = 'Revenue'
  s1.getCell('C2').value = 50000

  const s2 = wb.addWorksheet('Data 2026')
  s2.getCell('A1').value = 'Data 2026 Marker'
  s2.getCell('B2').value = 'Project X'
  s2.getCell('C2').value = 120
  s2.getCell('B3').value = 'Project Y'
  s2.getCell('C3').value = 240

  const s3 = wb.addWorksheet('中文表')
  s3.getCell('A1').value = '中文表 Marker'
  s3.getCell('B2').value = '指标A'
  s3.getCell('C2').value = '通过'

  const buffer = await wb.xlsx.writeBuffer()
  const path = join(OUT_DIR, 'multi-sheet.xlsx')
  writeFileSync(path, Buffer.from(buffer))
  console.log('Generated multi-sheet.xlsx (%d bytes)', buffer.byteLength)
}

export async function generateMergedFrozen() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
  })

  // Merge A1:C1
  ws.mergeCells('A1:C1')
  ws.getCell('A1').value = 'Merged Header Banner'

  ws.getCell('A2').value = 'FixedCol'
  ws.getCell('B2').value = 'Metric 1'
  ws.getCell('C2').value = 'Metric 2'

  for (let r = 3; r <= 15; r += 1) {
    ws.getCell(`A${r}`).value = `Row ${r}`
    ws.getCell(`B${r}`).value = r * 10
    ws.getCell(`C${r}`).value = r * 20
  }

  const buffer = await wb.xlsx.writeBuffer()
  const path = join(OUT_DIR, 'merged-frozen.xlsx')
  writeFileSync(path, Buffer.from(buffer))
  console.log('Generated merged-frozen.xlsx (%d bytes)', buffer.byteLength)
}

export async function generateChartImage() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')

  ws.getCell('A1').value = 'Category'
  ws.getCell('B1').value = 'Score'
  ws.getCell('A2').value = 'Alpha'
  ws.getCell('B2').value = 85
  ws.getCell('A3').value = 'Beta'
  ws.getCell('B3').value = 92
  ws.getCell('A4').value = 'Gamma'
  ws.getCell('B4').value = 78

  // Embed PNG image
  const imageId = wb.addImage({
    buffer: SAMPLE_PNG_BUFFER,
    extension: 'png',
  })
  ws.addImage(imageId, {
    tl: { col: 3, row: 1 },
    ext: { width: 64, height: 64 },
  })

  const rawBuffer = await wb.xlsx.writeBuffer()

  // Add minimal OOXML chart part using fflate
  const unzipped = unzipSync(new Uint8Array(rawBuffer))

  const chartXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:v>Performance Chart</c:v></c:tx></c:title>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>Score</c:v></c:tx>
          <c:val>
            <c:numRef>
              <c:f>Sheet1!$B$2:$B$4</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`

  unzipped['xl/charts/chart1.xml'] = strToU8(chartXml)

  // Update [Content_Types].xml
  if (unzipped['[Content_Types].xml']) {
    let ct = strFromU8(unzipped['[Content_Types].xml'])
    if (!ct.includes('application/vnd.openxmlformats-officedocument.drawingml.chart+xml')) {
      ct = ct.replace(
        '</Types>',
        '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
      )
      unzipped['[Content_Types].xml'] = strToU8(ct)
    }
  }

  // Update drawing rels
  const drawingRelsPath = 'xl/drawings/_rels/drawing1.xml.rels'
  let drawingRelsXml = unzipped[drawingRelsPath] ? strFromU8(unzipped[drawingRelsPath]) : ''
  if (!drawingRelsXml) {
    drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`
  } else {
    drawingRelsXml = drawingRelsXml.replace(
      '</Relationships>',
      '<Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
    )
  }
  unzipped[drawingRelsPath] = strToU8(drawingRelsXml)

  // Update drawing1.xml to add graphicFrame for chart
  const drawingPath = 'xl/drawings/drawing1.xml'
  if (unzipped[drawingPath]) {
    let drawingXml = strFromU8(unzipped[drawingPath])
    const chartAnchor = `<xdr:twoCellAnchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:rowOff></xdr:to>
  <xdr:graphicFrame macro="">
    <xdr:nvGraphicFramePr>
      <xdr:cNvPr id="2" name="Chart 1"/>
      <xdr:cNvGraphicFramePr/>
    </xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart r:id="rIdChart1"/>
      </a:graphicData>
    </a:graphic>
  </xdr:graphicFrame>
  <xdr:clientData/>
</xdr:twoCellAnchor>`
    drawingXml = drawingXml.replace('</xdr:wsDr>', `${chartAnchor}</xdr:wsDr>`)
    unzipped[drawingPath] = strToU8(drawingXml)
  }

  const finalZip = zipSync(unzipped)
  const path = join(OUT_DIR, 'chart-image.xlsx')
  writeFileSync(path, Buffer.from(finalZip))
  console.log('Generated chart-image.xlsx (%d bytes)', finalZip.byteLength)
}

export async function generateLarge() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')

  const ROWS = 2000
  const COLS = 15

  // Header
  for (let c = 1; c <= COLS; c += 1) {
    ws.getRow(1).getCell(c).value = `Col_${c}`
  }

  // Populate rows
  for (let r = 2; r <= ROWS; r += 1) {
    const row = ws.getRow(r)
    for (let c = 1; c <= COLS; c += 1) {
      row.getCell(c).value = `R${r}C${c}`
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const path = join(OUT_DIR, 'large.xlsx')
  writeFileSync(path, Buffer.from(buffer))
  console.log('Generated large.xlsx (%d bytes, %d rows x %d cols)', buffer.byteLength, ROWS, COLS)
}

async function main() {
  await generateSimple()
  await generateFormulaValues()
  await generateMultiSheet()
  await generateMergedFrozen()
  await generateChartImage()
  await generateLarge()
  console.log('All XLSX fixtures generated successfully.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
