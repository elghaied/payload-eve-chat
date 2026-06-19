import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  logger: { error: vi.fn() },
  getEveConfig: vi.fn(),
  synthesize: vi.fn(),
}))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ auth: m.auth, logger: m.logger })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/eve/config', () => ({ getEveConfig: m.getEveConfig }))
vi.mock('@/eve/audio', () => ({ synthesize: m.synthesize }))

import { POST } from './route'

const jsonReq = (body: unknown) =>
  new Request('http://x/api/eve/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.getEveConfig.mockReturnValue({ ttsBaseURL: 'http://tts/v1' })
  m.auth.mockResolvedValue({ user: { collection: 'users' } })
})

describe('POST /api/eve/speak', () => {
  it('401 when unauthenticated', async () => {
    m.auth.mockResolvedValue({ user: null })
    expect((await POST(jsonReq({ text: 'hi' }))).status).toBe(401)
  })

  it('403 for non-users collection', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'payload-mcp-api-keys' } })
    expect((await POST(jsonReq({ text: 'hi' }))).status).toBe(403)
  })

  it('503 when TTS is not attached', async () => {
    m.getEveConfig.mockReturnValue({ ttsBaseURL: undefined })
    expect((await POST(jsonReq({ text: 'hi' }))).status).toBe(503)
  })

  it('400 when text is empty', async () => {
    expect((await POST(jsonReq({ text: '   ' }))).status).toBe(400)
  })

  it('streams audio bytes with the upstream content type', async () => {
    m.synthesize.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    )
    const res = await POST(jsonReq({ text: 'hello' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('503 when the TTS service throws', async () => {
    m.synthesize.mockRejectedValue(new Error('down'))
    expect((await POST(jsonReq({ text: 'hi' }))).status).toBe(503)
    expect(m.logger.error).toHaveBeenCalled()
  })
})
