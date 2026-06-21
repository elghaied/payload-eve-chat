import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { savePhotoToMedia, type SavedPhoto } from './unsplash-add-tool'

const MAX_PHOTOS = 10

export async function addPhotosToMediaHandler({
  authorizedMCP,
  input,
  req,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { photos: Array<{ photoId: string; alt: string }> }
  req: PayloadRequest
}) {
  const saved: SavedPhoto[] = []
  const failed: Array<{ photoId: string; error: string }> = []

  // Sequential (not parallel) to stay gentle on the Unsplash demo rate limit (50/hr).
  for (const p of input.photos.slice(0, MAX_PHOTOS)) {
    const result = await savePhotoToMedia({ photoId: p.photoId, alt: p.alt, req, authorizedMCP })
    if (result.ok) saved.push(result.saved)
    else failed.push({ photoId: p.photoId, error: result.error })
  }

  const failNote = failed.length > 0 ? ` ${failed.length} failed.` : ''
  return {
    // Terse confirmation only — the saved-photos grid card shows the images + credits. Do NOT put
    // ![media:<id>]() embed codes here; they belong in the article body, not in a chat message.
    content: [
      {
        type: 'text' as const,
        text: `Saved ${saved.length} photo${saved.length === 1 ? '' : 's'} to Media.${failNote}`,
      },
    ],
    structuredContent: { saved, failed } as unknown as Record<string, unknown>,
    ...(saved.length === 0 ? { isError: true as const } : {}),
  }
}

/**
 * Payload MCP tool: save MULTIPLE chosen Unsplash photos to Media in ONE call (the user
 * multi-selects in the searchPhotos grid and clicks "Add selected"). Each photo is saved with
 * photographer attribution; partial failures are reported in `failed`. Requires
 * UNSPLASH_ACCESS_KEY. Same SSRF/size guards as addPhotoToMedia (shared savePhotoToMedia).
 *
 * To use the saved photos, embed `![media:<id>]()` ONLY inside the article body via
 * createDocumentFromMarkdown — never print the embed codes as a chat message.
 */
export const addPhotosToMediaTool = defineTool({
  description:
    'Save MULTIPLE Unsplash photos to the Payload Media collection in one call (use when the user selected ' +
    'several photos from searchPhotos). Input: photos:[{photoId, alt}]. Returns the saved Media docs. To use ' +
    'them, embed `![media:<id>]()` ONLY inside the article body (createDocumentFromMarkdown) with a caption ' +
    '`_Photo by [Name](creditUrl) on Unsplash_` each. Do NOT print embed codes as a chat message — the saved ' +
    'photos card already shows them.',
  input: z.object({
    photos: z
      .array(
        z.object({
          photoId: z.string().min(1).describe('Unsplash photo id from searchPhotos.'),
          alt: z.string().min(1).max(500).describe('Alt text for this photo.'),
        }),
      )
      .min(1)
      .max(MAX_PHOTOS)
      .describe('The chosen photos to save (max 10).'),
  }),
}).handler(addPhotosToMediaHandler as never)
