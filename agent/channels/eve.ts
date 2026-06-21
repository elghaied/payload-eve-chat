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
/**
 * Where the Eve runtime should reach the Payload app's `/api/users/me`.
 *
 * Local dev: `http://localhost:3000`. On Vercel the Eve runtime is a SEPARATE service, so
 * `localhost` points at nothing and the admin-session check would always fail with
 * "Authorization is required for this route." Fall back to the deployment's own public URL —
 * `VERCEL_PROJECT_PRODUCTION_URL` (stable production domain) or `VERCEL_URL` (per-deployment,
 * for previews). The forwarded session cookie is validated by token regardless of which host we
 * hit, so any reachable instance of this project works. Override with `PAYLOAD_INTERNAL_URL` for
 * a custom internal hostname.
 */
export function resolveAdminBaseUrl(): string {
  if (process.env.PAYLOAD_INTERNAL_URL) return process.env.PAYLOAD_INTERNAL_URL
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost}`
  return 'http://localhost:3000'
}

export async function authorizeAdminRequest(
  request: Request,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string = resolveAdminBaseUrl(),
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
