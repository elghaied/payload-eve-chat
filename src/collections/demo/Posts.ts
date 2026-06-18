import type { CollectionConfig } from 'payload'

/**
 * A classic blog collection. The chat agent reads and writes these via MCP.
 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  // Demo collection — any signed-in user may manage these (the agent operates them via MCP).
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
  timestamps: true,
}
