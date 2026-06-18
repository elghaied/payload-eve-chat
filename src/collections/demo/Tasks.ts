import type { CollectionConfig } from 'payload'

/**
 * A simple to-do collection. The chat agent manages these via MCP.
 */
export const Tasks: CollectionConfig = {
  slug: 'tasks',
  // Access: any signed-in user may manage these. This is a DELIBERATE choice for a
  // single-admin demo — multi-tenancy / per-user ownership is intentionally out of scope.
  //
  // For a real multi-user app, add an indexed `user` relationship (defaulted to
  // `req.user.id` in a beforeChange hook, with field-level update access locked) and scope
  // read/update/delete to `{ user: { equals: req.user.id } }` — see the `ownConversations`
  // pattern in src/collections/Conversations.ts.
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'done', 'priority', 'dueDate'],
    group: 'Content',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'done', type: 'checkbox', defaultValue: false },
    {
      name: 'priority',
      type: 'select',
      defaultValue: 'medium',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
    },
    { name: 'dueDate', type: 'date' },
  ],
  timestamps: true,
}
