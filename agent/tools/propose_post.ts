import { defineTool } from 'eve/tools'
import { z } from 'zod'

/**
 * No-write tool that echoes a proposed post draft back to the client.
 * The model calls this INSTEAD of createDocumentFromMarkdown when the user
 * asks to write/draft/create a post. The UI reads the output to open an
 * editable preview panel; nothing is saved until the user approves.
 */
export default defineTool({
  description:
    'Propose a new blog post for the user to review and edit before it is created. ' +
    'Call this (NOT createDocumentFromMarkdown) whenever the user asks to write/draft/create a ' +
    'post. It does not save anything — it shows the draft to the user for approval.',
  inputSchema: z.object({
    title: z.string().min(1),
    status: z.enum(['draft', 'published']).default('draft'),
    markdown: z.string().min(1),
  }),
  // Pure echo — the UI reads this output to open the editable preview panel.
  execute: async ({ title, status, markdown }) => ({ title, status, markdown }),
})
