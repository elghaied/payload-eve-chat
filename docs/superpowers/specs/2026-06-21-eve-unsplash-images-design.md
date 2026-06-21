# Unsplash photo search → Media — Design Spec

**Goal:** Let Eve search Unsplash, show photo candidates in chat, and on a pick upload the chosen photo into Payload Media (with photographer attribution) so it embeds in an article via `![media:<id>]()` — a real-photo alternative to `generateImage`.

## Architecture

Two new **Payload-side MCP tools** in `src/eve/`, following the exact pattern of `src/eve/generate-image-tool.ts`: they run in the Next/Payload process (so they can call both the Unsplash HTTP API and `payload.create`), are registered on the MCP plugin in `src/payload.config.ts`, and return data via `structuredContent` (the `doc` field is stripped at the MCP wire layer by `finalizeToolResponse`). The tools are registered **only when `UNSPLASH_ACCESS_KEY` is set**, so Eve never sees tools it can't use. A small fetch-based client module isolates the Unsplash HTTP surface for unit testing. The in-chat search-results grid and the credited image card are added to the existing `toolResult.ts` / `ToolResultCard.tsx`.

This complements `generateImage` (generate a synthetic hero) with "fetch a real photo"; Eve chooses per request.

## Components & Files

- **Create `src/eve/unsplash.ts`** — pure client over `https://api.unsplash.com` with `Authorization: Client-ID ${UNSPLASH_ACCESS_KEY}`:
  - `searchPhotos(query: string, perPage: number): Promise<UnsplashPhoto[]>` → `GET /search/photos?query&per_page&content_filter=high`, returns `body.results`.
  - `getPhoto(id: string): Promise<UnsplashPhoto>` → `GET /photos/:id`.
  - `triggerDownload(downloadLocation: string): Promise<void>` → `GET <download_location>` with the same auth header (ToS requirement; best-effort, errors swallowed/logged).
  - Throws a typed error on non-2xx (status + Unsplash message) so the tools can surface clean text.
- **Create `src/eve/unsplash-search-tool.ts`** — MCP tool `searchPhotos` (see Interfaces). No upload, no download trigger (search ≠ "use").
- **Create `src/eve/unsplash-add-tool.ts`** — MCP tool `addPhotoToMedia`. Re-fetches the photo by id (URLs never round-trip through the model), triggers `download_location`, fetches `urls.regular`, validates, `payload.create` Media with credit, returns `structuredContent`.
- **Modify `src/payload.config.ts`** — register both tools in the `mcpPlugin({ tools })` object, gated on `process.env.UNSPLASH_ACCESS_KEY`.
- **Modify `src/collections/Media.ts`** — add optional `credit` (text) and `creditUrl` (text) fields.
- **Modify `src/components/eve/toolResult.ts`** — add a `photo_search` view (`{ kind: 'photo_search'; photos: PhotoCandidate[] }`) detected by `name === 'searchPhotos'` reading `structuredContent.photos`; extend the `media_image` view with optional `credit` + `creditUrl` (read from `structuredContent`); add `runningLabel` cases ("Searching Unsplash…", "Saving photo to Media…").
- **Modify `src/components/eve/ToolResultCard.tsx`** — render `photo_search` as a thumbnail grid (each item: `thumbUrl` image, description, "by <photographer>" linking to `photographerUrl` with UTM); show the credit line on the `media_image` card when present. Image origins are `images.unsplash.com` (hotlinked per ToS).
- **Modify `agent/instructions.md` + `agent/skills/article-writing.md`** — a "use a real photo" path: `searchPhotos(query)` → review candidates → `addPhotoToMedia(photoId, alt)` → embed `![media:<id>]()` **and** add a caption `_Photo by [Name](creditUrl?utm_source=…&utm_medium=referral) on Unsplash_`. State the generate-vs-fetch choice (`generateImage` for synthetic; Unsplash for real photos).
- **Modify `.env.example` + `README.md`** — document `UNSPLASH_ACCESS_KEY`, the flow, attribution/ToS, and the demo rate limit (50 req/hr).

## Interfaces

```ts
// src/eve/unsplash.ts
export type UnsplashPhoto = {
  id: string
  description: string | null
  alt_description: string | null
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  links: { html: string; download: string; download_location: string }
  user: { name: string; username: string; links: { html: string } }
  width: number; height: number; color: string | null
}
export async function searchPhotos(query: string, perPage: number): Promise<UnsplashPhoto[]>
export async function getPhoto(id: string): Promise<UnsplashPhoto>
export async function triggerDownload(downloadLocation: string): Promise<void>
```

```ts
// searchPhotos tool — input/output
input:  { query: string (1..200), perPage?: number (1..12, default 6) }
output: {
  content: [{ type: 'text', text: `Found N Unsplash photos for "<query>".` }],
  structuredContent: { photos: Array<{
    photoId: string
    description: string        // alt_description || description || 'Untitled'
    thumbUrl: string           // urls.thumb (hotlinked)
    photographer: string       // user.name
    photographerUrl: string    // user.links.html (UTM appended in the card)
    unsplashUrl: string        // links.html
  }> }
}
```

```ts
// addPhotoToMedia tool — input/output
input:  { photoId: string, alt: string (1..500) }
// handler: getPhoto(photoId) → triggerDownload(links.download_location)
//          → fetch(urls.regular) → Buffer (guard: content-type image/*, size ≤ MAX)
//          → payload.create({ collection:'media',
//               data:{ alt, credit: user.name, creditUrl: user.links.html+UTM },
//               file:{ data, mimetype, name:`unsplash-${photoId}.<ext>`, size } })
output: {
  content: [{ type: 'text', text: `Saved photo by <name> to Media (id: <id>). Embed: ![media:<id>]() and credit the photographer.` }],
  structuredContent: { id, url, alt, credit, creditUrl }
}
```

```ts
// Media field additions (src/collections/Media.ts)
{ name: 'credit',    type: 'text' }  // photographer name (optional)
{ name: 'creditUrl', type: 'text' }  // photographer Unsplash profile URL (optional)
```

`UTM` = `?utm_source=<appName>&utm_medium=referral` (appName e.g. `payload-eve-chat`), appended to photographer/photo links wherever displayed (card + article caption), per Unsplash attribution guidelines.

## Data flow

User: "write an article about X with a real photo" → Eve calls `searchPhotos("X")` → chat shows a thumbnail grid → Eve (or user: "use the 2nd") picks a `photoId` → Eve calls `addPhotoToMedia(photoId, alt)` → tool triggers the Unsplash download event, fetches the image, creates a Media doc with credit → returns `{ id, url, credit, creditUrl }` → media_image card shows the photo + credit → Eve writes the article embedding `![media:<id>]()` with a credit caption → `createDocumentFromMarkdown`.

## Error handling

- **Missing `UNSPLASH_ACCESS_KEY`:** tools are not registered (gated in `payload.config.ts`), so Eve never offers them.
- **Unsplash 401/403:** client throws; tool returns `content` text like "Unsplash auth failed — check UNSPLASH_ACCESS_KEY." `isError: true`.
- **Unsplash 429 (rate limit):** tool returns "Unsplash rate limit reached (50/hr on the demo tier) — try again shortly."
- **Empty search results:** `searchPhotos` returns `photos: []`; card shows "No photos found for <query>."
- **Image fetch non-image or oversize (> MAX, e.g. 10 MB):** `addPhotoToMedia` rejects with a clear message; no Media doc created.
- **`triggerDownload` failure:** logged, non-fatal (the upload still proceeds; tracking is best-effort).
- **SSRF:** `addPhotoToMedia` only ever fetches a URL obtained from `getPhoto` (an `images.unsplash.com` URL); assert the host is an Unsplash domain before fetching.

## Cost / ToS

- Unsplash API is **free**; demo tier 50 req/hr, production 5000/hr. `searchPhotos` = 1 req; `addPhotoToMedia` = 2 reqs (getPhoto + download trigger) + the image fetch. Note the demo limit in docs.
- ToS compliance: hotlink `urls.*` (we do for thumbs and the stored image source), trigger `download_location` on use, attribute the photographer (Media fields + article caption + card link with UTM). These are mandatory, not optional.

## Testing strategy

- **`src/eve/unsplash.test.ts`** — unit-test `searchPhotos`/`getPhoto`/`triggerDownload` with **mocked `fetch`** (Unsplash JSON fixtures): correct URL + `Client-ID` header, result mapping, error throw on non-2xx. No live calls.
- **`src/eve/unsplash-search-tool.test.ts`** — handler maps `results` → `structuredContent.photos` (field mapping, empty results, fallback description). Mock the client/fetch.
- **`src/eve/unsplash-add-tool.test.ts`** — handler: triggers `download_location`, fetches `urls.regular`, calls `payload.create` with `{ alt, credit, creditUrl }` + image buffer, returns `structuredContent`; SSRF host guard; oversize/non-image rejection. Mock `fetch` + `payload.create` — **no live Unsplash, no DB**.
- **`toolResult.test.ts`** — `photo_search` parsing + `media_image` with credit.
- **`ToolResultCard.test.tsx`** — renders the thumbnail grid (img + photographer link) and the credit line; no raw JSON.
- **`payload-config-mcp.test.ts`** — assert the Unsplash tools are gated on `UNSPLASH_ACCESS_KEY`.
- **`pnpm exec tsc --noEmit`**, **`node_modules/.bin/eve info`** (0 diagnostics after the skill/instructions edit). jsdom env; no jest-dom. **No live Unsplash calls in unit tests.**
- **Manual (free, rate-limited):** in `/admin/eve`, ask for a photo of X → confirm the thumbnail grid, pick one, confirm it saves to Media with credit and embeds in an article with a caption.

## Open questions / risks

- **Direct vs proxied image:** we download `urls.regular` into Media (self-hosted asset) rather than hotlinking the live image into the post. This is intentional (assets live in Payload), and ToS-compliant as long as we still trigger the download event and attribute — which we do.
- **Card images hotlink Unsplash** (`urls.thumb`); requires network at render time. Acceptable for a search-results preview.
- **`content_filter=high`** is applied to reduce unsafe results; not a guarantee.
