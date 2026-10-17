// mtcute's AES-IGE runs in WebAssembly. @mtcute/node reads the .wasm from node_modules at run
// time, but the packaged app has no node_modules, so the SIMD build is inlined into the bundle
// as a data URL instead (`assetsInclude` in the Vite configs; Electron's V8 always has SIMD).
import wasmDataUrl from '@mtcute/wasm/mtcute-simd.wasm?inline';

export function mtcuteWasmBytes(): Uint8Array {
  const comma = wasmDataUrl.indexOf(',');
  return Buffer.from(wasmDataUrl.slice(comma + 1), 'base64');
}
