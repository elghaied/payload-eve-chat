import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { authMock, getPayloadMock } = vi.hoisted(() => {
  const authMock = vi.fn()
  const getPayloadMock = vi.fn()
  return { authMock, getPayloadMock }
})

vi.mock('payload', () => ({ getPayload: getPayloadMock }))
vi.mock('@payload-config', () => ({ default: {} }))

import { POST } from './route'

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest() {
  return new Request('http://localhost/api/deepgram/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
}

const fakeUser = { id: '1', collection: 'users' as const }

beforeEach(() => {
  authMock.mockReset()
  getPayloadMock.mockReset()
  vi.stubGlobal('fetch', vi.fn())

  getPayloadMock.mockResolvedValue({
    auth: authMock,
    logger: { error: vi.fn() },
  })
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/deepgram/token', () => {
  it('returns 401 when there is no authenticated user', async () => {
    authMock.mockResolvedValue({ user: null })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 for a non-users-collection principal', async () => {
    authMock.mockResolvedValue({ user: { id: 'k1', collection: 'payload-mcp-api-keys' } })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 503 when DEEPGRAM_API_KEY is unset', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    const saved = process.env.DEEPGRAM_API_KEY
    delete process.env.DEEPGRAM_API_KEY
    try {
      const res = await POST(makeRequest())
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'voice not configured' })
    } finally {
      if (saved !== undefined) process.env.DEEPGRAM_API_KEY = saved
    }
  })

  it('returns 200 with token when authed and key is set', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'test-api-key'

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'jwt-abc', expires_in: 30 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ token: 'jwt-abc', expires_in: 30 })

    // Verify the server's outgoing request to Deepgram (server-to-Deepgram, never sent to the
    // client) uses the API key in a Token Authorization header — not a Bearer/JWT.
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deepgram.com/v1/auth/grant',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Token test-api-key',
        }),
      }),
    )
  })

  it('returns 502 on Deepgram non-2xx response', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'test-api-key'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ err: 'bad' }), { status: 401 })),
    )

    const res = await POST(makeRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    // Must not leak the API key
    expect(JSON.stringify(body)).not.toContain('test-api-key')
  })

  it('returns an actionable message on a 403 Insufficient permissions', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'test-api-key'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ err_code: 'FORBIDDEN', err_msg: 'Insufficient permissions.' }),
          { status: 403 },
        ),
      ),
    )

    const res = await POST(makeRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/Member/)
    expect(JSON.stringify(body)).not.toContain('test-api-key')
  })

  it('returns 502 when fetch throws (network error)', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    process.env.DEEPGRAM_API_KEY = 'test-api-key'

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const res = await POST(makeRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('test-api-key')
  })
})
