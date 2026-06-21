import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the unsplash client module before importing the handler.
vi.mock('../unsplash', () => ({
  searchPhotos: vi.fn(),
}))

import { searchPhotos as mockSearchPhotos } from '../unsplash'
import { searchPhotosHandler } from '../unsplash-search-tool'
import type { PayloadRequest } from 'payload'

const PHOTO = {
  id: 'abc123',
  description: 'A mountain lake',
  alt_description: 'mountain lake at dusk',
  urls: { raw: '', full: '', regular: '', small: '', thumb: 'https://images.unsplash.com/photo-thumb' },
  links: { html: 'https://unsplash.com/photos/abc123', download: '', download_location: '' },
  user: { name: 'Jane Doe', username: 'janedoe', links: { html: 'https://unsplash.com/@janedoe' } },
  width: 4000, height: 3000, color: '#336699',
}

function makeArgs(inputOverrides: Record<string, unknown> = {}) {
  return {
    authorizedMCP: { overrideAccess: true, user: { id: 'u1' } },
    input: { query: 'mountain lake', ...inputOverrides },
    req: {} as PayloadRequest,
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('searchPhotosHandler', () => {
  it('maps photo results into structuredContent.photos with correct fields', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([PHOTO])
    const result = await searchPhotosHandler(makeArgs())
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('1')
    expect(result.content[0].text).toContain('mountain lake')
    expect(result.structuredContent.photos).toHaveLength(1)
    const p = result.structuredContent.photos[0]!
    expect(p.photoId).toBe('abc123')
    expect(p.description).toBe('mountain lake at dusk')
    expect(p.thumbUrl).toBe('https://images.unsplash.com/photo-thumb')
    expect(p.photographer).toBe('Jane Doe')
    expect(p.photographerUrl).toContain('https://unsplash.com/@janedoe')
    expect(p.photographerUrl).toContain('utm_source=payload-eve-chat')
    expect(p.photographerUrl).toContain('utm_medium=referral')
    expect(p.unsplashUrl).toBe('https://unsplash.com/photos/abc123')
  })

  it('falls back to description when alt_description is null', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([{ ...PHOTO, alt_description: null, description: 'A lake' }])
    const result = await searchPhotosHandler(makeArgs())
    expect(result.structuredContent.photos[0]!.description).toBe('A lake')
  })

  it('falls back to "Untitled" when both description fields are null', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([{ ...PHOTO, alt_description: null, description: null }])
    const result = await searchPhotosHandler(makeArgs())
    expect(result.structuredContent.photos[0]!.description).toBe('Untitled')
  })

  it('returns empty photos array and a message when no results', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([])
    const result = await searchPhotosHandler(makeArgs())
    expect(result.structuredContent.photos).toHaveLength(0)
    expect(result.content[0].text).toContain('0')
  })

  it('passes perPage to the client (default 6)', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([])
    await searchPhotosHandler(makeArgs())
    expect(mockSearchPhotos).toHaveBeenCalledWith('mountain lake', 6)
  })

  it('passes custom perPage when provided', async () => {
    vi.mocked(mockSearchPhotos).mockResolvedValueOnce([])
    await searchPhotosHandler(makeArgs({ perPage: 9 }))
    expect(mockSearchPhotos).toHaveBeenCalledWith('mountain lake', 9)
  })

  it('surfaces Unsplash auth error message when client throws', async () => {
    vi.mocked(mockSearchPhotos).mockRejectedValueOnce(Object.assign(new Error('Unsplash error 401: Invalid token'), { status: 401 }))
    const result = await searchPhotosHandler(makeArgs())
    expect(result.content[0].text).toContain('auth')
    expect((result as unknown as { isError?: boolean }).isError).toBe(true)
  })

  it('surfaces rate-limit message on 429', async () => {
    vi.mocked(mockSearchPhotos).mockRejectedValueOnce(Object.assign(new Error('Unsplash error 429: Rate limited'), { status: 429 }))
    const result = await searchPhotosHandler(makeArgs())
    expect(result.content[0].text).toContain('rate limit')
    expect((result as unknown as { isError?: boolean }).isError).toBe(true)
  })
})
