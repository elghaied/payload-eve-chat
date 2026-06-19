import { defineTool } from '@payloadcms/plugin-mcp'
import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import { z } from 'zod'
import type { Post } from '@/payload-types'

/**
 * Custom MCP tool that lets the agent create a blog post by writing the body as
 * Markdown.
 *
 * `Posts.content` is a Lexical `richText` field, which stores a structured JSON
 * document — not a string. The generic `createDocument` tool validates input
 * against that schema, so plain text is rejected. This tool accepts Markdown and
 * converts it to Lexical with Payload's official `convertMarkdownToLexical`
 * helper before creating the record. The generic `create` tool is disabled for
 * `posts` (see payload.config.ts) so the agent is funnelled here.
 */
export const createPostTool = defineTool({
  description:
    'Create a blog post. Write the body as Markdown in `contentMarkdown`; it is converted to rich text automatically. Use this instead of createDocument for posts.',
  input: z.object({
    title: z.string().describe('The post title'),
    contentMarkdown: z
      .string()
      .optional()
      .describe('The post body as Markdown (headings, lists, bold, links, etc.)'),
    status: z.enum(['draft', 'published']).optional().describe('Defaults to draft'),
    author: z.string().optional().describe('The ID of a users document to set as the author'),
  }),
}).handler(async ({ authorizedMCP, input, req }) => {
  const content = input.contentMarkdown
    ? (convertMarkdownToLexical({
        editorConfig: await editorConfigFactory.default({ config: req.payload.config }),
        markdown: input.contentMarkdown,
      }) as Post['content'])
    : undefined

  const doc = await req.payload.create({
    collection: 'posts',
    data: {
      title: input.title,
      ...(input.status ? { status: input.status } : {}),
      ...(input.author ? { author: input.author } : {}),
      ...(content ? { content } : {}),
    },
    // Run with the MCP caller's identity and access, like the built-in tools.
    overrideAccess: authorizedMCP.overrideAccess,
    user: authorizedMCP.user,
  })

  return {
    content: [
      {
        type: 'text',
        text: `Created post "${doc.title}" (id: ${doc.id}, status: ${doc.status ?? 'draft'}).`,
      },
    ],
    doc: doc as unknown as Record<string, unknown>,
  }
})
