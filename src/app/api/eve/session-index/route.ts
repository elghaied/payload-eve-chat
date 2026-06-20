import { getPayload } from 'payload'
import config from '@payload-config'
import {
  createConversation,
  loadConversationBySession,
  updateConversationCursor,
} from '@/eve/conversations'
import type { User } from '@/payload-types'

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })

  if (!user || user.collection !== 'users') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TypeScript narrows to User (users collection) after the guard above.
  const typedUser = user as User

  let body: { eveSessionId?: unknown; continuationToken?: unknown; streamIndex?: unknown; title?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.eveSessionId || typeof body.eveSessionId !== 'string') {
    return Response.json({ error: 'Missing eveSessionId' }, { status: 400 })
  }

  const {
    eveSessionId,
    continuationToken,
    streamIndex,
    title,
  } = body as {
    eveSessionId: string
    continuationToken?: string
    streamIndex?: number
    title?: string
  }

  // Upsert: find existing row, create if missing, then update cursor. `eveSessionId` is
  // unique, so a concurrent request that already created the row makes our create throw —
  // catch it and fall through to the update (idempotent, no duplicate row).
  const existing = await loadConversationBySession(payload, eveSessionId, typedUser)
  if (!existing) {
    try {
      await createConversation(payload, typedUser, title ?? 'New conversation', eveSessionId)
    } catch {
      // Lost the create race to a concurrent request; the row now exists — update below.
    }
  }
  await updateConversationCursor(payload, eveSessionId, typedUser, {
    continuationToken,
    streamIndex,
    title,
  })

  return Response.json({ ok: true })
}
