/**
 * Worksheet image presentation for the plugin's XLSX preview.
 *
 * ## Why this exists
 *
 * `@extend-ai/react-xlsx@0.16.4` supports embedded worksheet pictures through a
 * public image model and a documented replacement boundary. The model is
 * populated — `useXlsxViewer().images` carries the fixture's embedded PNG with a
 * `blob:` source, its `xl/media` path, its anchor and its z-order — and the
 * viewer's own default path decides what to do with it: with the canvas renderer
 * enabled and no `renderImage` supplied, pictures are **baked into the sheet
 * canvas** rather than published as nodes. In the tested runtime that baked path
 * left the picture unpainted: the workbook's chart reached the document as a
 * labelled SVG while the image it sits beside did not reach it at all, and no
 * `<img>` existed for it anywhere in the viewport.
 *
 * The remedy is the boundary the library documents rather than an internals
 * patch. Supplying `renderImage` makes the viewer publish each picture as a node
 * in the same positioned drawing overlay that already carries the chart, and the
 * hook is handed everything needed to build it: the model entry, the rectangle
 * the viewer computed for the current zoom, and the style of the box it placed.
 * Nothing here is fetched, decoded or measured by this plugin — the source is the
 * viewer's own object URL, the geometry is the viewer's own calculation, and the
 * resource's lifetime stays with the controller that created it.
 *
 * ## Why the node consumes the box instead of re-applying it
 *
 * The viewer wraps this node in a positioned element carrying the `style` it
 * passes here — absolute placement at the computed rectangle, the rectangle's
 * width and height, the z-order, and `overflow: hidden`. The node's job is
 * therefore to fill that box, which is what the library's own default `<img>`
 * does (`width: 100%; height: 100%`). Re-applying the style's `left` and `top` to
 * this node would place it a second time inside a box that is already at those
 * coordinates, translating the picture by the rectangle's own offset and clipping
 * it away. The geometry is used, not recomputed: the width and height come from
 * the style the viewer published, and no anchor, row height, column width or EMU
 * value is read anywhere in this module.
 *
 * The function is a module-level constant rather than an inline arrow, and that
 * is deliberate: the viewer memoizes its drawing layout against the identity of
 * this callback, so a fresh closure per render would repaint the overlay on every
 * commit.
 *
 * ## Read-only
 *
 * `XlsxBody` renders workbooks with `readOnly`, and this node preserves that: it
 * exposes no drag, no resize handle and no pointer path into the workbook, and it
 * never asks the controller to move, resize or rewrite an image. Movement and
 * resizing in the library run through `renderImageSelection` and the controller's
 * image mutations, neither of which is used.
 */

import type { JSX } from 'react'
import type { XlsxImageRenderProps } from '@extend-ai/react-xlsx'

/**
 * Marks the image node this renderer owns.
 *
 * It exists so that "the embedded picture was published" is a fact the browser
 * smoke can read from the document instead of inferring it from a painted canvas,
 * and so that the plugin's node is distinguishable from any image the viewer
 * draws for itself. It carries no selection, provenance or geometry meaning.
 */
export const XLSX_IMAGE_ATTRIBUTE = 'data-dsa-xlsx-image'

/**
 * Render one worksheet picture inside the box the viewer positioned for it.
 *
 * @param props - the viewer's public `XlsxImageRenderProps`: the model entry, the
 *   rectangle in viewer pixels, and the style of the box this node fills.
 * @returns the image node.
 */
export function renderXlsxImage({ image, style }: XlsxImageRenderProps): JSX.Element {
  return (
    <img
      {...{ [XLSX_IMAGE_ATTRIBUTE]: '' }}
      src={image.src}
      // The workbook's own alt text, falling back to the picture's name. An
      // empty string is a deliberate value rather than a missing one: a decorative
      // picture with no metadata should be announced as nothing, not as a filename.
      alt={image.description ?? image.name ?? ''}
      draggable={false}
      style={{
        display: 'block',
        width: style.width,
        height: style.height,
        objectFit: 'contain',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  )
}
