import type { Access, CollectionConfig } from 'payload'

/** A user may only see and change their own conversations. */
const ownConversations: Access = ({ req }) => {
  if (!req.user) return false
  return { user: { equals: req.user.id } }
}

/**
 * Stores chat threads for the Eve agent. `messages` holds the AI SDK
 * `UIMessage[]` verbatim so the client can rehydrate a thread on reload.
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
    { name: 'messages', type: 'json' },
  ],
  timestamps: true,
}
