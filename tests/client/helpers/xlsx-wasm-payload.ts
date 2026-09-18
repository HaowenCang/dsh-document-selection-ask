/**
 * The stand-in `virtual:dsa-xlsx-wasm-gzip` payload for specs that import the
 * XLSX runtime without stubbing the virtual module themselves.
 *
 * `tsdown.config.ts` produces that module by reading the exact installed
 * `@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm`, verifying its SHA-256 and
 * embedding a deterministic gzip of it as base64 — 2.2 million characters that
 * no spec assertion is about, and that Vite would otherwise parse for every
 * client spec. The alias in `vitest.config.ts` substitutes this small payload,
 * whose three values are computed the same way the build computes them, so the
 * runtime under test exercises its real pipeline: base64 decode, gzip inflate,
 * length check, SHA-256 check, install.
 *
 * The real artifact is asserted by `tests/unit/xlsx-bundle.spec.ts`, which reads
 * the installed package and the built client bundle rather than this stand-in.
 */

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

/**
 * The stand-in engine binary.
 *
 * Deterministic bytes rather than text: the runtime compares a length and a
 * digest, and neither is about what the bytes mean.
 */
const RAW_WASM = new Uint8Array(
  Array.from({ length: 4096 }, (_unused, index) => (index * 31 + 7) % 256),
)

/** The exact byte length of {@link RAW_WASM}. */
export const XLSX_WASM_RAW_BYTES = RAW_WASM.byteLength

/** The SHA-256 of {@link RAW_WASM}, lowercase hex. */
export const XLSX_WASM_SHA256: string = createHash('sha256').update(RAW_WASM).digest('hex')

/** The deterministic gzip of {@link RAW_WASM}, base64-encoded. */
export const XLSX_WASM_GZIP_BASE64: string = gzipSync(RAW_WASM, { level: 9 }).toString('base64')
