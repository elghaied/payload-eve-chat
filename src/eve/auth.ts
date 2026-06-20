import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Validates the request's Payload session and returns the admin user id, or null.
 * Only real users-collection users are accepted (mirrors the old /api/eve guard:
 * anonymous and MCP-API-key principals are rejected).
 */
export async function authenticateAdmin(headers: Headers): Promise<{ id: string } | null> {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers })
    if (!user || user.collection !== 'users') return null
    return { id: String(user.id) }
  } catch (err) {
    console.error('[authenticateAdmin] auth error — failing closed', err instanceof Error ? err.message : err)
    return null
  }
}
