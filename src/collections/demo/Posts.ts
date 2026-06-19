import type { CollectionConfig } from 'payload'

/**
 * A classic blog collection. The chat agent reads and writes these via MCP.
 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  // Access: any signed-in user may manage these. This is a DELIBERATE choice for a
  // single-admin demo — shared content, like a small team's blog. Multi-tenancy /
  // per-user ownership is intentionally out of scope for this example.
  //
  // If you copy this into a real multi-user app, scope mutations to the owner instead
  // (see the `ownConversations` pattern in src/collections/Conversations.ts): force
  // `author` to `req.user.id` in a beforeChange hook so it can't be forged, and return
  // `{ author: { equals: req.user.id } }` from update/delete (and read, if posts are private).
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'author', 'updatedAt'],
    group: 'Content',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'content', type: 'richText' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
  // v4 enables versions by default; this demo doesn't use drafts/versions.
  versions: false,
  timestamps: true,
}
