import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the shared per-photo save helper so this tests ONLY the batch aggregation logic
// (savePhotoToMedia itself — including all SSRF/size guards — is covered by unsplash-add-tool.test.ts).
vi.mock('../unsplash-add-tool', () => ({
  savePhotoToMedia: vi.fn(),
}))

import { savePhotoToMedia as mockSave } from '../unsplash-add-tool'
import { addPhotosToMediaHandler } from '../unsplash-add-multi-tool'
import type { PayloadRequest } from 'payload'

const saved = (id: string) => ({
  ok: true as const,
  saved: { id, url: `/media/${id}.jpg`, alt: `alt ${id}`, credit: 'Jane', creditUrl: 'https://unsplash.com/@jane' },
})

function args(photos: Array<{ photoId: string; alt: string }>) {
  return {
    authorizedMCP: { overrideAccess: true, user: { id: 'u1' } },
    input: { photos },
    req: { payload: {} } as unknown as PayloadRequest,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('addPhotosToMediaHandler', () => {
  it('saves every photo and returns them in structuredContent.saved', async () => {
    ;(mockSave as ReturnType<typeof vi.fn>).mockResolvedValueOnce(saved('m1')).mockResolvedValueOnce(saved('m2'))
    const res = await addPhotosToMediaHandler(
      args([
        { photoId: 'a', alt: 'alt a' },
        { photoId: 'b', alt: 'alt b' },
      ]),
    )
    expect(mockSave).toHaveBeenCalledTimes(2)
    const sc = res.structuredContent as { saved: unknown[]; failed: unknown[] }
    expect(sc.saved).toHaveLength(2)
    expect(sc.failed).toHaveLength(0)
    expect(res.content[0].text).toContain('Saved 2 photos to Media')
    expect('isError' in res).toBe(false)
  })

  it('reports partial failures but still succeeds when at least one saved', async () => {
    ;(mockSave as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(saved('m1'))
      .mockResolvedValueOnce({ ok: false, error: 'Image fetch failed: HTTP 404' })
    const res = await addPhotosToMediaHandler(
      args([
        { photoId: 'a', alt: 'alt a' },
        { photoId: 'b', alt: 'alt b' },
      ]),
    )
    const sc = res.structuredContent as { saved: unknown[]; failed: Array<{ photoId: string; error: string }> }
    expect(sc.saved).toHaveLength(1)
    expect(sc.failed).toEqual([{ photoId: 'b', error: 'Image fetch failed: HTTP 404' }])
    expect(res.content[0].text).toContain('Saved 1 photo to Media')
    expect(res.content[0].text).toContain('1 failed')
    expect('isError' in res).toBe(false)
  })

  it('returns isError when every photo fails', async () => {
    ;(mockSave as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'Unsplash auth failed' })
    const res = await addPhotosToMediaHandler(args([{ photoId: 'a', alt: 'alt a' }]))
    const sc = res.structuredContent as { saved: unknown[] }
    expect(sc.saved).toHaveLength(0)
    expect((res as { isError?: boolean }).isError).toBe(true)
  })

  it('never prints embed code in the chat content', async () => {
    ;(mockSave as ReturnType<typeof vi.fn>).mockResolvedValueOnce(saved('m1'))
    const res = await addPhotosToMediaHandler(args([{ photoId: 'a', alt: 'alt a' }]))
    expect(res.content[0].text).not.toContain('![media:')
  })
})
