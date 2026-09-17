/**
 * PPTX relationship security policy and external resource gating.
 *
 * Inspects all relationship XML definitions before any presentation rendering
 * or slide construction occurs.
 *
 * ## Policy
 *
 * - Fail-closed policy for `TargetMode="External"`.
 * - ONLY external relationships with recognized `.../hyperlink` type are permitted,
 *   as hyperlinks require explicit user navigation gestures and do not trigger
 *   automatic network resource loading during document rendering.
 * - All other external relationship types (images, audio, video, OLE objects,
 *   external data, unknown or custom types) immediately reject document rendering.
 * - Malformed relationship XML immediately rejects document rendering.
 */

import type { PptxFiles } from '@aiden0z/pptx-renderer'

/** Standard OOXML hyperlink relationship type. */
const HYPERLINK_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

/**
 * Error thrown when an unapproved external relationship or malformed XML
 * is detected in a PPTX package.
 */
export class PptxRelationshipSecurityError extends Error {
  readonly target: string
  readonly type: string

  constructor(message: string, target = '', type = '') {
    super(message)
    this.name = 'PptxRelationshipSecurityError'
    this.target = target
    this.type = type
  }
}

/**
 * Verify whether an external relationship type represents an allowed hyperlink.
 *
 * @param type - Relationship Type attribute value.
 * @returns true if explicitly recognized as a hyperlink relationship.
 */
function isAllowedExternalRelationshipType(type: string): boolean {
  return type === HYPERLINK_RELATIONSHIP_TYPE || type.endsWith('/hyperlink')
}

/**
 * Inspect an individual relationship XML string and enforce the external resource policy.
 *
 * Uses browser DOMParser to inspect `<Relationship>` elements without regex-only parsing.
 *
 * @param xmlString - raw XML text of a .rels part.
 * @throws PptxRelationshipSecurityError when unapproved external resources or malformed XML are found.
 */
export function assertSafePptxRelationshipXml(xmlString: string): void {
  if (!xmlString || !xmlString.trim()) {
    return
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError !== null) {
    throw new PptxRelationshipSecurityError('Malformed relationship XML in PPTX package')
  }

  // Find all Relationship elements across any namespace
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

      if (!isAllowedExternalRelationshipType(type)) {
        throw new PptxRelationshipSecurityError(
          `Disallowed external relationship in PPTX: Type="${type}", Target="${target}"`,
          target,
          type,
        )
      }
    }
  }
}

/**
 * Inspect all relationship parts present in a parsed PPTX package before presentation build.
 *
 * @param files - the PptxFiles structure returned by parseZipLazyMedia.
 * @throws PptxRelationshipSecurityError when any relationship part contains disallowed external targets.
 */
export function assertSafePptxRelationships(files: PptxFiles): void {
  if (files.presentationRels) {
    assertSafePptxRelationshipXml(files.presentationRels)
  }

  if (files.slideRels) {
    for (const xml of files.slideRels.values()) {
      assertSafePptxRelationshipXml(xml)
    }
  }

  if (files.slideLayoutRels) {
    for (const xml of files.slideLayoutRels.values()) {
      assertSafePptxRelationshipXml(xml)
    }
  }

  if (files.slideMasterRels) {
    for (const xml of files.slideMasterRels.values()) {
      assertSafePptxRelationshipXml(xml)
    }
  }

  if (files.chartRels) {
    for (const xml of files.chartRels.values()) {
      assertSafePptxRelationshipXml(xml)
    }
  }
}
