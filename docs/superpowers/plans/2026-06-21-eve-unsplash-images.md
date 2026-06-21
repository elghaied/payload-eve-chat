# Unsplash Photo Search → Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add two Payload-side MCP tools (`searchPhotos`, `addPhotoToMedia`) so Eve can search Unsplash, preview photo candidates in chat as a thumbnail grid, then upload a chosen photo into the Media collection (with photographer attribution) — a real-photo alternative to `generateImage`.

**Architecture:** Two new tool files in `src/eve/` mirror the `generate-image-tool.ts` pattern: `defineTool({ description, input: zod }).handler(fn as never)` from `@payloadcms/plugin-mcp`; bare handler exported for unit testing. A thin `src/eve/unsplash.ts` client wraps the Unsplash REST API and is mocked in every test. Tools return `structuredContent` (not `doc`) so data survives `finalizeToolResponse`. Registration is env-gated in `src/payload.config.ts`. Chat rendering extends `toolResult.ts` / `ToolResultCard.tsx` with a `photo_search` view and a credited `media_image`.

**Tech Stack:** TypeScript, Vitest (jsdom, no jest-dom), @testing-library/react, Zod, @payloadcms/plugin-mcp `defineTool`, native `fetch`, Payload `payload.create`, Lucide icons, Tailwind CSS. No new production dependencies.

## Global Constraints

- Unsplash auth: `Authorization: Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` (Access Key only — NOT secret key or application id)
- Return channel: `structuredContent` not `doc` — `doc` is stripped by `finalizeToolResponse`
- Env-gating: tools only registered when `process.env.UNSPLASH_ACCESS_KEY` is truthy
- UTM suffix appended to all photographer/photo links wherever displayed: `?utm_source=payload-eve-chat&utm_medium=referral`
- No new production dependencies unless truly unavoidable
- SSRF guard: in `addPhotoToMedia`, assert fetched image URL host ends with `.unsplash.com` before fetching
- Test commands: `pnpm run test:int` (unit); `pnpm exec tsc --noEmit` (types); `node_modules/.bin/eve info` (after agent/ edits); no live Unsplash calls in unit tests

---

### Task 1: `src/eve/unsplash.ts` — Unsplash HTTP client

**Files:**
- Create `src/eve/unsplash.ts`
- Create `src/eve/__tests__/unsplash.test.ts`

**Interfaces:**
Consumes: `process.env.UNSPLASH_ACCESS_KEY` (string), native `fetch`.
Produces:
```ts
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
export async function searchPhotos(query: string, perPage: number): Promise<UnsplashPhoto[]>
export async function getPhoto(id: string): Promise<UnsplashPhoto>
export async function triggerDownload(downloadLocation: string): Promise<void>
```

- [ ] **Failing test** — create `src/eve/__tests__/unsplash.test.ts`:

```ts
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

beforeEach(() => { vi.clearAllMocks() })
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
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/eve/__tests__/unsplash.test.ts`

- [ ] **Implement** — create `src/eve/unsplash.ts`:

```ts
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
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/eve/__tests__/unsplash.test.ts`

- [ ] **Commit:** `git add src/eve/unsplash.ts src/eve/__tests__/unsplash.test.ts && git commit -m "feat(eve): add Unsplash HTTP client with searchPhotos / getPhoto / triggerDownload"`

---

### Task 2: Add `credit` + `creditUrl` fields to Media collection

**Files:**
- Modify `src/collections/Media.ts`

**Interfaces:**
Consumes: existing `CollectionConfig` shape.
Produces: Media collection with two additional optional text fields — `credit` (photographer name) and `creditUrl` (photographer Unsplash profile URL with UTM).

- [ ] **Failing test** — add to `src/eve/__tests__/payload-config-mcp.test.ts`:

```ts
import { readFileSync } from 'fs'
import { resolve } from 'path'

const mediaSource = readFileSync(resolve(process.cwd(), 'src/collections/Media.ts'), 'utf-8')

describe('Media collection credit fields', () => {
  it('has an optional credit text field', () => {
    expect(mediaSource).toContain("name: 'credit'")
    expect(mediaSource).toContain("type: 'text'")
  })
  it('has an optional creditUrl text field', () => {
    expect(mediaSource).toContain("name: 'creditUrl'")
  })
  it('credit and creditUrl are not required', () => {
    // Neither field should have required:true
    const creditIdx = mediaSource.indexOf("name: 'credit'")
    const creditBlock = mediaSource.slice(creditIdx, creditIdx + 120)
    expect(creditBlock).not.toContain('required: true')
  })
})
```

(Add these `describe` blocks inside the existing test file after the existing `describe` blocks.)

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/eve/__tests__/payload-config-mcp.test.ts`

- [ ] **Implement** — edit `src/collections/Media.ts`:

```ts
import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'credit',
      type: 'text',
    },
    {
      name: 'creditUrl',
      type: 'text',
    },
  ],
  upload: true,
  // v4 enables versions by default; media uploads don't need version history.
  versions: false,
}
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/eve/__tests__/payload-config-mcp.test.ts`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/collections/Media.ts src/eve/__tests__/payload-config-mcp.test.ts && git commit -m "feat(media): add optional credit + creditUrl text fields for Unsplash attribution"`

---

### Task 3: `src/eve/unsplash-search-tool.ts` — `searchPhotos` MCP tool

**Files:**
- Create `src/eve/unsplash-search-tool.ts`
- Create `src/eve/__tests__/unsplash-search-tool.test.ts`

**Interfaces:**
Consumes: `searchPhotos` from `./unsplash`; `defineTool` from `@payloadcms/plugin-mcp`; `z` from `zod`.
Tool input: `{ query: string (1..200), perPage?: number (1..12, default 6) }`
Tool output:
```ts
{
  content: [{ type: 'text', text: `Found N Unsplash photos for "<query>".` }],
  structuredContent: {
    photos: Array<{
      photoId: string
      description: string
      thumbUrl: string
      photographer: string
      photographerUrl: string  // user.links.html + UTM pre-baked by handler (not appended in the card)
      unsplashUrl: string      // links.html
    }>
  }
}
```

Handler signature (mirrors `generateImageHandler`):
```ts
export async function searchPhotosHandler({
  authorizedMCP,
  input,
  req,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { query: string; perPage?: number }
  req: PayloadRequest
}): Promise<{ content: [{type:'text';text:string}]; structuredContent: { photos: PhotoCandidate[] } }>
```

- [ ] **Failing test** — create `src/eve/__tests__/unsplash-search-tool.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/eve/__tests__/unsplash-search-tool.test.ts`

- [ ] **Implement** — create `src/eve/unsplash-search-tool.ts`:

```ts
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
 * No image download or Media write occurs here — call addPhotoToMedia to save a chosen photo.
 */
export const searchPhotosTool = defineTool({
  description:
    'Search Unsplash for real photos matching a query. Returns up to 12 thumbnail candidates ' +
    '(photoId, thumbUrl, photographer, description, photographerUrl, unsplashUrl) via structuredContent. ' +
    'No image is downloaded or stored at this step. After the user picks a photo, call addPhotoToMedia ' +
    'to upload it to the Media collection and get an embed id. Only call when a real photograph is requested.',
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
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/eve/__tests__/unsplash-search-tool.test.ts`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/eve/unsplash-search-tool.ts src/eve/__tests__/unsplash-search-tool.test.ts && git commit -m "feat(eve): add searchPhotos MCP tool — Unsplash photo search → structuredContent grid"`

---

### Task 4: `src/eve/unsplash-add-tool.ts` — `addPhotoToMedia` MCP tool

**Files:**
- Create `src/eve/unsplash-add-tool.ts`
- Create `src/eve/__tests__/unsplash-add-tool.test.ts`

**Interfaces:**
Consumes: `getPhoto`, `triggerDownload` from `./unsplash`; `req.payload.create`; native `fetch` (image bytes).
Tool input: `{ photoId: string, alt: string (1..500) }`
Tool output:
```ts
{
  content: [{ type: 'text', text: `Saved photo by <name> to Media (id: <id>). Embed: ![media:<id>]() and credit the photographer.` }],
  structuredContent: { id: string|number, url: string, alt: string, credit: string, creditUrl: string }
}
```
Handler signature:
```ts
export async function addPhotoToMediaHandler({
  authorizedMCP,
  input,
  req,
}: {
  authorizedMCP: { overrideAccess: boolean; user: unknown }
  input: { photoId: string; alt: string }
  req: PayloadRequest
})
```

SSRF guard: reject any image URL whose hostname does not end with `.unsplash.com`.
Size guard: reject buffers > 10 MB (`10 * 1024 * 1024` bytes).
Content-type guard: reject if `Content-Type` does not start with `image/`.
`triggerDownload` failure is non-fatal (swallowed).

- [ ] **Failing test** — create `src/eve/__tests__/unsplash-add-tool.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../unsplash', () => ({
  getPhoto: vi.fn(),
  triggerDownload: vi.fn(),
}))

import { getPhoto as mockGetPhoto, triggerDownload as mockTriggerDownload } from '../unsplash'
import { addPhotoToMediaHandler } from '../unsplash-add-tool'
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

function makeArgs(inputOverrides: Record<string, unknown> = {}, req?: PayloadRequest) {
  return {
    authorizedMCP: { overrideAccess: true, user: { id: 'u1' } },
    input: { photoId: 'abc123', alt: 'mountain lake', ...inputOverrides },
    req: req ?? makeReq(),
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('addPhotoToMediaHandler', () => {
  it('fetches the photo, triggers download, saves to Media, returns structuredContent', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    const mockImageFetch = makeImageFetch()
    vi.stubGlobal('fetch', mockImageFetch)
    const req = makeReq({ id: 'media-1', url: '/media/unsplash-abc123.jpg', alt: 'mountain lake' })
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(mockGetPhoto).toHaveBeenCalledWith('abc123')
    expect(mockTriggerDownload).toHaveBeenCalledWith('https://api.unsplash.com/photos/abc123/download')
    expect(mockImageFetch).toHaveBeenCalledWith('https://images.unsplash.com/photo-regular')
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
    expect(result.structuredContent).toMatchObject({
      id: 'media-1',
      url: '/media/unsplash-abc123.jpg',
      alt: 'mountain lake',
      credit: 'Jane Doe',
      creditUrl: expect.stringContaining('utm_source=payload-eve-chat'),
    })
    expect(result.content[0].text).toContain('media-1')
    expect(result.content[0].text).toContain('Jane Doe')
    vi.unstubAllGlobals()
  })

  it('rejects non-Unsplash image URLs (SSRF guard)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce({
      ...PHOTO,
      urls: { ...PHOTO.urls, regular: 'https://evil.example.com/steal.jpg' },
    })
    const req = makeReq()
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('SSRF')
    expect(req.payload.create).not.toHaveBeenCalled()
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
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('too large')
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('rejects non-image content-type', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockResolvedValueOnce(undefined)
    vi.stubGlobal('fetch', makeImageFetch('text/html'))
    const req = makeReq()
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('image')
    expect(req.payload.create).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('surfaces Unsplash auth error when getPhoto throws 401', async () => {
    vi.mocked(mockGetPhoto).mockRejectedValueOnce(Object.assign(new Error('Unsplash error 401'), { status: 401 }))
    const req = makeReq()
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('auth')
  })

  it('proceeds even when triggerDownload throws (non-fatal)', async () => {
    vi.mocked(mockGetPhoto).mockResolvedValueOnce(PHOTO)
    vi.mocked(mockTriggerDownload).mockRejectedValueOnce(new Error('network'))
    const mockImageFetch = makeImageFetch()
    vi.stubGlobal('fetch', mockImageFetch)
    const req = makeReq({ id: 'media-2', url: '/media/unsplash-abc123.jpg', alt: 'alt' })
    const result = await addPhotoToMediaHandler(makeArgs({}, req))
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.id).toBe('media-2')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/eve/__tests__/unsplash-add-tool.test.ts`

- [ ] **Implement** — create `src/eve/unsplash-add-tool.ts`:

```ts
import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { getPhoto, triggerDownload } from './unsplash'

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

  // 2. Trigger the Unsplash download event (ToS requirement, best-effort).
  try {
    await triggerDownload(photo.links.download_location)
  } catch (err) {
    console.warn('[unsplash] triggerDownload failed (non-fatal):', err)
  }

  // 3. SSRF guard: image URL must be on *.unsplash.com.
  const imageUrl = photo.urls.regular
  let imageHost: string
  try {
    imageHost = new URL(imageUrl).hostname
  } catch {
    return { content: [{ type: 'text' as const, text: 'Invalid image URL from Unsplash.' }], structuredContent: {} as never, isError: true as const }
  }
  if (!imageHost.endsWith('.unsplash.com')) {
    return { content: [{ type: 'text' as const, text: `SSRF guard: image URL host "${imageHost}" is not an Unsplash domain.` }], structuredContent: {} as never, isError: true as const }
  }

  // 4. Fetch the image bytes.
  let imageRes: Response
  try {
    imageRes = await fetch(imageUrl)
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Failed to fetch image: ${err instanceof Error ? err.message : String(err)}` }], structuredContent: {} as never, isError: true as const }
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
    throw new Error('Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts')
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
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/eve/__tests__/unsplash-add-tool.test.ts`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/eve/unsplash-add-tool.ts src/eve/__tests__/unsplash-add-tool.test.ts && git commit -m "feat(eve): add addPhotoToMedia MCP tool — Unsplash photo → Payload Media with attribution"`

---

### Task 5: Register tools in `src/payload.config.ts` (env-gated)

**Files:**
- Modify `src/payload.config.ts`
- Modify `src/eve/__tests__/payload-config-mcp.test.ts` (extend existing test file)

**Interfaces:**
Consumes: `searchPhotosTool` from `./eve/unsplash-search-tool`, `addPhotoToMediaTool` from `./eve/unsplash-add-tool`.
Produces: `mcpPlugin({ tools: { ...existing, ...(UNSPLASH_ACCESS_KEY ? { searchPhotos: ..., addPhotoToMedia: ... } : {}) } })`.

- [ ] **Failing test** — add to `src/eve/__tests__/payload-config-mcp.test.ts`:

```ts
describe('payload.config.ts Unsplash tool registration', () => {
  it('imports searchPhotosTool from unsplash-search-tool', () => {
    expect(configSource).toContain("from './eve/unsplash-search-tool'")
    expect(configSource).toContain('searchPhotosTool')
  })

  it('imports addPhotoToMediaTool from unsplash-add-tool', () => {
    expect(configSource).toContain("from './eve/unsplash-add-tool'")
    expect(configSource).toContain('addPhotoToMediaTool')
  })

  it('registers searchPhotos and addPhotoToMedia gated on UNSPLASH_ACCESS_KEY', () => {
    expect(configSource).toContain('UNSPLASH_ACCESS_KEY')
    expect(configSource).toContain('searchPhotos: searchPhotosTool')
    expect(configSource).toContain('addPhotoToMedia: addPhotoToMediaTool')
  })
})
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/eve/__tests__/payload-config-mcp.test.ts`

- [ ] **Implement** — edit `src/payload.config.ts` to add after the existing tool imports:

```ts
import { searchPhotosTool } from './eve/unsplash-search-tool'
import { addPhotoToMediaTool } from './eve/unsplash-add-tool'
```

And replace the `tools:` block inside `mcpPlugin`:

```ts
      tools: {
        createDocumentFromMarkdown: createDocumentFromMarkdownTool,
        generateImage: generateImageTool,
        ...(process.env.UNSPLASH_ACCESS_KEY
          ? { searchPhotos: searchPhotosTool, addPhotoToMedia: addPhotoToMediaTool }
          : {}),
      },
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/eve/__tests__/payload-config-mcp.test.ts`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/payload.config.ts src/eve/__tests__/payload-config-mcp.test.ts && git commit -m "feat(config): register searchPhotos + addPhotoToMedia MCP tools gated on UNSPLASH_ACCESS_KEY"`

---

### Task 6: `toolResult.ts` — `photo_search` view + extended `media_image`

**Files:**
- Modify `src/components/eve/toolResult.ts`
- Modify `src/components/eve/toolResult.test.ts` (extend existing)

**Interfaces:**
Consumes: `describeToolResult`, `runningLabel`, `ToolResultView` from `toolResult.ts`.
Produces extended types:
```ts
// New view kind.
// NOTE: 'query' is an extension over the spec's type definition (spec has only 'photos');
// it is sourced from part.input['query'] (defaulting to '' when absent) and used by
// ToolResultCard for the header and empty-results message. It is backward-compatible.
| { kind: 'photo_search'; query: string; photos: PhotoCandidate[] }

// Extended media_image (credit + creditUrl are optional; generateImage path has neither)
| { kind: 'media_image'; id: string; url: string; alt: string; credit?: string; creditUrl?: string }
```
Where `PhotoCandidate` matches the `structuredContent.photos[]` shape from Task 3.

- [ ] **Failing test** — add to `src/components/eve/toolResult.test.ts`:

```ts
describe('describeToolResult — searchPhotos', () => {
  it('parses a searchPhotos result into photo_search view', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__searchPhotos',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__searchPhotos' } },
        input: { query: 'mountain lake', perPage: 6 },
        output: {
          content: [{ type: 'text', text: 'Found 2 Unsplash photos for "mountain lake".' }],
          structuredContent: {
            photos: [
              { photoId: 'abc', description: 'lake at dusk', thumbUrl: 'https://images.unsplash.com/thumb1', photographer: 'Jane', photographerUrl: 'https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/abc' },
              { photoId: 'def', description: 'misty peaks', thumbUrl: 'https://images.unsplash.com/thumb2', photographer: 'Bob', photographerUrl: 'https://unsplash.com/@bob?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/def' },
            ],
          },
        },
      }),
    )
    expect(v?.kind).toBe('photo_search')
    if (v?.kind === 'photo_search') {
      expect(v.photos).toHaveLength(2)
      expect(v.photos[0]!.photoId).toBe('abc')
      expect(v.photos[1]!.photographer).toBe('Bob')
      expect(v.query).toBe('mountain lake')
    }
  })

  it('returns photo_search with empty photos array when results is empty', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'searchPhotos',
        input: { query: 'nothing found' },
        output: {
          content: [{ type: 'text', text: 'Found 0 Unsplash photos for "nothing found".' }],
          structuredContent: { photos: [] },
        },
      }),
    )
    expect(v?.kind).toBe('photo_search')
    if (v?.kind === 'photo_search') {
      expect(v.photos).toHaveLength(0)
    }
  })

  // Extension test: 'query' defaults to '' when part.input does not contain a string query.
  // This covers the case where a consumer omits query or passes a non-string value.
  it('returns photo_search with query="" when input.query is absent', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'searchPhotos',
        input: {},  // no query field
        output: {
          content: [{ type: 'text', text: 'Found 0.' }],
          structuredContent: { photos: [] },
        },
      }),
    )
    expect(v?.kind).toBe('photo_search')
    if (v?.kind === 'photo_search') {
      expect(v.query).toBe('')
      expect(v.photos).toHaveLength(0)
    }
  })
})

describe('describeToolResult — addPhotoToMedia / media_image with credit', () => {
  it('parses addPhotoToMedia result into media_image with credit and creditUrl', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__addPhotoToMedia',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__addPhotoToMedia' } },
        input: { photoId: 'abc', alt: 'mountain lake' },
        output: {
          content: [{ type: 'text', text: 'Saved photo by Jane Doe to Media (id: media-1).' }],
          structuredContent: { id: 'media-1', url: '/media/unsplash-abc.jpg', alt: 'mountain lake', credit: 'Jane Doe', creditUrl: 'https://unsplash.com/@janedoe?utm_source=payload-eve-chat&utm_medium=referral' },
        },
      }),
    )
    expect(v?.kind).toBe('media_image')
    if (v?.kind === 'media_image') {
      expect(v.id).toBe('media-1')
      expect(v.url).toBe('/media/unsplash-abc.jpg')
      expect(v.alt).toBe('mountain lake')
      expect(v.credit).toBe('Jane Doe')
      expect(v.creditUrl).toContain('utm_source=payload-eve-chat')
    }
  })

  it('media_image from generateImage has no credit/creditUrl (backward-compat)', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'generateImage',
        input: { prompt: 'hero', alt: 'hero image' },
        output: { content: [{ type: 'text', text: 'done' }], structuredContent: { id: 'img-1', url: '/media/hero.png', alt: 'hero image' } },
      }),
    )
    expect(v?.kind).toBe('media_image')
    if (v?.kind === 'media_image') {
      expect(v.credit).toBeUndefined()
      expect(v.creditUrl).toBeUndefined()
    }
  })
})

describe('runningLabel — Unsplash tools', () => {
  it('shows "Searching Unsplash…" for searchPhotos', () => {
    const label = runningLabel(part({ state: 'input-available', toolName: 'searchPhotos', input: { query: 'cats' } }))
    expect(label).toBe('Searching Unsplash…')
  })

  it('shows "Saving photo to Media…" for addPhotoToMedia', () => {
    const label = runningLabel(part({ state: 'input-available', toolName: 'addPhotoToMedia', input: { photoId: 'abc', alt: 'x' } }))
    expect(label).toBe('Saving photo to Media…')
  })
})
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/components/eve/toolResult.test.ts`

- [ ] **Implement** — edit `src/components/eve/toolResult.ts`:

1. Add `PhotoCandidate` type (import or inline — inline to avoid cross-package boundary):

```ts
export type PhotoCandidate = {
  photoId: string
  description: string
  thumbUrl: string
  photographer: string
  photographerUrl: string
  unsplashUrl: string
}
```

2. Extend `ToolResultView` union — replace the `media_image` line and add `photo_search`:

```ts
  | { kind: 'media_image'; id: string; url: string; alt: string; credit?: string; creditUrl?: string }
  | { kind: 'photo_search'; query: string; photos: PhotoCandidate[] }
```

3. Add detection for `searchPhotos` **before** the generic `generateImage` block (inside `describeToolResult`):

```ts
  // searchPhotos — Unsplash photo search. Returns structuredContent.photos[].
  if (name === 'searchPhotos' && isObj(output)) {
    const sc = output['structuredContent']
    if (isObj(sc) && Array.isArray(sc['photos'])) {
      const photos = (sc['photos'] as unknown[]).filter(isObj).map((p) => ({
        photoId: typeof p['photoId'] === 'string' ? (p['photoId'] as string) : '',
        description: typeof p['description'] === 'string' ? (p['description'] as string) : '',
        thumbUrl: typeof p['thumbUrl'] === 'string' ? (p['thumbUrl'] as string) : '',
        photographer: typeof p['photographer'] === 'string' ? (p['photographer'] as string) : '',
        photographerUrl: typeof p['photographerUrl'] === 'string' ? (p['photographerUrl'] as string) : '',
        unsplashUrl: typeof p['unsplashUrl'] === 'string' ? (p['unsplashUrl'] as string) : '',
      }))
      const queryInput = isObj(part.input) && typeof part.input['query'] === 'string' ? (part.input['query'] as string) : ''
      return { kind: 'photo_search', query: queryInput, photos }
    }
  }
```

4. Extend the `generateImage` block to also handle `addPhotoToMedia` and pass `credit`/`creditUrl`:

```ts
  // generateImage / addPhotoToMedia — structuredContent has id + url.
  if ((name === 'generateImage' || name === 'addPhotoToMedia') && isObj(output)) {
    const sc = output['structuredContent']
    if (isObj(sc) && typeof sc['url'] === 'string' && typeof sc['id'] !== 'undefined') {
      return {
        kind: 'media_image',
        id: String(sc['id']),
        url: sc['url'] as string,
        alt: typeof sc['alt'] === 'string' ? (sc['alt'] as string) : '',
        credit: typeof sc['credit'] === 'string' ? (sc['credit'] as string) : undefined,
        creditUrl: typeof sc['creditUrl'] === 'string' ? (sc['creditUrl'] as string) : undefined,
      }
    }
    const text = mcpText(output)
    if (text) return { kind: 'text', text }
  }
```

5. Add `runningLabel` cases (insert after the `generateImage` case):

```ts
  if (name === 'searchPhotos') return 'Searching Unsplash…'
  if (name === 'addPhotoToMedia') return 'Saving photo to Media…'
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/components/eve/toolResult.test.ts`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/components/eve/toolResult.ts src/components/eve/toolResult.test.ts && git commit -m "feat(ui): add photo_search view + extend media_image with optional credit/creditUrl in toolResult"`

---

### Task 7: `ToolResultCard.tsx` — photo grid + credit line

**Files:**
- Modify `src/components/eve/ToolResultCard.tsx`
- Modify `src/components/eve/ToolResultCard.test.tsx` (extend existing)

**Interfaces:**
Consumes: extended `ToolResultView` (with `photo_search` and `media_image` with optional credit).
Produces: a rendered thumbnail grid for `photo_search` (each card: `<img src={thumbUrl}>`, description, "by <photographer>" link with UTM) and a credit line below the image on `media_image` when `credit` is present.

`photo_search` card: thumbnail images hotlink `images.unsplash.com` (allowed per Unsplash ToS for search previews). UTM is pre-baked into `photographerUrl` by the handler (Task 3); the card renders `photographerUrl` as-is — do NOT append UTM again.

- [ ] **Failing test** — add to `src/components/eve/ToolResultCard.test.tsx`:

```ts
describe('ToolResultCard — photo_search', () => {
  it('renders a thumbnail grid with photographer attribution links', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'searchPhotos',
          input: { query: 'cats', perPage: 6 },
          output: {
            content: [{ type: 'text', text: 'Found 2 photos.' }],
            structuredContent: {
              photos: [
                { photoId: 'abc', description: 'fluffy cat', thumbUrl: 'https://images.unsplash.com/thumb1', photographer: 'Jane Doe', photographerUrl: 'https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/abc' },
                { photoId: 'def', description: 'orange tabby', thumbUrl: 'https://images.unsplash.com/thumb2', photographer: 'Bob Smith', photographerUrl: 'https://unsplash.com/@bob?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/def' },
              ],
            },
          },
        })}
      />,
    )
    // Thumbnails rendered as images
    const imgs = document.querySelectorAll('img')
    const thumbSrcs = Array.from(imgs).map((img) => img.getAttribute('src'))
    expect(thumbSrcs).toContain('https://images.unsplash.com/thumb1')
    expect(thumbSrcs).toContain('https://images.unsplash.com/thumb2')
    // Photographer attribution links
    const janeLink = screen.getByRole('link', { name: /Jane Doe/ }) as HTMLAnchorElement
    expect(janeLink.href).toContain('utm_source=payload-eve-chat')
    expect(janeLink.getAttribute('target')).toBe('_blank')
    // No raw JSON
    expect(document.body.textContent).not.toContain('photoId')
  })

  it('shows "No photos found" when results are empty', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'searchPhotos',
          input: { query: 'nothing', perPage: 6 },
          output: {
            content: [{ type: 'text', text: 'Found 0.' }],
            structuredContent: { photos: [] },
          },
        })}
      />,
    )
    expect(screen.getByText(/No photos found/i)).toBeTruthy()
  })

  it('shows "Searching Unsplash…" while running', () => {
    render(<ToolResultCard part={part({ state: 'input-available', toolName: 'searchPhotos', input: { query: 'cats' } })} />)
    expect(screen.getByText('Searching Unsplash…')).toBeTruthy()
  })
})

describe('ToolResultCard — media_image with credit', () => {
  it('renders the credit line when credit is present', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'addPhotoToMedia',
          input: { photoId: 'abc', alt: 'mountain lake' },
          output: {
            content: [{ type: 'text', text: 'Saved.' }],
            structuredContent: { id: 'media-1', url: '/media/unsplash-abc.jpg', alt: 'mountain lake', credit: 'Jane Doe', creditUrl: 'https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral' },
          },
        })}
      />,
    )
    const creditLink = screen.getByRole('link', { name: /Jane Doe/ }) as HTMLAnchorElement
    expect(creditLink.href).toContain('utm_source=payload-eve-chat')
    expect(creditLink.getAttribute('target')).toBe('_blank')
    expect(screen.getByText(/Unsplash/)).toBeTruthy()
  })

  it('renders media_image WITHOUT credit when generateImage (backward-compat)', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'generateImage',
          input: { prompt: 'hero', alt: 'hero image' },
          output: {
            content: [{ type: 'text', text: 'done' }],
            structuredContent: { id: 'img-1', url: '/media/hero.png', alt: 'hero image' },
          },
        })}
      />,
    )
    // Should not have an Unsplash credit line
    expect(document.body.textContent).not.toContain('Unsplash')
  })
})
```

- [ ] **Run (expect FAIL):** `pnpm run test:int -- src/components/eve/ToolResultCard.test.tsx`

- [ ] **Implement** — edit `src/components/eve/ToolResultCard.tsx`:

1. Add `PhotoCandidate` to the import from `./toolResult`.
2. Add `UsersIcon` (or reuse `ImageIcon`) from `lucide-react` — use existing icons; add `UsersIcon` for the photographer label if desired (optional).
3. In `ResultBody`, add the `photo_search` branch before `media_image`:

```tsx
  if (view.kind === 'photo_search') {
    if (view.photos.length === 0) {
      return (
        <div>
          <div className="mb-1 font-medium">Unsplash search</div>
          <p className="text-muted-foreground text-xs">No photos found for "{view.query}".</p>
        </div>
      )
    }
    return (
      <div>
        <div className="mb-2 font-medium">
          Unsplash photos for "{view.query}"
        </div>
        <div className="grid grid-cols-3 gap-2">
          {view.photos.map((p) => (
            <div key={p.photoId} className="overflow-hidden rounded border">
              <img
                src={p.thumbUrl}
                alt={p.description}
                className="h-20 w-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="p-1">
                <p className="line-clamp-1 text-xs font-medium">{p.description}</p>
                <a
                  href={p.photographerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-muted-foreground text-xs hover:underline"
                >
                  {p.photographer}
                  <ExternalLinkIcon className="size-2.5 opacity-60" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
```

4. In the `media_image` branch, add the credit line after the admin link:

```tsx
        {view.credit && view.creditUrl && (
          <p className="mt-1 text-muted-foreground text-xs">
            Photo by{' '}
            <a
              href={view.creditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {view.credit}
            </a>{' '}
            on Unsplash
          </p>
        )}
```

5. Update the title in `media_image` to read "Saved photo" when `credit` present, else "Generated image":

```tsx
        <div className="mb-1.5 font-medium">{view.credit ? 'Saved photo' : 'Generated image'}</div>
```

6. In `iconFor`, add the `photo_search` case:

```tsx
    case 'photo_search':
      return <ImageIcon className="size-4 text-amber-600" />
```

- [ ] **Run (expect PASS):** `pnpm run test:int -- src/components/eve/ToolResultCard.test.tsx`

- [ ] **Type-check:** `pnpm exec tsc --noEmit`

- [ ] **Commit:** `git add src/components/eve/ToolResultCard.tsx src/components/eve/ToolResultCard.test.tsx && git commit -m "feat(ui): render photo_search grid and media_image credit line in ToolResultCard"`

---

### Task 8: Agent instructions + article skill (+ `eve info`)

**Files:**
- Modify `agent/instructions.md`
- Modify `agent/skills/article-writing.md`

**Interfaces:**
Consumes: existing `agent/instructions.md` image generation section, existing `agent/skills/article-writing.md` §4/§6.
Produces: instructions that document a `searchPhotos → addPhotoToMedia` "real photo" path alongside `generateImage`; article skill adds a "use a real photo" procedure in §4 and a tool reference row in §6. After editing, `node_modules/.bin/eve info` must report 0 diagnostics.

- [ ] **No automated test** — verification is `node_modules/.bin/eve info` (0 diagnostics).

- [ ] **Implement — `agent/instructions.md`:** Extend the "## Image generation" section. Append a "## Real photos from Unsplash" section (only when UNSPLASH_ACCESS_KEY is available):

```markdown
## Real photos from Unsplash

When `UNSPLASH_ACCESS_KEY` is set, you have two Unsplash tools on the `payload-mcp` connection:

- **`searchPhotos`** — searches Unsplash and returns up to 12 thumbnail candidates. An in-chat photo grid appears automatically. No image is downloaded.
- **`addPhotoToMedia`** — given a `photoId`, downloads the photo, saves it to Media with photographer attribution, and returns `{ id, url, credit, creditUrl }`.

**Flow for an article with a real photo:**
1. Call `searchPhotos` with a descriptive query. Review the thumbnail grid with the user.
2. Once a photo is chosen (user says "use the second one" / picks a `photoId`), call `addPhotoToMedia(photoId, alt)`.
3. Embed: `![media:<id>]()` in the article body.
4. Add a caption directly below: `_Photo by [Name](creditUrl) on Unsplash_`

**Choosing between generateImage and searchPhotos:**
- Use `generateImage` for synthetic, AI-generated hero images (illustrative, no photographer credit needed).
- Use `searchPhotos` when the user wants a real photograph or asks for an Unsplash image.
- Never call both for the same article unless explicitly asked.

Only use `addPhotoToMedia` with a `photoId` returned by `searchPhotos` in the current session. Never fabricate or guess a photoId.
```

- [ ] **Implement — `agent/skills/article-writing.md`:** After "## 4. Deciding when to generate a hero image", insert a new "## 4b. Using a real photo from Unsplash" section:

```markdown
## 4b. Using a real photo from Unsplash

When the user requests a real photo (or you have `UNSPLASH_ACCESS_KEY` available and a real photograph suits the article):

1. Call `searchPhotos({ query: "<topic>", perPage: 6 })`. An in-chat grid of thumbnail candidates appears.
2. Review the candidates with the user (or auto-select the most relevant if the user has delegated).
3. Call `addPhotoToMedia({ photoId: "<chosen id>", alt: "<brief descriptive alt text>" })`.
   - It returns `{ id, url, credit, creditUrl }` via `structuredContent`.
   - An in-chat media card will appear automatically.
4. Embed the image placeholder at the top of the article:
   ```
   ![media:<id>]()
   ```
5. Add a credit caption immediately after the placeholder (or after the photo, inline):
   ```
   _Photo by [<credit>](<creditUrl>) on Unsplash_
   ```

**Tool call sequence:**
```
1. searchPhotos({ query: "mountain lake at dusk", perPage: 6 })
   → structuredContent.photos: [{ photoId, thumbUrl, photographer, ... }, ...]
2. addPhotoToMedia({ photoId: "abc123", alt: "mountain lake at dusk" })
   → structuredContent: { id: "media-1", url: "/media/unsplash-abc123.jpg", credit: "Jane Doe", creditUrl: "https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral" }
3. createDocumentFromMarkdown({
     collectionSlug: "posts",
     data: { title: "...", status: "draft" },
     markdown: { content: "![media:media-1]()\n\n_Photo by [Jane Doe](https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral) on Unsplash_\n\n## Introduction\n\n..." }
   })
```

**Attribution is mandatory** (Unsplash ToS): always include the `_Photo by [Name](creditUrl) on Unsplash_` caption. Use the `creditUrl` exactly as returned (UTM params are already included).
```

Also update §6 Tool reference table — add rows:

```markdown
| `searchPhotos` *(Unsplash)* | Search Unsplash for real photos. Returns `structuredContent.photos[]`. Required input: `query`. Optional: `perPage` (default 6). |
| `addPhotoToMedia` *(Unsplash)* | Download a chosen Unsplash photo and save to Media. Returns `{ id, url, credit, creditUrl }`. Required inputs: `photoId`, `alt`. |
```

- [ ] **Verify:** `node_modules/.bin/eve info` — expect 0 diagnostics (no errors about malformed skill/instructions).

- [ ] **Commit:** `git add agent/instructions.md agent/skills/article-writing.md && git commit -m "docs(agent): add searchPhotos + addPhotoToMedia real-photo path to instructions and article skill"`

---

### Task 9: README documentation

**Files:**
- Modify `README.md`

**Interfaces:**
Consumes: existing "## Features" and "## Setup / environment variables" sections.
Produces: a bullet in Features for Unsplash photo search, a table row for `UNSPLASH_ACCESS_KEY` in the env-vars section, and a note about the Unsplash ToS / attribution / demo rate limit.
NOTE: do NOT re-add `UNSPLASH_ACCESS_KEY` to `.env.example` — it was already committed in da30c0a.

- [ ] **No automated test** — verified by reading the rendered README.

- [ ] **Implement:** In `README.md`:
  1. Add a Features bullet after the "Image generation" bullet:
     ```
     - **Real photos from Unsplash** — the `searchPhotos` MCP tool returns a thumbnail grid of real photographs; `addPhotoToMedia` downloads the chosen photo into Media with photographer credit. Eve can embed it in an article via `![media:<id>]()` with a mandatory `_Photo by [Name](url) on Unsplash_` caption. Requires `UNSPLASH_ACCESS_KEY` (free; 50 req/hr on demo tier). Attribution and the ToS download trigger are handled automatically.
     ```
  2. In the env-vars table (wherever `UNSPLASH_ACCESS_KEY` appears in context — confirm it is already in .env.example), add a prose note explaining the demo rate limit (50 req/hr) and attribution ToS if not already present.

- [ ] **Commit:** `git add README.md && git commit -m "docs: add Unsplash photo search feature to README"`

---

### Task 10: Full suite verification

**Files:** None new — runs existing tests + type-check + eve info + build check.

**Goal:** Green on all tests, 0 TypeScript errors, 0 eve diagnostics.

- [ ] **Run full test suite:** `pnpm run test:int`
  Expected: all tests pass (no regressions to existing tests).

- [ ] **Run TypeScript check:** `pnpm exec tsc --noEmit`
  Expected: 0 errors.

- [ ] **Run eve info:** `node_modules/.bin/eve info`
  Expected: 0 diagnostics.

- [ ] **Build check (optional but recommended):** `pnpm build`
  Expected: exits 0 (or note any known pre-existing warnings).

- [ ] **Manual smoke-test checklist** (in `/admin/eve`, with `UNSPLASH_ACCESS_KEY` set in `.env.local`):
  - [ ] Ask Eve: "Find me 6 Unsplash photos of a mountain lake." → thumbnail grid appears in chat.
  - [ ] Ask Eve: "Use the second photo." → `addPhotoToMedia` is called → media_image card appears with credit line "Photo by [Name] on Unsplash".
  - [ ] Ask Eve: "Write an article about mountain lakes with that photo." → article draft includes `![media:<id>]()` and `_Photo by [Name](…) on Unsplash_` caption.
  - [ ] Approve → `createDocumentFromMarkdown` → post saved as draft.
  - [ ] Visit `/admin/collections/media/<id>` → confirm `credit` and `creditUrl` fields are populated.
  - [ ] Without `UNSPLASH_ACCESS_KEY` set: restart server → confirm `searchPhotos` and `addPhotoToMedia` are absent from Eve's tool list.
