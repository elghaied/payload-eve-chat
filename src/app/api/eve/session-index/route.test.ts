import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  authMock,
  getPayloadMock,
  loadConversationBySessionMock,
  createConversationMock,
  updateConversationCursorMock,
} = vi.hoisted(() => {
  const authMock = vi.fn()
  const getPayloadMock = vi.fn()
  const loadConversationBySessionMock = vi.fn()
  const createConversationMock = vi.fn()
  const updateConversationCursorMock = vi.fn()
  return {
    authMock,
    getPayloadMock,
    loadConversationBySessionMock,
    createConversationMock,
    updateConversationCursorMock,
  }
})

vi.mock('payload', () => ({ getPayload: getPayloadMock }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/eve/conversations', () => ({
  loadConversationBySession: loadConversationBySessionMock,
  createConversation: createConversationMock,
  updateConversationCursor: updateConversationCursorMock,
}))

import { POST } from './route'

// ── Helper to build a Request ─────────────────────────────────────────────────
function makeRequest(body: unknown) {
  return new Request('http://localhost/api/eve/session-index', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Shared fake user ──────────────────────────────────────────────────────────
const fakeUser = { id: '1', collection: 'users' as const }

beforeEach(() => {
  authMock.mockReset()
  getPayloadMock.mockReset()
  loadConversationBySessionMock.mockReset()
  createConversationMock.mockReset()
  updateConversationCursorMock.mockReset()

  getPayloadMock.mockResolvedValue({ auth: authMock })
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/eve/session-index', () => {
  it('returns 401 when there is no authenticated user', async () => {
    authMock.mockResolvedValue({ user: null })
    const res = await POST(makeRequest({ eveSessionId: 'sess_123' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for a non-users-collection principal', async () => {
    authMock.mockResolvedValue({ user: { id: 'k1', collection: 'payload-mcp-api-keys' } })
    const res = await POST(makeRequest({ eveSessionId: 'sess_123' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    const req = new Request('http://localhost/api/eve/session-index', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when eveSessionId is missing', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    const res = await POST(makeRequest({ continuationToken: 'tok' }))
    expect(res.status).toBe(400)
  })

  it('creates then updates when no existing conversation row', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    loadConversationBySessionMock.mockResolvedValue(null)
    createConversationMock.mockResolvedValue({ id: '99', eveSessionId: 'sess_new' })
    updateConversationCursorMock.mockResolvedValue(undefined)

    const res = await POST(
      makeRequest({
        eveSessionId: 'sess_new',
        continuationToken: 'tok',
        streamIndex: 3,
        title: 'Hello Eve',
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    expect(createConversationMock).toHaveBeenCalledOnce()
    expect(createConversationMock).toHaveBeenCalledWith(
      expect.anything(), // payload instance
      fakeUser,
      'Hello Eve',
      'sess_new',
    )
    expect(updateConversationCursorMock).toHaveBeenCalledOnce()
  })

  it('updates only (no create) when conversation row already exists', async () => {
    authMock.mockResolvedValue({ user: fakeUser })
    loadConversationBySessionMock.mockResolvedValue({ id: '77', eveSessionId: 'sess_existing' })
    updateConversationCursorMock.mockResolvedValue(undefined)

    const res = await POST(
      makeRequest({
        eveSessionId: 'sess_existing',
        continuationToken: 'tok2',
        streamIndex: 5,
      }),
    )
    expect(res.status).toBe(200)
    expect(createConversationMock).not.toHaveBeenCalled()
    expect(updateConversationCursorMock).toHaveBeenCalledOnce()
  })
})
