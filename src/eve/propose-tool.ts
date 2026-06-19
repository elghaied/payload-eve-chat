import { tool } from 'ai'
import { z } from 'zod'

/**
 * Native (non-MCP) tool the agent calls to PROPOSE a post for the user to review.
 * It performs no write — it echoes the draft so the client can render an editable
 * preview. The post is only created after the user approves, when the agent calls
 * the MCP `createDocumentFromMarkdown` tool with the approved content.
 */
export const proposePost = tool({
  description:
    'Propose a new blog post for the user to review and approve before it is created. ' +
    'Use this FIRST for every post — it shows the user an editable preview and does NOT ' +
    'save anything. Only after the user approves (they will send an explicit "create this ' +
    'post" message with the final content) do you create it with createDocumentFromMarkdown, ' +
    'using the approved content verbatim.',
  inputSchema: z.object({
    title: z.string().describe('Post title'),
    status: z.enum(['draft', 'published']).default('draft'),
    markdown: z.string().describe('Post body as Markdown'),
  }),
  execute: async ({ title, status, markdown }) => ({ title, status, markdown }),
})
