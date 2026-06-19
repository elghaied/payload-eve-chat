// Copies the @ricky0123/vad-web and onnxruntime-web runtime assets the browser
// voice loop needs (audio worklet, Silero ONNX models, ONNX Runtime WASM) into
// public/vad/, so they are served self-hosted from /vad/ instead of a CDN.
//
// Run by `postinstall` and prepended to dev/build (see package.json). Keeping
// assets self-hosted avoids loading third-party code into the privileged admin
// context. The matching base paths live in src/components/eve/useVoice.ts.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(rootDir, 'public', 'vad')

// Resolve the installed package dist dirs in a pnpm-safe way: resolve the
// package entry (root can see vad-web; onnxruntime-web is resolved from
// vad-web's context since it's vad-web's dependency, not a root one).
const vadDist = path.dirname(require.resolve('@ricky0123/vad-web'))
const ortDist = path.dirname(createRequire(require.resolve('@ricky0123/vad-web')).resolve('onnxruntime-web'))

// Only the assets vad-web actually fetches: worklet + both Silero models, and
// the default (non-jsep/asyncify/jspi) ONNX Runtime WASM build + its JS glue.
const files = [
  [vadDist, 'vad.worklet.bundle.min.js'],
  [vadDist, 'silero_vad_legacy.onnx'],
  [vadDist, 'silero_vad_v5.onnx'],
  [ortDist, 'ort-wasm-simd-threaded.mjs'],
  [ortDist, 'ort-wasm-simd-threaded.wasm'],
]

mkdirSync(outDir, { recursive: true })
let copied = 0
for (const [srcDir, name] of files) {
  const src = path.join(srcDir, name)
  if (!existsSync(src)) {
    throw new Error(`[vad-assets] source not found: ${src} (is @ricky0123/vad-web installed?)`)
  }
  const dest = path.join(outDir, name)
  if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) continue
  copyFileSync(src, dest)
  copied++
}
console.log(`[vad-assets] ${copied} copied, ${files.length - copied} up-to-date -> public/vad/`)
