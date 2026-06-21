import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../unsplash', () => ({
  getPhoto: vi.fn(),
  triggerDownload: vi.fn(),
  assertUnsplashUrl: vi.fn(),
}))

import { assertUnsplashUrl as mockAssertUnsplashUrl, getPhoto as mockGetPhoto, triggerDownload as mockTriggerDownload } from '../unsplash'
import { savePhotoToMedia } from '../unsplash-add-tool'
import type { PayloadRequest } from 'payload'

const PHOTO = {
  id: 'abc123',
  description: 'A mountain lake',
  alt_description: 'mountain lake at dusk',
  urls: { raw: '', full: '', regular: 'https://images.unsplash.com/photo-regular', small: '', thumb: '' },
  links: { html: 'https://unsplash.com/photos/abc123', download: '', download_location: 'https://api.unsplash.com/photos/abc123/download' },
  user: { name: 'Jane Doe', username: 'janedoe', links: { html: 'https://unsplash.com/@janedoe' } },
  width: 4000, height: 3000, color: '#336699',
}

const FAKE_IMAGE = Buffer.from([0xff, 0xd8, 0xff]) // JPEG magic bytes

function makeReq(createResult: Record<string, unknown> = { id: 'media-1', url: '/media/unsplash-abc123.jpg', alt: 'mountain lake' }) {
  return { payload: { create: vi.fn().mockResolvedValue(createResult) } } as unknown as PayloadRequest
}

function makeImageFetch(contentType = 'image/jpeg') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => k === 'content-type' ? contentType : null },
    arrayBuffer: async () => FAKE_IMAGE.buffer,
  })
}

function makeArgs(overrides: Record<string, unknown> = {}, req?: PayloadRequest) {
  return {
    authorizedMCP: { overrideAccess: true, user: { id: 'u1' } },
    photoId: 'abc123',
    alt: 'mountain lake',
    req: req ?? makeReq(),
    ...overrides,
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('savePhotoToMedia', () => {
  it('fetches the photo, triggers download, saves to Media, returns the saved doc', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    const mockImageFetch = makeImageFetch()
    vi.stubGlobal('fetch', mockImageFetch)
    const req = makeReq({ id: 'media-1', url: '/media/unsplash-abc123.jpg', alt: 'mountain lake' })
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(mockGetPhoto).toHaveBeenCalledWith('abc123')
    expect(mockTriggerDownload).toHaveBeenCalledWith('https://api.unsplash.com/photos/abc123/download')
    expect(mockImageFetch).toHaveBeenCalledWith(
      'https://images.unsplash.com/photo-regular',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(req.payload.create).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'media',
      data: expect.objectContaining({ alt: 'mountain lake', credit: 'Jane Doe' }),
      file: expect.objectContaining({
        data: expect.any(Buffer),
        mimetype: 'image/jpeg',
        name: expect.stringMatching(/^unsplash-abc123\.(jpg|jpeg)$/),
        size: expect.any(Number),
      }),
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.saved).toMatchObject({
      id: 'media-1',
      url: '/media/unsplash-abc123.jpg',
      alt: 'mountain lake',
      credit: 'Jane Doe',
      creditUrl: expect.stringContaining('utm_source=payload-eve-chat'),
    })
    vi.unstubAllGlobals()
  })

  it('rejects non-Unsplash image URLs (SSRF guard)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce({
      ...PHOTO,
      urls: { ...PHOTO.urls, regular: 'https://evil.example.com/steal.jpg' },
    })
    vi.mocked(mockAssertUnsplashUrl).mockImplementation(() => { throw new Error('Refusing non-Unsplash URL') })
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toContain('SSRF')
    expect(mockTriggerDownload).not.toHaveBeenCalled()
    expect(req.payload.create).not.toHaveBeenCalled()
  })

  it('fails when fetch resolves with a non-ok status (e.g. 403)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockAssertUnsplashUrl).mockReturnValue(undefined as never)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toContain('HTTP 403')
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('refuses redirects (SSRF redirect bypass): fetch 302 fails and does not call payload.create', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockAssertUnsplashUrl).mockReturnValue(undefined as never)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    const mockImageFetch = vi.fn().mockResolvedValue({ ok: false, status: 302 })
    vi.stubGlobal('fetch', mockImageFetch)
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    expect(mockImageFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('rejects oversize images (> 10 MB)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k: string) => k === 'content-type' ? 'image/jpeg' : null },
      arrayBuffer: async () => bigBuffer.buffer,
    }))
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toContain('too large')
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('rejects non-image content-type', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    vi.stubGlobal('fetch', makeImageFetch('text/html'))
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toContain('image')
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('surfaces Unsplash auth error when getPhoto throws 401', async () => {
    vi.mocked(mockGetPhoto).mockRejectedValueOnce(Object.assign(new Error('Unsplash error 401'), { status: 401 }))
    const req = makeReq()
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toContain('auth')
  })

  it('proceeds even when triggerDownload throws (non-fatal)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockRejectedValueOnce(new Error('network'))
    const mockImageFetch = makeImageFetch()
    vi.stubGlobal('fetch', mockImageFetch)
    const req = makeReq({ id: 'media-2', url: '/media/unsplash-abc123.jpg', alt: 'alt' })
    const result = await savePhotoToMedia(makeArgs({}, req))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.saved.id).toBe('media-2')
    vi.unstubAllGlobals()
  })
})
