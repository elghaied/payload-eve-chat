import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    // Payload v4 MCP authenticates with user API keys. Enable a key on the user the Eve agent
    // should act as in production, and set it as MCP_API_KEY.
    useAPIKey: true,
  },
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
