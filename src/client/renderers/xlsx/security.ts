/**
 * XLSX relationship security policy and external resource gating.
 *
 * Inspects all relationship XML definitions before any spreadsheet parsing
 * or rendering occurs.
 *
 * ## Policy
 * - Fail-closed policy for `TargetMode="External"`.
 * - ONLY external relationships with recognized `.../hyperlink` type are permitted.
 * - Hyperlink targets must start with `http://`, `https://`, or `mailto:`.
 *   Targets starting with `javascript:`, `data:`, `file:`, etc., are rejected.
 * - All other external relationship types (external images, external workbooks
 *   via externalLink, external OLE/data) immediately reject document rendering.
 * - Malformed relationship XML immediately rejects document rendering.
 */

import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js'

const ALLOWED_EXTERNAL_HYPERLINK_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink',
])

const SAFE_HYPERLINK_SCHEMES = /^(?:https?:|mailto:)/i

export class XlsxRelationshipSecurityError extends Error {
  readonly target: string
  readonly type: string

  constructor(message: string, target = '', type = '') {
    super(message)
    this.name = 'XlsxRelationshipSecurityError'
    this.target = target
    this.type = type
  }
}

function isAllowedExternalHyperlink(type: string, target: string): boolean {
  if (!ALLOWED_EXTERNAL_HYPERLINK_RELATIONSHIP_TYPES.has(type.trim())) {
    return false
  }
  const trimmedTarget = target.trim()
  if (!SAFE_HYPERLINK_SCHEMES.test(trimmedTarget)) {
    return false
  }
  return true
}

export function assertSafeXlsxRelationshipXml(xmlString: string): void {
  if (!xmlString || !xmlString.trim()) {
    return
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError !== null) {
    throw new XlsxRelationshipSecurityError('Malformed relationship XML in XLSX package')
  }

  let rels = doc.getElementsByTagNameNS('*', 'Relationship')
  if (rels.length === 0) {
    rels = doc.getElementsByTagName('Relationship')
  }

  for (let i = 0; i < rels.length; i += 1) {
    const rel = rels[i]!
    const targetMode = rel.getAttribute('TargetMode')

    if (targetMode !== null && targetMode.trim().toLowerCase() === 'external') {
      const type = (rel.getAttribute('Type') ?? '').trim()
      const target = (rel.getAttribute('Target') ?? '').trim()

      if (!isAllowedExternalHyperlink(type, target)) {
        throw new XlsxRelationshipSecurityError(
          `Disallowed external relationship in XLSX: Type="${type}", Target="${target}"`,
          target,
          type,
        )
      }
    }
  }
}

/**
 * Scan all .rels entries in an XLSX archive and enforce external resource policy.
 */
export async function assertSafeXlsxRelationships(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { checkSignature: true })
  try {
    const entries = await reader.getEntries()
    for (const entry of entries) {
      if (signal?.aborted) return
      if (entry.filename.endsWith('.rels') && !entry.directory && entry.getData) {
        const xml = await entry.getData(new TextWriter())
        assertSafeXlsxRelationshipXml(xml)
      }
    }
  } finally {
    await reader.close()
  }
}
