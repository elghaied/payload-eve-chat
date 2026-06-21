import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { assertUnsplashUrl, getPhoto, triggerDownload } from './unsplash'

const UTM = '?utm_source=payload-eve-chat&utm_medium=referral'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

const EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function unsplashErrorMessage(err: unknown): string {
  const status = (err as { status?: number }).status
  if (status === 401 || status === 403) return 'Unsplash auth failed — check UNSPLASH_ACCESS_KEY.'
  if (status === 429) return 'Unsplash rate limit reached (50/hr on the demo tier) — try again shortly.'
  return `Unsplash request failed: ${err instanceof Error ? err.message : String(err)}`
}

export async function addPhotoToMediaHandler({
  authorizedMCP,
  input,
  req,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { photoId: string; alt: string }
  req: PayloadRequest
}) {
  // 1. Fetch photo metadata (re-fetched server-side; URL never round-trips through the model).
  let photo
  try {
    photo = await getPhoto(input.photoId)
  } catch (err) {
    return { content: [{ type: 'text' as const, text: unsplashErrorMessage(err) }], structuredContent: {} as never, isError: true as const }
  }

  // 2. SSRF guard: image URL must be https and on unsplash.com / *.unsplash.com.
  const imageUrl = photo.urls.regular
  try {
    assertUnsplashUrl(imageUrl)
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `SSRF guard: ${err instanceof Error ? err.message : String(err)}` }], structuredContent: {} as never, isError: true as const }
  }

  // 3. Trigger the Unsplash download event (ToS requirement, best-effort).
  try {
    await triggerDownload(photo.links.download_location)
  } catch (err) {
    console.warn('[unsplash] triggerDownload failed (non-fatal):', err)
  }

  // 4. Fetch the image bytes.
  let imageRes: Response
  try {
    imageRes = await fetch(imageUrl, { redirect: 'manual' })
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Failed to fetch image: ${err instanceof Error ? err.message : String(err)}` }], structuredContent: {} as never, isError: true as const }
  }
  if (!imageRes.ok) {
    return { content: [{ type: 'text' as const, text: `Image fetch failed: HTTP ${imageRes.status}` }], structuredContent: {} as never, isError: true as const }
  }

  const contentType = imageRes.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return { content: [{ type: 'text' as const, text: `Unexpected content-type "${contentType}" — expected an image.` }], structuredContent: {} as never, isError: true as const }
  }

  const arrayBuffer = await imageRes.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return { content: [{ type: 'text' as const, text: `Image is too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB; max 10 MB).` }], structuredContent: {} as never, isError: true as const }
  }
  const buf = Buffer.from(arrayBuffer)
  const mimetype = contentType.split(';')[0]!.trim()
  const ext = EXT_MAP[mimetype] ?? 'png'
  const name = `unsplash-${photo.id}.${ext}`

  // 5. Save to Media with attribution.
  const creditUrl = photo.user.links.html + UTM
  const doc = await req.payload.create({
    collection: 'media',
    data: { alt: input.alt, credit: photo.user.name, creditUrl } as never,
    file: { data: buf, mimetype, name, size: buf.length },
    overrideAccess: authorizedMCP.overrideAccess,
    user: authorizedMCP.user,
    req,
  })

  if (!doc.url) {
    return { content: [{ type: 'text' as const, text: 'Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts' }], structuredContent: {} as never, isError: true as const }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `Saved photo by ${photo.user.name} to Media (id: ${doc.id}). Embed: ![media:${doc.id}]() and credit the photographer.`,
      },
    ],
    structuredContent: {
      id: doc.id as string | number,
      url: doc.url as string,
      alt: input.alt,
      credit: photo.user.name,
      creditUrl,
    },
  }
}

/**
 * Payload MCP tool: given an Unsplash photoId (from searchPhotos), fetch the image,
 * trigger the Unsplash download event (ToS), save to Media with photographer attribution,
 * and return an embed placeholder. Requires UNSPLASH_ACCESS_KEY.
 *
 * SSRF guard: only fetches images from *.unsplash.com.
 * Size guard: rejects images > 10 MB.
 */
export const addPhotoToMediaTool = defineTool({
  description:
    'Given a photoId from searchPhotos, download the Unsplash photo and save it to the Payload Media collection ' +
    'with photographer attribution (credit, creditUrl). Returns the Media document id and a Markdown embed ' +
    'placeholder `![media:<id>]()`. After saving, embed the placeholder in the article body AND add a caption ' +
    '`_Photo by [Name](creditUrl) on Unsplash_`. Only call after the user has chosen a photoId from searchPhotos results.',
  input: z.object({
    photoId: z.string().min(1).describe('Unsplash photo id returned by searchPhotos.'),
    alt: z.string().min(1).max(500).describe('Alt text for the saved Media document.'),
  }),
}).handler(addPhotoToMediaHandler as never)
