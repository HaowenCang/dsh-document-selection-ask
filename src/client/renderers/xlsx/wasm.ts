/**
 * Local WebAssembly initialization for Duke sheets engine in react-xlsx.
 *
 * Configures the local package-provided WASM asset endpoint before any workbook
 * parsing or viewer component rendering takes place.
 */

import { setWasmSource } from '@extend-ai/react-xlsx'

let wasmConfigured = false

export function ensureXlsxWasmInitialized(): void {
  if (wasmConfigured) return
  wasmConfigured = true

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1:50001'

  const wasmUrl = `${origin}/dsa-assets/duke_sheets_wasm_bg.wasm`
  setWasmSource(wasmUrl)
}
