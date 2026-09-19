/**
 * Types for the XLSX fixture generator.
 *
 * `generate-xlsx-fixtures.mjs` is plain ESM; this sibling declaration is what
 * lets `tests/unit/xlsx-fixtures.spec.ts` import the deterministic picture
 * builder without adding a build step or a dependency. It declares the exports
 * that spec reads and nothing else — the generator's other entry points write
 * files and are never called from a spec.
 */

/** The fixture picture's width in pixels. */
export const SAMPLE_PNG_WIDTH: number

/** The fixture picture's height in pixels. */
export const SAMPLE_PNG_HEIGHT: number

/** The fixture picture's single colour, as R, G, B and A bytes. */
export const SAMPLE_PNG_RGBA: readonly number[]

/** Build the fixture's 64x64 opaque-red PNG. */
export function createSolidRedPng(): Buffer

/** Build a deterministic solid-colour 8-bit RGBA PNG. */
export function createSolidRgbaPng(options?: {
  readonly width?: number
  readonly height?: number
  readonly rgba?: readonly number[]
}): Buffer
