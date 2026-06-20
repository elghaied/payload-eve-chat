import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ auth: authMock }) }))
vi.mock('@payload-config', () => ({ default: {} }))

import { authenticateAdmin } from './auth'

beforeEach(() => authMock.mockReset())

describe('authenticateAdmin', () => {
  it('accepts a users-collection user', async () => {
    authMock.mockResolvedValue({ user: { id: '42', collection: 'users' } })
    expect(await authenticateAdmin(new Headers())).toEqual({ id: '42' })
  })
  it('rejects anonymous', async () => {
    authMock.mockResolvedValue({ user: null })
    expect(await authenticateAdmin(new Headers())).toBeNull()
  })
  it('rejects an API-key principal', async () => {
    authMock.mockResolvedValue({ user: { id: 'k1', collection: 'payload-mcp-api-keys' } })
    expect(await authenticateAdmin(new Headers())).toBeNull()
  })
})
