import type { PayloadRequest } from 'payload'
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

export function unsplashErrorMessage(err: unknown): string {
  const status = (err as { status?: number }).status
  if (status === 401 || status === 403) return 'Unsplash auth failed — check UNSPLASH_ACCESS_KEY.'
  if (status === 429) return 'Unsplash rate limit reached (50/hr on the demo tier) — try again shortly.'
  return `Unsplash request failed: ${err instanceof Error ? err.message : String(err)}`
}

export type SavedPhoto = {
  id: string | number
  url: string
  alt: string
  credit: string
  creditUrl: string
}

export type SavePhotoArgs = {
  photoId: string
  alt: string
  req: PayloadRequest
  authorizedMCP: { overrideAccess: boolean; user: unknown }
}

/**
 * Download one Unsplash photo by id and save it to the Media collection with attribution.
 * Used by the addPhotosToMedia tool (which accepts one or more photos and loops this). All
 * the security guards live here: re-fetch the photo server-side, assertUnsplashUrl (https +
 * *.unsplash.com) before fetching, fetch with redirect:'manual' (no off-host bounce), reject
 * non-image / oversize, trigger the Unsplash download event (ToS). Returns a discriminated
 * result so callers can aggregate without throwing.
 */
export async function savePhotoToMedia(
  args: SavePhotoArgs,
): Promise<{ ok: true; saved: SavedPhoto } | { ok: false; error: string }> {
  const { photoId, alt, req, authorizedMCP } = args

  // 1. Fetch photo metadata (re-fetched server-side; URL never round-trips through the model).
  let photo
  try {
    photo = await getPhoto(photoId)
  } catch (err) {
    return { ok: false, error: unsplashErrorMessage(err) }
  }

  // 2. SSRF guard: image URL must be https and on unsplash.com / *.unsplash.com.
  const imageUrl = photo.urls.regular
  try {
    assertUnsplashUrl(imageUrl)
  } catch (err) {
    return { ok: false, error: `SSRF guard: ${err instanceof Error ? err.message : String(err)}` }
  }

  // 3. Trigger the Unsplash download event (ToS requirement, best-effort).
  try {
    await triggerDownload(photo.links.download_location)
  } catch (err) {
    console.warn('[unsplash] triggerDownload failed (non-fatal):', err)
  }

  // 4. Fetch the image bytes (redirect:'manual' so a 30x can't bounce off-host).
  let imageRes: Response
  try {
    imageRes = await fetch(imageUrl, { redirect: 'manual' })
  } catch (err) {
    return { ok: false, error: `Failed to fetch image: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!imageRes.ok) {
    return { ok: false, error: `Image fetch failed: HTTP ${imageRes.status}` }
  }

  const contentType = imageRes.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return { ok: false, error: `Unexpected content-type "${contentType}" — expected an image.` }
  }

  const arrayBuffer = await imageRes.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return {
      ok: false,
      error: `Image is too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB; max 10 MB).`,
    }
  }
  const buf = Buffer.from(arrayBuffer)
  const mimetype = contentType.split(';')[0]!.trim()
  const ext = EXT_MAP[mimetype] ?? 'png'
  const name = `unsplash-${photo.id}.${ext}`

  // 5. Save to Media with attribution.
  const creditUrl = photo.user.links.html + UTM
  const doc = await req.payload.create({
    collection: 'media',
    data: { alt, credit: photo.user.name, creditUrl } as never,
    file: { data: buf, mimetype, name, size: buf.length },
    overrideAccess: authorizedMCP.overrideAccess,
    user: authorizedMCP.user,
    req,
  })

  if (!doc.url) {
    return {
      ok: false,
      error: 'Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts',
    }
  }

  return {
    ok: true,
    saved: {
      id: doc.id as string | number,
      url: doc.url as string,
      alt,
      credit: photo.user.name,
      creditUrl,
    },
  }
}

// NOTE: there is intentionally no single-photo MCP tool. Saving photos to Media goes through
// the one addPhotosToMedia tool (src/eve/unsplash-add-multi-tool.ts), which accepts an array of
// one or more photos. Registering a second, near-identically named single-add tool caused Eve's
// fuzzy tool discovery to reuse the singular and call it N times instead of batching.
