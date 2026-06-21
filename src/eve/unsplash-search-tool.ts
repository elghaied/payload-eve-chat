import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { searchPhotos, type UnsplashPhoto } from './unsplash'

const UTM = '?utm_source=payload-eve-chat&utm_medium=referral'

export type PhotoCandidate = {
  photoId: string
  description: string
  thumbUrl: string
  photographer: string
  photographerUrl: string
  unsplashUrl: string
}

function toCandidate(photo: UnsplashPhoto): PhotoCandidate {
  const description = photo.alt_description ?? photo.description ?? 'Untitled'
  return {
    photoId: photo.id,
    description,
    thumbUrl: photo.urls.thumb,
    photographer: photo.user.name,
    photographerUrl: photo.user.links.html + UTM,
    unsplashUrl: photo.links.html,
  }
}

function errorMessage(err: unknown): { text: string; isError: true } {
  const status = (err as { status?: number }).status
  if (status === 401 || status === 403)
    return { text: 'Unsplash auth failed — check UNSPLASH_ACCESS_KEY.', isError: true }
  if (status === 429)
    return { text: 'Unsplash rate limit reached (50/hr on the demo tier) — try again shortly.', isError: true }
  return { text: `Unsplash search failed: ${String(err instanceof Error ? err.message : err)}`, isError: true }
}

export async function searchPhotosHandler({
  input,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { query: string; perPage?: number }
  req: PayloadRequest
}) {
  const perPage = input.perPage ?? 6
  try {
    const photos = await searchPhotos(input.query, perPage)
    return {
      content: [{ type: 'text' as const, text: `Found ${photos.length} Unsplash photos for "${input.query}".` }],
      structuredContent: { photos: photos.map(toCandidate) },
    }
  } catch (err) {
    const { text, isError } = errorMessage(err)
    return { content: [{ type: 'text' as const, text }], structuredContent: { photos: [] }, isError }
  }
}

/**
 * Payload MCP tool: search Unsplash for real photos matching a query.
 * Returns a thumbnail grid of candidates (photoId, thumbUrl, photographer, …) via structuredContent.
 * No image download or Media write occurs here — call addPhotosToMedia to save chosen photos.
 */
export const searchPhotosTool = defineTool({
  description:
    'Search Unsplash for real photos matching a query. Returns up to 12 thumbnail candidates ' +
    '(photoId, thumbUrl, photographer, description, photographerUrl, unsplashUrl) via structuredContent. ' +
    'No image is downloaded or stored at this step. After the user picks one or more photos, call ' +
    'addPhotosToMedia to upload them to the Media collection and get embed ids. Only call when a real ' +
    'photograph is requested.',
  input: z.object({
    query: z.string().min(1).max(200).describe('Search query, e.g. "mountain lake at dusk".'),
    perPage: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(6)
      .optional()
      .describe('Number of results to return (default 6, max 12).'),
  }),
}).handler(searchPhotosHandler as never)
