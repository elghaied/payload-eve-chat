import type { CollectionConfig } from 'payload'

/**
 * A simple to-do collection. The chat agent manages these via MCP.
 */
export const Tasks: CollectionConfig = {
  slug: 'tasks',
  // Demo collection — any signed-in user may manage these (the agent operates them via MCP).
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
