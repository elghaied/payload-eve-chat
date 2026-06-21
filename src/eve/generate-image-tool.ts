import { defineTool } from '@payloadcms/plugin-mcp'
import { generateImage, gateway } from 'ai'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

/**
 * Exported for unit-testing in isolation (the defineTool wrapper is not easily
 * invokable in tests without the full MCP plugin context).
 */
export async function generateImageHandler({
  authorizedMCP,
  input,
  req,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { prompt: string; alt: string; aspectRatio: string }
  req: PayloadRequest
}) {
  const model = gateway.imageModel(
    process.env.EVE_IMAGE_MODEL ?? 'google/imagen-4.0-fast-generate-001',
  )

  const aspectRatio = (input.aspectRatio ?? '16:9') as `${number}:${number}`

  const result = await generateImage({
    model,
    prompt: input.prompt,
    aspectRatio,
    n: 1, // Hard-coded: one hero per call. Batching is intentionally not exposed.
  })

  const buf = Buffer.from(result.image.uint8Array)
  // Use the model-reported mediaType so non-Imagen models (e.g. xai/grok-imagine-image) store
  // with the correct MIME type and file extension rather than always assuming PNG.
  const mediaType = result.image.mediaType ?? 'image/png'
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  const ext = extMap[mediaType] ?? 'png'
  const name = `hero-${Date.now()}.${ext}`

  const doc = await req.payload.create({
    collection: 'media',
    data: { alt: input.alt } as never,
    file: { data: buf, mimetype: mediaType, name, size: buf.length },
    overrideAccess: authorizedMCP.overrideAccess,
    user: authorizedMCP.user,
    req,
  })

  if (!doc.url) {
    throw new Error(
      'Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts',
    )
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Generated image saved to Media (id: ${doc.id}). Embed in Markdown as: ![media:${doc.id}]()`,
      },
    ],
    // structuredContent passes through finalizeToolResponse (NOT stripped like doc).
    // This is the authoritative channel for the in-chat image card (ToolResultCard).
    // Note: do NOT add a `doc` field here — it is stripped at the MCP wire layer by
    // finalizeToolResponse (buildMcpServer.js line 30: `const { doc: _doc, ...rest } = overridden`).
    structuredContent: {
      id: doc.id as string | number,
      url: doc.url as string,
      alt: input.alt,
    },
  }
}

/**
 * Payload MCP tool: generate a 16:9 hero image via the Vercel AI Gateway image model,
 * save it to the Media collection, and return a Markdown embed placeholder.
 *
 * Cost: ~$0.02 per call (google/imagen-4.0-fast-generate-001 default).
 * Only call this tool when the user explicitly requests an image or illustrated article.
 *
 * Returns structuredContent: { id, url, alt } for in-chat preview card rendering.
 * The `doc` field is stripped at the MCP wire layer and must NOT be used for card data.
 */
export const generateImageTool = defineTool({
  description:
    'Generate a hero image using the AI Gateway image model and save it to the Payload Media collection. ' +
    'Returns the Media document id and a Markdown embed placeholder `![media:<id>]()` for use in post bodies. ' +
    'Cost: ~$0.02 per image (default model: google/imagen-4.0-fast-generate-001). ' +
    'Only call when the user explicitly requests a hero image or illustrated article.',
  input: z.object({
    prompt: z
      .string()
      .min(1)
      .max(1000)
      .describe(
        'Text prompt for the image. Be specific: subject, style, mood, composition.',
      ),
    alt: z
      .string()
      .min(1)
      .max(500)
      .describe('Alt text for the saved Media document (required by the Media collection).'),
    aspectRatio: z
      .string()
      .default('16:9')
      .describe(
        'Aspect ratio (default "16:9"). Supported by Imagen 4: "1:1", "4:3", "16:9", "9:16". ' +
        'Other models configured via EVE_IMAGE_MODEL may not support aspectRatio.',
      ),
  }),
}).handler(generateImageHandler as never)
