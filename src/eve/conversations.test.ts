import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

// ---------------------------------------------------------------------------
// Minimal stub types — used until payload generate:types runs.
// These only need to match the fields we reference in assertions.
// ---------------------------------------------------------------------------
type StubConversation = {
  id: string
  title?: string | null
  user: string
  eveSessionId?: string | null
  continuationToken?: string | null
  streamIndex?: number | null
  updatedAt: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Build a minimal Payload mock
// ---------------------------------------------------------------------------
function makePayload() {
  return {
    create: vi.fn(),
    find: vi.fn(),
    update: vi.fn(),
  } as unknown as Payload
}

function makeUser() {
  return { id: 'user-1' } as unknown as import('payload').TypedUser
}

// ---------------------------------------------------------------------------
// Import the module under test AFTER setting up vitest so module cache is fresh
// ---------------------------------------------------------------------------
import {
  createConversation,
  updateConversationCursor,
  listConversations,
  loadConversationBySession,
} from './conversations'

// ---------------------------------------------------------------------------
// createConversation
// ---------------------------------------------------------------------------
describe('createConversation', () => {
  it('calls payload.create with collection, data, overrideAccess:false and user', async () => {
    const payload = makePayload()
    const user = makeUser()
    const stub: StubConversation = {
      id: 'c1',
      title: 'Hello',
      user: 'user-1',
      eveSessionId: 'sess-abc',
      updatedAt: '',
      createdAt: '',
    }
    vi.mocked(payload.create).mockResolvedValue(stub as any)

    const result = await createConversation(payload, user as any, 'Hello', 'sess-abc')

    expect(payload.create).toHaveBeenCalledWith({
      collection: 'conversations',
      data: { title: 'Hello', user: 'user-1', eveSessionId: 'sess-abc' },
      overrideAccess: false,
      user,
    })
    expect(result).toBe(stub)
  })

  it('truncates the title to 80 characters', async () => {
    const payload = makePayload()
    const user = makeUser()
    const longTitle = 'A'.repeat(120)
    vi.mocked(payload.create).mockResolvedValue({ id: 'c2', title: longTitle.slice(0, 80), user: 'user-1', updatedAt: '', createdAt: '' } as any)

    await createConversation(payload, user as any, longTitle, 'sess-xyz')

    const callArg = vi.mocked(payload.create).mock.calls[0][0]
    expect((callArg as any).data.title).toHaveLength(80)
  })

  it('does NOT pass a messages field', async () => {
    const payload = makePayload()
    const user = makeUser()
    vi.mocked(payload.create).mockResolvedValue({ id: 'c3', user: 'user-1', updatedAt: '', createdAt: '' } as any)

    await createConversation(payload, user as any, 'No messages', 'sess-nm')

    const callArg = vi.mocked(payload.create).mock.calls[0][0]
    expect((callArg as any).data).not.toHaveProperty('messages')
  })
})

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------
describe('listConversations', () => {
  it('queries conversations sorted -updatedAt, limit 100, overrideAccess:false, user', async () => {
    const payload = makePayload()
    const user = makeUser()
    vi.mocked(payload.find).mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 100, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    const result = await listConversations(payload, user as any)

    expect(payload.find).toHaveBeenCalledWith({
      collection: 'conversations',
      where: { user: { equals: 'user-1' } },
      sort: '-updatedAt',
      limit: 100,
      overrideAccess: false,
      user,
    })
    expect(result).toEqual([])
  })

  it('returns the docs array', async () => {
    const payload = makePayload()
    const user = makeUser()
    const docs = [{ id: 'c1' }, { id: 'c2' }] as any[]
    vi.mocked(payload.find).mockResolvedValue({ docs, totalDocs: 2, totalPages: 1, page: 1, limit: 100, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    const result = await listConversations(payload, user as any)

    expect(result).toBe(docs)
  })
})

// ---------------------------------------------------------------------------
// loadConversationBySession
// ---------------------------------------------------------------------------
describe('loadConversationBySession', () => {
  it('queries by both eveSessionId AND user, overrideAccess:false', async () => {
    const payload = makePayload()
    const user = makeUser()
    vi.mocked(payload.find).mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    await loadConversationBySession(payload, 'sess-abc', user as any)

    expect(payload.find).toHaveBeenCalledWith({
      collection: 'conversations',
      where: { eveSessionId: { equals: 'sess-abc' }, user: { equals: 'user-1' } },
      limit: 1,
      overrideAccess: false,
      user,
    })
  })

  it('returns the first doc when found', async () => {
    const payload = makePayload()
    const user = makeUser()
    const conv = { id: 'c1', eveSessionId: 'sess-abc', user: 'user-1' } as any
    vi.mocked(payload.find).mockResolvedValue({ docs: [conv], totalDocs: 1, totalPages: 1, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    const result = await loadConversationBySession(payload, 'sess-abc', user as any)

    expect(result).toBe(conv)
  })

  it('returns null when no row matches', async () => {
    const payload = makePayload()
    const user = makeUser()
    vi.mocked(payload.find).mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    const result = await loadConversationBySession(payload, 'nonexistent', user as any)

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateConversationCursor
// ---------------------------------------------------------------------------
describe('updateConversationCursor', () => {
  it('finds the row by eveSessionId+user then calls payload.update with cursor fields', async () => {
    const payload = makePayload()
    const user = makeUser()
    const conv = { id: 'c1', eveSessionId: 'sess-abc', user: 'user-1' } as any
    vi.mocked(payload.find).mockResolvedValue({ docs: [conv], totalDocs: 1, totalPages: 1, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)
    vi.mocked(payload.update).mockResolvedValue(conv)

    await updateConversationCursor(payload, 'sess-abc', user as any, {
      continuationToken: 'tok-1',
      streamIndex: 5,
    })

    expect(payload.update).toHaveBeenCalledWith({
      collection: 'conversations',
      id: 'c1',
      data: { continuationToken: 'tok-1', streamIndex: 5 },
      overrideAccess: false,
      user,
    })
  })

  it('is a no-op when no row matches eveSessionId', async () => {
    const payload = makePayload()
    const user = makeUser()
    vi.mocked(payload.find).mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)

    await updateConversationCursor(payload, 'nonexistent', user as any, {
      continuationToken: 'tok-x',
    })

    expect(payload.update).not.toHaveBeenCalled()
  })

  it('only includes provided cursor fields in the update data', async () => {
    const payload = makePayload()
    const user = makeUser()
    const conv = { id: 'c2', eveSessionId: 'sess-z', user: 'user-1' } as any
    vi.mocked(payload.find).mockResolvedValue({ docs: [conv], totalDocs: 1, totalPages: 1, page: 1, limit: 1, hasNextPage: false, hasPrevPage: false, pagingCounter: 1, nextPage: null, prevPage: null } as any)
    vi.mocked(payload.update).mockResolvedValue(conv)

    await updateConversationCursor(payload, 'sess-z', user as any, { title: 'New title' })

    const callArg = vi.mocked(payload.update).mock.calls[0][0]
    expect((callArg as any).data).toEqual({ title: 'New title' })
    expect((callArg as any).data).not.toHaveProperty('continuationToken')
    expect((callArg as any).data).not.toHaveProperty('streamIndex')
  })
})
