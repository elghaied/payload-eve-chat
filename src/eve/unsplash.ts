const BASE = 'https://api.unsplash.com'

function authHeader(): Record<string, string> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set')
  return { Authorization: `Client-ID ${key}` }
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
  return apiGet<UnsplashPhoto>(`/photos/${id}`)
}

export async function triggerDownload(downloadLocation: string): Promise<void> {
  try {
    await fetch(downloadLocation, { headers: authHeader() })
  } catch (err) {
    console.warn('[unsplash] triggerDownload failed (non-fatal):', err)
  }
}
