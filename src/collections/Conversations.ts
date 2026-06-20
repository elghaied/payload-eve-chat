import type { Access, CollectionConfig } from 'payload'

/** A user may only see and change their own conversations. */
const ownConversations: Access = ({ req }) => {
  if (!req.user) return false
  return { user: { equals: req.user.id } }
}

/**
 * Thin index over Eve sessions. Each row maps a Payload user to an Eve
 * session id. Messages live in Eve (replayed via GET /eve/v1/session/:id/stream).
 * The `continuationToken` and `streamIndex` fields form the session cursor
 * needed to continue or resume the session.
 */
export const Conversations: CollectionConfig = {
  slug: 'conversations',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'user', 'updatedAt'],
    group: 'Eve',
  },
  access: {
    read: ownConversations,
    update: ownConversations,
    delete: ownConversations,
    create: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'eveSessionId', type: 'text', index: true },
    { name: 'continuationToken', type: 'text' },
    { name: 'streamIndex', type: 'number' },
  ],
  // v4 enables versions by default; chat threads don't need version history.
  versions: false,
  timestamps: true,
}
