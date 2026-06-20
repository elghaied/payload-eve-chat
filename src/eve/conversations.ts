import type { Payload } from 'payload'
import type { Conversation, User } from '@/payload-types'

/** Creates a new conversation row for the user, linked to the given Eve session. */
export async function createConversation(
  payload: Payload,
  user: User,
  title: string,
  eveSessionId: string,
): Promise<Conversation> {
  return payload.create({
    collection: 'conversations',
    data: { title: title.slice(0, 80), user: user.id, eveSessionId },
    overrideAccess: false,
    user,
  })
}

/**
 * Updates the session cursor fields on the conversation row identified by
 * `eveSessionId` and owned by `user`. Only the provided fields are written.
 * No-op if no matching row is found.
 */
export async function updateConversationCursor(
  payload: Payload,
  eveSessionId: string,
  user: User,
  cursor: { continuationToken?: string; streamIndex?: number; title?: string },
): Promise<void> {
  const res = await payload.find({
    collection: 'conversations',
    where: { eveSessionId: { equals: eveSessionId }, user: { equals: user.id } },
    limit: 1,
    overrideAccess: false,
    user,
  })
  const row = res.docs[0]
  if (!row) return

  await payload.update({
    collection: 'conversations',
    id: row.id,
    data: cursor,
    overrideAccess: false,
    user,
  })
}

/** Returns all conversations for the user, sorted newest-first. */
export async function listConversations(payload: Payload, user: User): Promise<Conversation[]> {
  const res = await payload.find({
    collection: 'conversations',
    where: { user: { equals: user.id } },
    sort: '-updatedAt',
    limit: 100,
    overrideAccess: false,
    user,
  })
  return res.docs
}

/**
 * Returns the conversation row for a given Eve session id owned by the user,
 * or null if none exists.
 */
export async function loadConversationBySession(
  payload: Payload,
  eveSessionId: string,
  user: User,
): Promise<Conversation | null> {
  const res = await payload.find({
    collection: 'conversations',
    where: { eveSessionId: { equals: eveSessionId }, user: { equals: user.id } },
    limit: 1,
    overrideAccess: false,
    user,
  })
  return res.docs[0] ?? null
}
