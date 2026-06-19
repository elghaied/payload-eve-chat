import { defineTool } from '@payloadcms/plugin-mcp'
import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import type { RequiredDataFromCollectionSlug } from 'payload'
import { z } from 'zod'

/**
 * Collections this tool is allowed to write to. This tool calls `payload.create`
 * directly, so it bypasses the plugin's per-collection MCP access checks — the
 * allowlist is what keeps it from writing locked-down collections (users, media,
 * conversations). Add a collection here when it gains a Lexical richText field
 * the agent should populate.
 */
const ALLOWED_COLLECTIONS = ['posts'] as const

/**
 * Generic MCP tool: create a document in any allowed collection, converting named
 * fields from Markdown to Lexical first.
 *
 * Lexical `richText` fields store a structured JSON document, so the generic
 * `createDocument` tool can't accept a plain-string body. Rather than a custom
 * create tool per collection, this one tool converts any field named in
 * `markdown` to Lexical (via Payload's official `convertMarkdownToLexical`) and
 * merges it into `data` before creating — so the model never has to handle
 * Lexical JSON, and the same tool works for every Lexical collection.
 */
export const createDocumentFromMarkdownTool = defineTool({
  description:
    'Create a document, converting Markdown to rich text. Put plain fields in `data`; put any rich-text (Lexical) field in `markdown` as a fieldName -> Markdown map (e.g. { content: "# Title\\n\\nBody" }). Use this for collections with a rich-text field, such as posts.',
  input: z.object({
    collectionSlug: z
      .enum(ALLOWED_COLLECTIONS)
      .describe('The collection to create in (only rich-text collections are allowed here)'),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Non-Markdown fields, e.g. { "title": "Hello", "status": "draft" }'),
    markdown: z
      .record(z.string(), z.string())
      .optional()
      .describe('Map of rich-text field name -> Markdown body, e.g. { "content": "# Hi\\n\\nText" }'),
  }),
}).handler(async ({ authorizedMCP, input, req }) => {
  const data: Record<string, unknown> = { ...(input.data ?? {}) }

  const markdownFields = Object.entries(input.markdown ?? {})
  if (markdownFields.length > 0) {
    const editorConfig = await editorConfigFactory.default({ config: req.payload.config })
    for (const [field, markdown] of markdownFields) {
      data[field] = convertMarkdownToLexical({ editorConfig, markdown })
    }
  }

  const doc = await req.payload.create({
    collection: input.collectionSlug,
    data: data as RequiredDataFromCollectionSlug<(typeof ALLOWED_COLLECTIONS)[number]>,
    // Run with the MCP caller's identity and access, like the built-in tools.
    overrideAccess: authorizedMCP.overrideAccess,
    user: authorizedMCP.user,
  })

  return {
    content: [
      {
        type: 'text',
        text: `Created ${input.collectionSlug} document (id: ${doc.id}).`,
      },
    ],
    doc: doc as unknown as Record<string, unknown>,
  }
})
