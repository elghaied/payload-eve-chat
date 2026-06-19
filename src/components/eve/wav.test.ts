import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

async function bytes(blob: Blob): Promise<DataView> {
  const buf = await (blob.arrayBuffer?.() ?? new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  }))
  return new DataView(buf)
}
function ascii(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

describe('encodeWav', () => {
  it('produces a RIFF/WAVE header with the right size and format fields', async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const view = await bytes(encodeWav(samples, 16000))
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    // 44-byte header + 2 bytes per sample
    expect(view.byteLength).toBe(44 + samples.length * 2)
    expect(view.getUint32(40, true)).toBe(samples.length * 2) // data chunk size
  })

  it('clamps and scales floats to signed 16-bit', async () => {
    const view = await bytes(encodeWav(new Float32Array([1, -1, 0]), 16000))
    expect(view.getInt16(44, true)).toBe(32767) // +1.0 -> max
    expect(view.getInt16(46, true)).toBe(-32768) // -1.0 -> min
    expect(view.getInt16(48, true)).toBe(0) // 0 -> 0
  })
})
