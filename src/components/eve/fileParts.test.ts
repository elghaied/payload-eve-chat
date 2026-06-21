import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileUIPart } from 'ai'

// ---- Fixtures ----

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) // minimal JPEG magic
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])               // minimal PNG magic

function makeFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
  return {
    type: 'file',
    mediaType: 'image/jpeg',
    url: 'data:image/jpeg;base64,/9j/4AAQ==',
    filename: 'photo.jpg',
    ...overrides,
  }
}

// ---- Mock fetch to return fixture bytes (re-stubbed before each test) ----

function makeDefaultFetchStub() {
  vi.stubGlobal('fetch', async (url: string) => {
    const isJpeg = url.includes('jpeg') || url.includes('photo')
    const bytes = isJpeg ? jpegBytes : pngBytes
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    } as Response
  })
}

// ---- Mock eve/client so test stays unit-level ----

vi.mock('eve/client', () => ({
  createDataUrlFilePart: vi.fn(({ bytes, filename, mediaType }: { bytes: Uint8Array; filename?: string; mediaType: string }) => ({
    type: 'file' as const,
    data: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
    mediaType,
    filename,
  })),
  createTextWithFileContent: vi.fn(),
}))

import { buildUserContent } from './fileParts'

beforeEach(() => makeDefaultFetchStub())
afterEach(() => vi.unstubAllGlobals())

describe('buildUserContent', () => {
  it('returns [textPart, filePart] for single image + text', async () => {
    const result = await buildUserContent('What do you see?', [makeFile()])
    expect(Array.isArray(result)).toBe(true)
    const arr = result as Array<{ type: string }>
    expect(arr).toHaveLength(2)
    expect(arr[0]).toMatchObject({ type: 'text', text: 'What do you see?' })
    expect(arr[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
  })

  it('returns [textPart, ...fileParts] for multiple files', async () => {
    const files = [
      makeFile({ mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,/9j/', filename: 'a.jpg' }),
      makeFile({ mediaType: 'image/png', url: 'data:image/png;base64,iVBO', filename: 'b.png' }),
    ]
    const result = await buildUserContent('hello', files)
    const arr = result as Array<{ type: string }>
    expect(arr).toHaveLength(3)
    expect(arr[0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(arr[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    expect(arr[2]).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })

  it('returns file parts only when text is empty', async () => {
    const result = await buildUserContent('', [makeFile()])
    const arr = result as Array<{ type: string }>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({ type: 'file' })
  })

  it('returns file parts only when text is whitespace', async () => {
    const result = await buildUserContent('   ', [makeFile()])
    const arr = result as Array<{ type: string }>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({ type: 'file' })
  })

  it('skips a file and warns when fetch throws (graceful reject)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badFile = makeFile({ url: 'data:image/jpeg;base64,BROKEN', filename: 'bad.jpg' })

    // Override fetch for this test to fail on the bad URL
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string) => {
      if ((url as string).includes('BROKEN')) throw new Error('fetch failed')
      return originalFetch(url)
    })

    const result = await buildUserContent('hi', [badFile, makeFile({ url: 'data:image/jpeg;base64,/9j/', filename: 'good.jpg' })])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad.jpg'), expect.any(Error))
    const arr = result as Array<{ type: string }>
    // bad file skipped; text + 1 good file remain
    expect(arr).toHaveLength(2)
    expect(arr[0]).toMatchObject({ type: 'text' })
    expect(arr[1]).toMatchObject({ type: 'file' })

    warnSpy.mockRestore()
  })

  it('falls back to text-only when all files fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => { throw new Error('all fail') })
    const result = await buildUserContent('fallback text', [makeFile()])
    const arr = result as Array<{ type: string }>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({ type: 'text', text: 'fallback text' })
    warnSpy.mockRestore()
  })
})
