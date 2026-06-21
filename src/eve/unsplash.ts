const BASE = 'https://api.unsplash.com'

function authHeader(): Record<string, string> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set')
  return { Authorization: `Client-ID ${key}` }
}

/**
 * Parse a URL and require it be an https Unsplash host. Throws otherwise.
 * Used before sending the Client-ID auth header or fetching an image, so a
 * tampered/unexpected URL can't leak the key or hit an arbitrary host (SSRF).
 */
export function assertUnsplashUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`Refusing non-URL Unsplash target: ${String(raw).slice(0, 80)}`)
  }
  const okHost = u.hostname === 'unsplash.com' || u.hostname.endsWith('.unsplash.com')
  if (u.protocol !== 'https:' || !okHost) {
    throw new Error(`Refusing non-Unsplash URL: ${u.protocol}//${u.hostname}`)
  }
  return u
}

export type UnsplashPhoto = {
  id: string
  description: string | null
  alt_description: string | null
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  links: { html: string; download: string; download_location: string }
  user: { name: string; username: string; links: { html: string } }
  width: number
  height: number
  color: string | null
}

class UnsplashError extends Error {
  constructor(public status: number, message: string) {
    super(`Unsplash error ${status}: ${message}`)
    this.name = 'UnsplashError'
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeader() })
  if (!res.ok) {
    let msg = String(res.statusText)
    try {
      const body = await res.json()
      if (Array.isArray(body?.errors) && body.errors.length > 0) msg = String(body.errors[0])
    } catch { /* ignore */ }
    throw new UnsplashError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export async function searchPhotos(query: string, perPage: number): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({ query, per_page: String(perPage), content_filter: 'high' })
  const data = await apiGet<{ results: UnsplashPhoto[] }>(`/search/photos?${params}`)
  return data.results
}

export async function getPhoto(id: string): Promise<UnsplashPhoto> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('Invalid Unsplash photo id')
  }
  return apiGet<UnsplashPhoto>(`/photos/${id}`)
}

export async function triggerDownload(downloadLocation: string): Promise<void> {
  try {
    assertUnsplashUrl(downloadLocation)
  } catch (err) {
    console.warn('[unsplash] triggerDownload: invalid URL, skipping (non-fatal):', err)
    return
  }
  try {
    await fetch(downloadLocation, { headers: authHeader(), redirect: 'manual' })
  } catch (err) {
    console.warn('[unsplash] triggerDownload failed (non-fatal):', err)
  }
}
