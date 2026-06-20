import { eveChannel } from 'eve/channels/eve'
import { type AuthFn } from 'eve/channels/auth'

// NOTE: Eve bundles its runtime ONLY from discovered agent component files (channels,
// connections, tools, ...). It does NOT copy arbitrary helper modules (e.g. agent/lib/*)
// or follow imports outside that set, and importing from src/ or pulling in
// @payload-config via getPayload also fails at runtime. So the admin-auth helper is
// inlined HERE, in the channel file, and depends on nothing outside the `eve` package.

/**
 * Returns the admin user id if the request carries a valid Payload users-collection
 * session cookie, else null. Fails CLOSED on any error.
 *
 * Validation is delegated to Payload's own `/api/users/me` (the Next.js app, where
 * Payload runs) — a non-null `user` there is by definition a users-collection user,
 * reproducing the old admin-only gate without instantiating Payload in the Eve runtime.
 */
export async function authorizeAdminRequest(
  request: Request,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = process.env.PAYLOAD_INTERNAL_URL || 'http://localhost:3000',
): Promise<{ id: string } | null> {
  try {
    const cookie = request.headers.get('cookie')
    if (!cookie) return null
    const res = await fetchImpl(`${baseUrl}/api/users/me`, { headers: { cookie } })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: { id?: string | number } | null }
    const user = data?.user
    if (!user || user.id == null) return null
    return { id: String(user.id) }
  } catch {
    return null
  }
}

// Admin-only: the ONLY accepted principal is a valid Payload users-collection session.
// No localDev()/vercelOidc() fallback — every request reaches the Eve runtime via the
// Next.js proxy (always localhost), so a localhost-trusting authenticator would defeat
// the gate.
const appAuth: AuthFn<Request> = async (request) => {
  const admin = await authorizeAdminRequest(request)
  if (!admin) return null
  return {
    principalType: 'user',
    principalId: admin.id,
    authenticator: 'app',
    issuer: 'payload-eve-chat',
    attributes: {},
  }
}

export default eveChannel({ auth: [appAuth] })
