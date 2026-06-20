import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, getPayloadMock } = vi.hoisted(() => {
  const authMock = vi.fn()
  const getPayloadMock = vi.fn()
  return { authMock, getPayloadMock }
})

vi.mock('payload', () => ({ getPayload: getPayloadMock }))
vi.mock('@payload-config', () => ({ default: {} }))

import { POST } from './route'

function makeRequest(body: unknown = { text: 'Hello' }) {
  return new Request('http://localhost/api/deepgram/speak', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeUser = { id: '1', collection: 'users' as const }

beforeEach(() => {
  authMock.mockReset()
  getPayloadMock.mockReset()
  vi.stubGlobal('fetch', vi.fn())
  getPayloadMock.mockResolvedValue({ auth: authMock, logger: { error: vi.fn() } })
  delete process.env.DEEPGRAM_API_KEY
})

describe('POST /api/deepgram/speak', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue({ user: null })
    expect((await POST(makeRequest())).status).toBe(401)
  })

  it('returns 401 for a non-users principal', async () => {
    authMock.mockResolvedValue({ user: { id: 'k', collection: 'payload-mcp-api-keys' } })
    expect((await POST(makeRequest())).status).toBe(401)
  })

  it('returns 503 when DEEPGRAM_API_KEY is unset', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    expect((await POST(makeRequest())).status).toBe(503)
  })

  it('returns 400 for empty text', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'k'
    expect((await POST(makeRequest({ text: '   ' }))).status).toBe(400)
  })

  it('proxies audio and uses a TRIMMED key in the Deepgram header (never sent to client)', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = '  spacey-key  ' // trailing/leading whitespace
    const audio = new Uint8Array([1, 2, 3, 4]).buffer
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(audio, { status: 200, headers: { 'content-type': 'audio/L16' } }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeRequest({ text: 'Hello from Eve' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/audio\/L16/)
    // Verify the upstream Deepgram call used the trimmed key (server-to-Deepgram only).
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Token spacey-key')
    const out = await res.arrayBuffer()
    expect(out.byteLength).toBe(4)
  })

  it('returns 502 when Deepgram errors', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'k'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 403 })),
    )
    expect((await POST(makeRequest())).status).toBe(502)
  })
})
