# Eve Image Generation + Media — Design Spec

## Goal

Add a `generateImage` Payload MCP tool that calls the Vercel AI Gateway image model, auto-saves
the result to the Media collection, and returns `{ id, url }` — enabling Eve to embed a 16:9 hero
image in any article it creates, with a matching in-chat inline preview card.

---

## Architecture

The tool runs entirely inside the Next.js / Payload process (`src/eve/generate-image-tool.ts`,
sibling to `markdown-tool.ts`) because it needs both the gateway (`import { generateImage, gateway }
from 'ai'`) and `payload.create` with a `file` parameter; neither is available in the Eve agent
process. The Eve agent calls the tool over the existing `payload-mcp` MCP connection. The tool
returns only `{ id, url, alt }` — never raw bytes or base64 — so the image never enters the
model's token context. The `media` collection gains minimal `find` + `getCollectionSchema` MCP
exposure so the agent can reuse existing images; the unsafe write path (generic `create`, `update`,
`delete`) stays off.

---

## Verified Facts (dist-confirmed)

- **`ai@7.0.0-beta.178`** exports `generateImage` and `gateway` from its top-level `dist/index.js`
  and `dist/index.d.ts`. Specifically: `gateway2 as gateway` re-exported from `@ai-sdk/gateway`,
  and `generateImage` function, both confirmed in the bundle. `gateway.imageModel(id)` returns a
  provider image model. No `@ai-sdk/gateway` direct import needed; `ai` re-exports it.

- **`generateImage` signature** (from `ai/dist/index.d.ts` line 6991):
  ```ts
  generateImage({ model, prompt, n?, size?, aspectRatio?, seed?, providerOptions?, maxRetries?,
                  abortSignal?, headers? }): Promise<GenerateImageResult>
  ```
  `GenerateImageResult.image` is a `GeneratedFile` with `.uint8Array: Uint8Array` and `.base64:
  string` (lazy-computed from each other). `GenerateImageResult.images` is an array.

- **`payload.create` file param** (from `payload/dist/collections/operations/local/create.d.ts`):
  `file?: { data: Buffer, mimetype: string, name: string, size: number }` — part of `BaseOptions`.
  Passed alongside `data: { alt }` and `collection: 'media'`.

- **Placeholder format** (from `@payloadcms/richtext-lexical/dist/features/upload/server/
  markdownTransformer.js` line 3): `UPLOAD_PLACEHOLDER_REGEX = /!\[([^\]:]+):([^\]]+)\]\(\)/`
  i.e. `![<relationTo>:<id>]()`. The Media slug is `'media'`, so the correct placeholder for a
  generated hero is `![media:<id>]()`.

- **Media collection** (`src/collections/Media.ts`): slug `'media'`, `upload: true`, single field
  `alt` (text, required), `versions: false`. The `url` field is provided automatically by Payload
  upload processing (`FileData.url?: string` in `payload/dist/uploads/types.d.ts`).

- **MCP plugin config** (`src/payload.config.ts` lines 69–70): `media` is currently fully locked
  (`find: false, create: false, update: false, delete: false, getCollectionSchema: false`). The
  spec changes this to enable `find` and `getCollectionSchema` only.

- **`defineTool` API** (`@payloadcms/plugin-mcp/dist/defineTool.js`): two-stage builder —
  `defineTool({ description, input }).handler(fn)` where `fn` receives
  `{ authorizedMCP, input, req, serverContext }`. Handler returns `MCPToolResponse`:
  `{ content: ContentBlock[], doc?: Record<string, unknown> }`.

- **Tool result rendering** (`src/components/eve/toolResult.ts`): MCP tools return
  `{ content:[{type:'text',text}], structuredContent?, isError? }` to the Eve agent — the `doc`
  field is stripped server-side by `finalizeToolResponse` in `buildMcpServer.js` (line 30:
  `const { doc: _doc, ...rest } = overridden`) before the response crosses the MCP wire. Therefore
  `output['doc']` in `describeToolResult` is always `undefined` for any Payload MCP tool call;
  the `'records'` path (toolResult.ts lines 199–214) currently never fires for Payload MCP tools
  because it depends on `output['doc']` being present. The new `'media_image'` kind is detected
  via `structuredContent`, which is NOT stripped (it is part of `Pick<CallToolResult, '_meta' |
  'isError' | 'structuredContent'>` and passes through in `...rest`). Eve's compiled MCP client
  (`@ai-sdk/mcp/index.js`) parses the full `Me` schema which includes `structuredContent: optional(
  any())` and exposes it in `part.output`. Detection: `name === 'generateImage' &&
  isObj(output?.['structuredContent'])`.

- **Eve agent cannot import from `src/`** (established fact). The tool must live in `src/eve/`.

---

## Components & Files

| File | Status | Responsibility |
|------|--------|----------------|
| `src/eve/generate-image-tool.ts` | **Create** | `generateImageTool`: calls `generateImage({ model: gateway.imageModel(...), prompt, aspectRatio })`, converts `Uint8Array → Buffer`, calls `payload.create({ collection:'media', data:{alt}, file:{data,mimetype,name,size} })`, returns `{ content:[text], structuredContent:{id,url,alt} }` (no `doc` field — it is stripped at the MCP wire layer) |
| `src/payload.config.ts` | **Modify** | Import `generateImageTool`; add it to `mcpPlugin({ tools: { generateImage: generateImageTool } })`; change `media` block from `{ find:false, create:false, update:false, delete:false, getCollectionSchema:false }` to `{ tools: { create: false, update: false, delete: false } }` (enabling `find` and `getCollectionSchema`; `findDocuments` will return all Media doc fields: `id`, `url`, `alt`, `filename`, `mimeType`, `sizes` — all already public in this template) |
| `src/components/eve/toolResult.ts` | **Modify** | Add `'media_image'` variant to `ToolResultView` union; extend `describeToolResult()` to detect `name === 'generateImage' && isObj(output?.['structuredContent'])` and return `{ kind: 'media_image', id, url, alt }`. Note: the existing `'records'` branch (lines 199–214, checking `output['doc']`) is currently non-functional for all Payload MCP tools because `doc` is stripped at the wire level — fixing or noting this is a prerequisite task |
| `src/components/eve/ToolResultCard.tsx` | **Modify** | Add `ResultBody` branch for `view.kind === 'media_image'`: renders `<img src={url} alt={alt} />` + admin link + caption; add `ImageIcon` to `iconFor()` |
| `agent/instructions.md` | **Modify** | Add "Image generation" section describing the search → generateImage → createDocumentFromMarkdown flow, the `![media:<id>]()` embed syntax, and the approval gate |
| `.env.example` | **Modify** | Add `EVE_IMAGE_MODEL` with default comment and note that omitting it uses `google/imagen-4.0-fast-generate-001` |

---

## Data Flow

```
User: "Write an article about X"
  │
  ▼
Eve (agent process)
  1. Calls web_search("X overview") → reads sources
  2. Calls generateImage (MCP → payload-mcp connection)
        input: { prompt: "hero image for article about X", alt: "...", aspectRatio: "16:9" }
  │
  ▼  [MCP call crosses to Payload process]
generateImageTool handler (src/eve/generate-image-tool.ts)
  3. import { generateImage, gateway } from 'ai'
     const result = await generateImage({
       model: gateway.imageModel(process.env.EVE_IMAGE_MODEL ?? 'google/imagen-4.0-fast-generate-001'),
       prompt,
       aspectRatio,        // '16:9'
       n: 1,               // hard-coded: one hero per call
     })
  4. const buf = Buffer.from(result.image.uint8Array)
     const doc = await req.payload.create({
       collection: 'media',
       data: { alt },
       file: { data: buf, mimetype: 'image/png', name: `hero-${Date.now()}.png`, size: buf.length },
       overrideAccess: authorizedMCP.overrideAccess,
       user: authorizedMCP.user,
       req,
     })
  5. returns { content:[{type:'text', text:`Saved image (id: ${doc.id})`}], structuredContent:{id:doc.id, url:doc.url, alt} }
     // doc field NOT used — it is stripped by finalizeToolResponse before the MCP response
     // reaches Eve. structuredContent passes through and is accessible as part.output['structuredContent']
  │
  ▼  [MCP response back to agent]
Eve agent
  6. Writes article Markdown, embeds hero: "![media:<id>]()"
  7. Calls createDocumentFromMarkdown({
       collectionSlug:'posts', data:{title,status:'draft'},
       markdown:{ content: "# Article Title\n\n![media:<id>]()\n\n..." }
     })
  │
  ▼
ToolResultCard (browser)
  8. describeToolResult detects generateImage via name === 'generateImage' && isObj(output['structuredContent']) → kind:'media_image'
  9. Renders <img src={url} alt={alt}> + "/admin/collections/media/<id>" link
```

---

## Interfaces

### Zod input schema (`generate-image-tool.ts`)

```ts
z.object({
  prompt: z.string().min(1).max(1000)
    .describe('Text prompt for the image. Be specific: subject, style, mood, composition.'),
  alt: z.string().min(1).max(500)
    .describe('Alt text for the saved Media document (required by the Media collection).'),
  aspectRatio: z.string().default('16:9')
    .describe('Aspect ratio (default "16:9"). Supported by Imagen 4: "1:1", "4:3", "16:9", "9:16".'),
})
```

`size` is intentionally omitted: Imagen 4 uses `aspectRatio` to control dimensions, not pixel
size; passing both is either ignored or errors. Other models that take `size` can be configured
via `EVE_IMAGE_MODEL` but must also adapt; the prompt must document this limitation.

### Handler return shape

```ts
// content[0].text (for the model's token context):
`Generated image saved to Media (id: ${doc.id}). Embed in Markdown as: ![media:${doc.id}]()`

// structuredContent (NOT stripped — passes through finalizeToolResponse in ...rest):
{ id: string | number, url: string, alt: string }
```

`doc` is NOT used in the handler return — it is stripped server-side by `finalizeToolResponse`
(buildMcpServer.js line 30) before crossing the MCP wire to Eve. Structured data for the
in-chat card is passed via `structuredContent`, which is part of
`Pick<CallToolResult, '_meta' | 'isError' | 'structuredContent'>` and survives the wire.
Eve's MCP client parses it and exposes it in `part.output['structuredContent']`.

### `ToolResultView` addition

```ts
| { kind: 'media_image'; id: string; url: string; alt: string }
```

Detection in `describeToolResult`:

```ts
if (name === 'generateImage' && isObj(output)) {
  const sc = output['structuredContent']
  if (isObj(sc) && typeof sc['url'] === 'string' && typeof sc['id'] !== 'undefined') {
    return {
      kind: 'media_image',
      id: String(sc['id']),
      url: sc['url'] as string,
      alt: typeof sc['alt'] === 'string' ? (sc['alt'] as string) : '',
    }
  }
}
```

Detection uses `output['structuredContent']` because `doc` is stripped at the MCP wire layer
(buildMcpServer.js line 30); `structuredContent` passes through as part of `...rest` and is
exposed in `part.output` by Eve's MCP client. The check must be placed BEFORE the existing
`output['doc']` block (lines 196–217 in toolResult.ts) since `doc` will always be `undefined`
for MCP tools and the guard `isObj(doc)` at line 199 will never be true.

### Media MCP config change (`payload.config.ts`)

```ts
media: {
  description:
    'Uploaded images. Use findDocuments to list existing images for reuse. ' +
    'To generate a new image, use the generateImage tool instead.',
  tools: { create: false, update: false, delete: false },
  // find + getCollectionSchema remain enabled (default on)
},
```

### `agent/instructions.md` addition

```md
## Image generation

You can generate a hero image for any article using the `generateImage` tool (available on the
payload-mcp connection). This costs ~$0.02 per image — only call it when the user asks for an
article with a hero image, or explicitly requests image generation.

Flow for an illustrated article:
1. `web_search` the topic to gather facts.
2. Call `generateImage` with a detailed prompt and `alt` text. It returns `{ id, url }`.
3. Write the article Markdown. Embed the hero after the H1 title using the special syntax:
   `![media:<id>]()` — replace `<id>` with the returned id. Do NOT use a regular Markdown image.
4. Call `createDocumentFromMarkdown` as normal. The hero auto-appears in the post body.

You can also call `findDocuments` on the `media` collection to reuse an existing uploaded image
instead of generating a new one.
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `generateImage` throws (gateway auth, quota, model unavailable) | Handler propagates the error; plugin sets `isError: true` in the MCP response; Eve retries or surfaces the error to user |
| `payload.create` fails (disk, validation) | Same propagation path |
| `doc.url` is `null` (upload processed but no URL yet) | Tool should throw: `'Media upload succeeded but URL is unavailable'`; this is a config issue (staticDir / serverURL not set) |
| `EVE_IMAGE_MODEL` set to an unsupported model | Gateway error propagates; document in instructions that only models supporting `aspectRatio` are compatible with the default flow |
| Agent tries `createDocumentFromMarkdown` with `![media:<wrong-id>]()` | Lexical converter creates an Upload node with a non-existent ID; Payload silently stores the invalid reference; document in instructions to only use IDs returned by `generateImage` or `findDocuments` |

---

## Testing Strategy

All tests use Vitest. Do NOT call `generateImage` or `gateway.imageModel` in unit tests — live
model calls cost credits and require gateway auth.

### Unit tests (`src/eve/__tests__/generate-image-tool.test.ts`)

- Mock `import 'ai'` to return a fake `generateImage` that resolves with a stub `GeneratedFile`
  (fixed `uint8Array`). Mock `req.payload.create` to return `{ id: 'test-id', url: '/media/hero.png', alt: 'test' }`.
- Assert tool returns `{ content: [{ type: 'text', text: /test-id/ }], structuredContent: { id: 'test-id', url: '/media/hero.png', alt: 'test' } }` (no `doc` field — `doc` is stripped at the MCP layer and must not be relied upon for card rendering).
- Assert `payload.create` called with `{ collection: 'media', data: { alt: 'test' }, file: { data: expect.any(Buffer), mimetype: 'image/png', name: expect.stringMatching(/\.png$/), size: expect.any(Number) } }`.
- Assert tool throws when `payload.create` returns `{ id: '...', url: null }`.

### Unit tests (`src/components/eve/__tests__/toolResult.test.ts`)

- `describeToolResult` with a fake `generateImage` part (state `output-available`, output with
  `structuredContent: { id: '42', url: '/media/hero.png', alt: 'A hero' }`) → returns `{ kind: 'media_image', ... }`.
- Fallback: if `structuredContent` is absent or `url` missing → falls through to `'text'` (from `content[0].text`) or `'done'`.
- Confirm existing `output['doc']` branch never fires for MCP tools: pass a fake part with `doc` set on output → assert it still falls through (doc is undefined in real MCP output).

### Type check

```bash
pnpm tsc --noEmit
```

Catches: wrong return type from handler, `aspectRatio` not accepted by `generateImage` params,
`file.data` not a `Buffer`.

### Integration smoke (manual, not automated — costs credits)

Log into admin. Open Eve chat. Say "Write a 200-word article about the James Webb Space Telescope
with a hero image." Confirm: tool card appears with inline image preview + admin link; post created
in Payload with `![media:<id>]()` rendered as an Upload node in the Lexical editor.

---

## Cost / Credit Considerations

- **`google/imagen-4.0-fast-generate-001`** (default): **$0.02 per image**. One call per article
  hero. The tool hard-codes `n: 1`; there is no batch path.
- Override via `EVE_IMAGE_MODEL` env var. Other low-cost options: `xai/grok-imagine-image` ($0.02),
  `bytedance/seedream-4.0` ($0.03).
- The tool description and `agent/instructions.md` both explicitly state the cost and instruct the
  model to call `generateImage` only when the user requests an illustrated article or explicit image
  generation — not on every post.
- Gateway auth uses the same `VERCEL_OIDC_TOKEN` / `AI_GATEWAY_API_KEY` credentials already
  configured for Eve's chat model. No new keys, no new npm dependencies.
- Media documents accumulate; there is no automatic cleanup. The tool comment notes this for
  operators who want to periodically prune unused media.

---

## Open Questions / Risks

1. **`doc` stripping — RESOLVED**: `MCPToolResponse.doc` is confirmed stripped server-side by
   `finalizeToolResponse` (buildMcpServer.js line 30: `const { doc: _doc, ...rest } = overridden`).
   `output['doc']` in `describeToolResult` is always `undefined` for Payload MCP tools; the
   `'records'` branch (toolResult.ts lines 199–214) is currently dead code for all MCP tool calls.
   The implementation MUST use `structuredContent` (confirmed to pass through `...rest` and be
   parsed by Eve's MCP client in `part.output['structuredContent']`). A separate task should audit
   whether the existing `output['doc']` branch in toolResult.ts should be removed or repurposed
   (it cannot be relied on for any current or future Payload MCP tool unless the plugin changes).

2. **`url` availability at create-time**: Payload's Local API `create` returns the processed
   document, including `url`, synchronously after upload processing. However, if `serverURL` is
   not configured in `payload.config.ts`, `url` may be a relative path or `null`. Operators must
   ensure `serverURL` is set in production. The `<img src={url}>` in `ToolResultCard` renders a
   relative URL fine in the admin (same-origin), but the article's Lexical Upload node renders from
   the stored ID, not the URL, so article display is unaffected.

3. **Imagen 4 `aspectRatio` support**: Confirmed in gateway pricing docs as supporting `'16:9'`.
   If `EVE_IMAGE_MODEL` is overridden to a model that does not accept `aspectRatio`, the gateway
   may error or ignore it. The Zod schema accepts any string; the tool does not validate model
   compatibility. Document this in `.env.example`.

4. **Image MIME type**: Imagen 4 returns PNG bytes. The tool hard-codes `mimetype: 'image/png'`.
   If a model returns JPEG or WebP, the Media document will have the wrong `mimeType` field. A
   future improvement could detect the MIME from the `result.image` data (Payload's
   `detectMediaType` or a simple byte-sniff). For the initial implementation, PNG is safe for all
   current gateway image models.

5. **`media` `find` exposure**: Enabling `find` and `getCollectionSchema` exposes Media document
   metadata to the agent via `findDocuments`. Fields returned include `id`, `url`, `alt`,
   `filename`, `mimeType`, `filesize`, `width`, `height`, and any `sizes` (thumbnail variants).
   Sensitive fields like auth tokens do not exist on this collection. Media files are already
   publicly readable (the Media collection has `access: { read: () => true }`), so this does not
   widen the security surface for this template. Operators who add private or user-specific uploads
   (profile pictures, etc.) should reassess and potentially set `find: false` to keep the agent
   from enumerating all uploaded files. The agent cannot call `create`, `update`, or `delete` on
   Media via MCP (those remain off).

---

## Review corrections applied

- **Critical (doc stripping)**: Replaced all `doc`-based detection with `structuredContent`-based detection throughout (Verified Facts, Components & Files, Data Flow step 5 & 8, Interfaces handler return + ToolResultView detection snippet, Testing Strategy, Open Question #1). The `doc` field is stripped by `finalizeToolResponse` (buildMcpServer.js line 30) before crossing the MCP wire; `structuredContent` passes through and is exposed in `part.output['structuredContent']` by Eve's MCP client (confirmed in compiled `@ai-sdk/mcp/index.js` schema `Me`). The spec now also documents that the existing `'records'` branch in toolResult.ts is currently dead code for all Payload MCP tools.
- **Important (records path false premise)**: Architecture section, Components & Files table, and toolResult.ts responsibility line updated to state that the `'records'` doc path is non-functional for MCP tools and that `media_image` detection uses `structuredContent`, not a `doc`-based fallback.
- **Important (media find fields)**: Open Question #5 and Components & Files media config line now explicitly list the fields returned by `findDocuments` on Media (`id`, `url`, `alt`, `filename`, `mimeType`, `filesize`, `width`, `height`, `sizes`) and note the operator risk for templates that add private uploads.
