import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally before importing the module under test.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { searchPhotos, getPhoto, triggerDownload, type UnsplashPhoto } from '../unsplash'

const PHOTO: UnsplashPhoto = {
  id: 'abc123',
  description: 'A mountain lake',
  alt_description: 'mountain lake at dusk',
  urls: { raw: 'https://images.unsplash.com/photo-raw', full: 'https://images.unsplash.com/photo-full', regular: 'https://images.unsplash.com/photo-regular', small: 'https://images.unsplash.com/photo-small', thumb: 'https://images.unsplash.com/photo-thumb' },
  links: { html: 'https://unsplash.com/photos/abc123', download: 'https://unsplash.com/photos/abc123/download', download_location: 'https://api.unsplash.com/photos/abc123/download' },
  user: { name: 'Jane Doe', username: 'janedoe', links: { html: 'https://unsplash.com/@janedoe' } },
  width: 4000, height: 3000, color: '#336699',
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function notOk(status: number, message = 'error') {
  return { ok: false, status, json: async () => ({ errors: [message] }) } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('searchPhotos', () => {
  it('calls the correct URL with Client-ID header and returns results', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(okJson({ results: [PHOTO] }))
    const results = await searchPhotos('mountain lake', 6)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/search/photos')
    expect(url).toContain('query=mountain+lake')
    expect(url).toContain('per_page=6')
    expect(url).toContain('content_filter=high')
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Client-ID test-key')
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('abc123')
  })

  it('returns empty array when results is empty', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(okJson({ results: [] }))
    const results = await searchPhotos('nothing', 6)
    expect(results).toHaveLength(0)
  })

  it('throws a typed error on non-2xx', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(notOk(401, 'Invalid token'))
    await expect(searchPhotos('x', 6)).rejects.toThrow(/401/)
  })
})

describe('getPhoto', () => {
  it('calls /photos/:id with auth and returns the photo', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(okJson(PHOTO))
    const photo = await getPhoto('abc123')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/photos/abc123')
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Client-ID test-key')
    expect(photo.id).toBe('abc123')
  })

  it('throws on 404', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(notOk(404, 'Photo not found'))
    await expect(getPhoto('bad-id')).rejects.toThrow(/404/)
  })
})

describe('triggerDownload', () => {
  it('calls the download_location URL with auth (best-effort, no return)', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockResolvedValueOnce(okJson({ url: 'https://images.unsplash.com/photo-dl' }))
    await expect(triggerDownload('https://api.unsplash.com/photos/abc123/download')).resolves.toBeUndefined()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.unsplash.com/photos/abc123/download')
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Client-ID test-key')
  })

  it('swallows errors (non-fatal)', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'test-key'
    mockFetch.mockRejectedValueOnce(new Error('network'))
    await expect(triggerDownload('https://api.unsplash.com/photos/x/download')).resolves.toBeUndefined()
  })
})
