import { describe, it, expect } from 'vitest'
import { decodeLinear16 } from './useVoice'

describe('decodeLinear16', () => {
  it('converts an empty buffer to an empty Float32Array', () => {
    const result = decodeLinear16(new ArrayBuffer(0))
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(0)
  })

  it('converts Int16 MAX (32767) to ~1.0 float', () => {
    const buf = new ArrayBuffer(2)
    new Int16Array(buf)[0] = 32767
    const result = decodeLinear16(buf)
    expect(result.length).toBe(1)
    // 32767 / 32768 ≈ 0.9999...
    expect(result[0]).toBeCloseTo(32767 / 32768, 5)
  })

  it('converts Int16 MIN (-32768) to -1.0 float', () => {
    const buf = new ArrayBuffer(2)
    new Int16Array(buf)[0] = -32768
    const result = decodeLinear16(buf)
    expect(result.length).toBe(1)
    expect(result[0]).toBeCloseTo(-1.0, 5)
  })

  it('converts 0 to 0.0 float', () => {
    const buf = new ArrayBuffer(2)
    new Int16Array(buf)[0] = 0
    const result = decodeLinear16(buf)
    expect(result[0]).toBe(0)
  })

  it('handles multi-sample buffers correctly', () => {
    const samples = [0, 32767, -32768, 16384, -16384]
    const buf = new ArrayBuffer(samples.length * 2)
    const int16 = new Int16Array(buf)
    samples.forEach((s, i) => { int16[i] = s })
    const result = decodeLinear16(buf)
    expect(result.length).toBe(samples.length)
    expect(result[0]).toBe(0)
    expect(result[1]).toBeCloseTo(32767 / 32768, 4)
    expect(result[2]).toBeCloseTo(-1.0, 4)
    expect(result[3]).toBeCloseTo(16384 / 32768, 4)
    expect(result[4]).toBeCloseTo(-16384 / 32768, 4)
  })
})
