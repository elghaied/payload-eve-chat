import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { synthesize, transcribe, AudioServiceError } from './audio'
import type { EveConfig } from './config'

const base = {
  provider: 'anthropic',
  anthropicModel: 'm',
  openaiModel: 'm',
  ollamaModel: 'm',
  ollamaBaseURL: 'x',
  mcpServerUrl: 'x',
  sttBaseURL: 'http://stt/v1',
  sttModel: 'whisper',
  ttsBaseURL: 'http://tts/v1',
  ttsModel: 'kokoro',
  ttsVoice: 'af_sky',
  ttsFormat: 'mp3',
} as unknown as EveConfig

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('transcribe', () => {
  it('POSTs multipart to {sttBaseURL}/audio/transcriptions and returns text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await transcribe({ audio: new Blob(['x']), config: base })
    expect(out).toBe('hello world')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://stt/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('model')).toBe('whisper')
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('adds a bearer header only when sttApiKey is set', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'hi' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await transcribe({ audio: new Blob(['x']), config: { ...base, sttApiKey: 'sk-1' } })
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer sk-1')
  })

  it('throws AudioServiceError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(transcribe({ audio: new Blob(['x']), config: base })).rejects.toBeInstanceOf(AudioServiceError)
  })

  it('throws AudioServiceError when STT is not attached (no base URL)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      transcribe({ audio: new Blob(['x']), config: { ...base, sttBaseURL: undefined } }),
    ).rejects.toBeInstanceOf(AudioServiceError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('synthesize', () => {
  it('POSTs JSON to {ttsBaseURL}/audio/speech with model/input/voice/format', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await synthesize({ text: 'speak this', config: base })
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://tts/v1/audio/speech')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'kokoro', input: 'speak this', voice: 'af_sky', response_format: 'mp3' })
  })

  it('uses the per-call voice override when provided', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await synthesize({ text: 'hi', voice: 'bella', config: base })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).voice).toBe('bella')
  })

  it('throws AudioServiceError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    await expect(synthesize({ text: 'hi', config: base })).rejects.toBeInstanceOf(AudioServiceError)
  })

  it('throws AudioServiceError when TTS is not attached (no base URL)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(synthesize({ text: 'hi', config: { ...base, ttsBaseURL: undefined } })).rejects.toBeInstanceOf(
      AudioServiceError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
