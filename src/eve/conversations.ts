import type { BasePayload, TypedUser } from 'payload'
import type { Conversation } from '@/payload-types'

/** Lists the current user's conversations, newest first. */
export async function listConversations(
  payload: BasePayload,
  user: TypedUser,
): Promise<Conversation[]> {
  const { docs } = await payload.find({
    collection: 'conversations',
    user,
    overrideAccess: false,
    sort: '-updatedAt',
    limit: 50,
    depth: 0,
  })
  return docs
}

/** Loads one conversation if it belongs to the user; otherwise null. */
export async function loadConversation(
  payload: BasePayload,
  id: string,
  user: TypedUser,
): Promise<Conversation | null> {
  try {
    return await payload.findByID({
      collection: 'conversations',
      id,
      user,
      overrideAccess: false,
      depth: 0,
    })
  } catch {
    return null
  }
}

/** Creates a new conversation owned by the user. */
export async function createConversation(
  payload: BasePayload,
  user: TypedUser,
  title: string,
): Promise<Conversation> {
  return payload.create({
    collection: 'conversations',
    user,
    overrideAccess: false,
    data: { title, user: user.id, messages: [] },
  })
}

/** Replaces the stored messages array for a conversation. */
export async function saveMessages(
  payload: BasePayload,
  id: string,
  messages: unknown,
  user: TypedUser,
): Promise<void> {
  await payload.update({
    collection: 'conversations',
    id,
    user,
    overrideAccess: false,
    data: { messages: messages as Conversation['messages'] },
  })
}
