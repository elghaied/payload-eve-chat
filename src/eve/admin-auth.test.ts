import { describe, it, expect, vi } from 'vitest'
// The helper lives under agent/ (Eve bundles agent/* into its runtime); the test lives
// here in src/ (Eve must not discover *.test files under agent/).
import { authorizeAdminRequest } from '../../agent/channels/eve'

const req = (cookie?: string) =>
  new Request('http://x/eve', cookie ? { headers: { cookie } } : undefined)

const okFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('authorizeAdminRequest', () => {
  it('returns the user id for a valid users-collection session', async () => {
    const f = okFetch({ user: { id: 42, email: 'a@b.c' } })
    expect(await authorizeAdminRequest(req('payload-token=x'), f, 'http://h')).toEqual({ id: '42' })
  })

  it('returns null when there is no cookie (no call made)', async () => {
    const f = vi.fn() as unknown as typeof fetch
    expect(await authorizeAdminRequest(req(undefined), f, 'http://h')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('returns null when /api/users/me has no user (anonymous)', async () => {
    const f = okFetch({ user: null })
    expect(await authorizeAdminRequest(req('payload-token=x'), f, 'http://h')).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    const f = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    expect(await authorizeAdminRequest(req('payload-token=x'), f, 'http://h')).toBeNull()
  })

  it('fails closed when fetch throws', async () => {
    const f = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await authorizeAdminRequest(req('payload-token=x'), f, 'http://h')).toBeNull()
  })
})
