import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock 'ai' before any import of the tool to prevent live gateway calls (credits billed).
// vi.mock is hoisted to the top of the module by Vitest, so this runs before all imports.
vi.mock('ai', () => ({
  generateImage: vi.fn(),
  gateway: {
    imageModel: vi.fn().mockReturnValue({ modelId: 'mock-image-model' }),
  },
}))

// Static imports — resolved AFTER vi.mock hoist so they receive the mocked module.
// Do NOT use dynamic import() inside helpers: dynamic imports inside async functions
// can bypass the mock registry when the module is already cached from a prior import.
// The correct Vitest ESM mock pattern is: vi.mock() → static import → use in tests.
import { generateImage as mockGenerateImage } from 'ai'
import { generateImageHandler } from '../generate-image-tool'

// Fake Uint8Array for the image response
const FAKE_BYTES = new Uint8Array([137, 80, 78, 71]) // PNG magic bytes

const makeReq = (createResult: Record<string, unknown>) => ({
  payload: {
    create: vi.fn().mockResolvedValue(createResult),
  },
})

const makeAuthorizedMCP = () => ({
  overrideAccess: true,
  user: { id: 'u1', email: 'admin@example.com' },
})

// Helper: calls the statically-imported generateImageHandler directly.
// Using a static import (rather than dynamic import inside each call) ensures
// vi.mock hoist applies correctly and the same mocked 'ai' module is used throughout.
function callHandler(
  input: { prompt: string; alt: string; aspectRatio?: string },
  req: ReturnType<typeof makeReq>,
  authorizedMCP: ReturnType<typeof makeAuthorizedMCP>,
) {
  return generateImageHandler({
    input: input as { prompt: string; alt: string; aspectRatio: string },
    req: req as unknown as Parameters<typeof generateImageHandler>[0]['req'],
    authorizedMCP: authorizedMCP as unknown as Parameters<typeof generateImageHandler>[0]['authorizedMCP'],
  })
}

describe('generateImageHandler', () => {
  beforeEach(() => {
    vi.mocked(mockGenerateImage).mockResolvedValue({
      image: { uint8Array: FAKE_BYTES, base64: '', mediaType: 'image/png' },
      images: [],
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof mockGenerateImage>>)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns content text + structuredContent with id, url, alt', async () => {
    const req = makeReq({ id: 'media-1', url: '/media/hero.png', alt: 'A hero' })
    const result = await callHandler({ prompt: 'hero landscape', alt: 'A hero' }, req, makeAuthorizedMCP())

    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { type: string; text: string }).text).toContain('media-1')
    expect((result.content[0] as { type: string; text: string }).text).toContain('![media:media-1]()')
    expect(result.structuredContent).toMatchObject({ id: 'media-1', url: '/media/hero.png', alt: 'A hero' })
    // No doc field — it is stripped at the MCP wire layer; must not be relied upon
    expect((result as Record<string, unknown>)['doc']).toBeUndefined()
  })

  it('calls payload.create with correct file params', async () => {
    const req = makeReq({ id: 'media-2', url: '/media/hero-2.png', alt: 'test alt' })
    await callHandler({ prompt: 'ocean sunset', alt: 'test alt', aspectRatio: '16:9' }, req, makeAuthorizedMCP())

    expect(req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        data: { alt: 'test alt' },
        file: expect.objectContaining({
          data: expect.any(Buffer),
          mimetype: 'image/png',
          name: expect.stringMatching(/\.png$/),
          size: expect.any(Number),
        }),
        overrideAccess: true,
      }),
    )
  })

  it('derives mimetype and extension from model mediaType (I1)', async () => {
    // Simulate a model returning image/webp instead of image/png
    vi.mocked(mockGenerateImage).mockResolvedValueOnce({
      image: { uint8Array: FAKE_BYTES, base64: '', mediaType: 'image/webp' },
      images: [],
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof mockGenerateImage>>)

    const req = makeReq({ id: 'media-w', url: '/media/hero-w.webp', alt: 'webp alt' })
    await callHandler({ prompt: 'webp test', alt: 'webp alt' }, req, makeAuthorizedMCP())

    expect(req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          mimetype: 'image/webp',
          name: expect.stringMatching(/\.webp$/),
        }),
      }),
    )
  })

  it('falls back to image/png when mediaType is undefined (I1)', async () => {
    vi.mocked(mockGenerateImage).mockResolvedValueOnce({
      image: { uint8Array: FAKE_BYTES, base64: '', mediaType: undefined },
      images: [],
      warnings: [],
    } as unknown as Awaited<ReturnType<typeof mockGenerateImage>>)

    const req = makeReq({ id: 'media-fb', url: '/media/hero-fb.png', alt: 'fallback alt' })
    await callHandler({ prompt: 'fallback test', alt: 'fallback alt' }, req, makeAuthorizedMCP())

    expect(req.payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          mimetype: 'image/png',
          name: expect.stringMatching(/\.png$/),
        }),
      }),
    )
  })

  it('calls generateImage with the correct model and aspectRatio', async () => {
    const req = makeReq({ id: 'm1', url: '/media/x.png', alt: 'alt' })
    await callHandler({ prompt: 'test', alt: 'alt', aspectRatio: '1:1' }, req, makeAuthorizedMCP())

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'test',
        aspectRatio: '1:1',
        n: 1,
      }),
    )
  })

  it('uses default aspectRatio 16:9 when not specified', async () => {
    const req = makeReq({ id: 'm2', url: '/media/y.png', alt: 'alt' })
    await callHandler({ prompt: 'test', alt: 'alt' }, req, makeAuthorizedMCP())

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: '16:9' }),
    )
  })

  it('throws when payload.create returns url null (serverURL not configured)', async () => {
    const req = makeReq({ id: 'm3', url: null, alt: 'alt' })
    await expect(
      callHandler({ prompt: 'test', alt: 'alt' }, req, makeAuthorizedMCP()),
    ).rejects.toThrow(/URL is unavailable/)
  })

  it('uses EVE_IMAGE_MODEL env var when set', async () => {
    // gateway is already the statically-imported mock (vi.mock hoist applied at module level).
    // Import it statically at the top of the describe block to reuse the same mock reference.
    const { gateway } = await import('ai') // safe: same cached mock module, not a re-import
    process.env.EVE_IMAGE_MODEL = 'xai/grok-imagine-image'
    const req = makeReq({ id: 'm4', url: '/media/z.png', alt: 'alt' })
    await callHandler({ prompt: 'test', alt: 'alt' }, req, makeAuthorizedMCP())
    expect(gateway.imageModel).toHaveBeenCalledWith('xai/grok-imagine-image')
    delete process.env.EVE_IMAGE_MODEL
  })
})
