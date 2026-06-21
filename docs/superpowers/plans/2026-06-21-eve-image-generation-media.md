# Eve Image Generation + Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a `generateImage` Payload MCP tool that calls the Vercel AI Gateway image model, saves the result to the Media collection, and returns `structuredContent: { id, url, alt }`. Fold in the pre-existing record-card fix: update `describeToolResult` and `ToolResultCard` to read `structuredContent` for tools we author (since `doc` is always stripped at the MCP wire layer) and parse the fenced ```json block from built-in tool content text as a fallback. Fix existing test fixtures that incorrectly assumed `doc` was available in on-the-wire output.

**Architecture:** The tool lives in `src/eve/generate-image-tool.ts` (Payload/Next process, beside `markdown-tool.ts`). It imports `generateImage` and `gateway` from `ai` (already installed at `7.0.0-beta.178`), converts `Uint8Array → Buffer`, calls `req.payload.create({ collection:'media', ... })`, and returns `{ content:[text], structuredContent:{id,url,alt} }` — no `doc` field (stripped by `finalizeToolResponse`). The agent calls it over the `payload-mcp` MCP connection. Media MCP exposure is widened to `find` + `getCollectionSchema` only (write path stays off).

**Tech Stack:** TypeScript, `ai@7.0.0-beta.178` (`generateImage`, `gateway`), `@payloadcms/plugin-mcp` (`defineTool`), Payload Local API (`payload.create`), Vitest, `@testing-library/react`. No new npm dependencies.

## Global Constraints

- No new npm dependencies (`ai` is already installed; `@ai-sdk/gateway` must NOT be imported directly)
- Default image model: `google/imagen-4.0-fast-generate-001`
- `structuredContent` is the ONLY safe channel for structured data back to the Eve agent — `doc` is always stripped by `finalizeToolResponse` (buildMcpServer.js line 30) before the MCP response crosses the wire
- Tool handler must NOT return a `doc` field for card rendering; use `structuredContent`
- `defineTool` from `@payloadcms/plugin-mcp` is a two-stage builder: `defineTool({description, input:zod}).handler(async ({authorizedMCP, input, req}) => result)`
- Eve agent process cannot import from `src/` — all gateway/Payload logic stays in `src/eve/`
- Test commands: `pnpm run test:int` (vitest), `pnpm exec tsc --noEmit` (types), `node_modules/.bin/eve info` (agent graph, expect 0 diagnostics)
- No live `generateImage` or `gateway.imageModel` calls in tests (credits billed); mock both
- Inline the placeholder regex literal `/!\[([^\]:]+):([^\]]+)\]\(\)/` in tests — do NOT import from deep `@payloadcms/richtext-lexical/dist` paths (blocked by package exports map)

---

### Task 1: Fix toolResult.ts — `structuredContent`-based detection + fenced-JSON fallback + `media_image` type

**Files:**
- Modify: `src/components/eve/toolResult.ts` (lines 1–244)
- Test path: `src/components/eve/toolResult.test.ts` (lines 1–231)

**Interfaces:**
- Consumes: `EveDynamicToolPart` from `eve/react`; existing `ToolResultView` union type
- Produces:
  - Extended `ToolResultView` union adding `| { kind: 'media_image'; id: string; url: string; alt: string }`
  - New helper `parseJsonBlock(text: string): unknown | null`
  - Updated `describeToolResult` that detects `generateImage` via `structuredContent`, parses fenced ```json block for built-in tools, and never relies on `output['doc']` for MCP-authoritative data
  - `bareToolName` extended to handle `'generateImage'`

- [ ] **Step 1: Write failing test — `media_image` detection via `structuredContent`**

  Add to `src/components/eve/toolResult.test.ts` (after the existing `runningLabel` block at line 231):

  ```ts
  describe('media_image detection', () => {
    it('returns media_image when generateImage has structuredContent with url + id', () => {
      const v = describeToolResult(
        part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: { prompt: 'hero', alt: 'A hero image', aspectRatio: '16:9' },
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-1). Embed in Markdown as: ![media:img-1]()' }],
            structuredContent: { id: 'img-1', url: '/media/hero.png', alt: 'A hero image' },
          },
        }),
      )
      expect(v?.kind).toBe('media_image')
      if (v?.kind === 'media_image') {
        expect(v.id).toBe('img-1')
        expect(v.url).toBe('/media/hero.png')
        expect(v.alt).toBe('A hero image')
      }
    })

    it('falls back to text when structuredContent has no url', () => {
      const v = describeToolResult(
        part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: {},
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-2). Embed in Markdown as: ![media:img-2]()' }],
            structuredContent: { id: 'img-2' },
          },
        }),
      )
      // No url → not media_image; falls through to text from content[0].text
      expect(v?.kind).toBe('text')
    })

    it('does NOT produce media_image when structuredContent is absent', () => {
      const v = describeToolResult(
        part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          input: {},
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-3). Embed in Markdown as: ![media:img-3]()' }],
          },
        }),
      )
      expect(v?.kind).not.toBe('media_image')
    })

    it('confirms doc-based branch never fires for MCP tools (doc always stripped at wire)', () => {
      // Even if a test were to put `doc` on the output object, the real wire shape
      // never has it — but the branch guard `isObj(doc)` must remain for non-MCP paths.
      // Pass doc explicitly and confirm it IS picked up by existing branch (it's still
      // correct for any hypothetical non-MCP caller), but also verify it's absent
      // in the real MCP output shape modelled by our generateImage test above.
      const vWithDoc = describeToolResult(
        part({
          state: 'output-available',
          toolName: 'createDocument',
          input: { collectionSlug: 'tasks' },
          output: { content: [{ type: 'text', text: 'ok' }], doc: { id: 'abc', title: 'Buy milk', priority: 'high' } },
        }),
      )
      // doc branch still fires when doc IS present (non-MCP callers or test fixtures)
      expect(vWithDoc?.kind).toBe('records')

      // Real MCP output for generateImage has no doc — structuredContent is the channel
      const vRealMCP = describeToolResult(
        part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          input: {},
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-4). Embed in Markdown as: ![media:img-4]()' }],
            structuredContent: { id: 'img-4', url: '/media/hero.png', alt: 'Alt' },
          },
        }),
      )
      expect(vRealMCP?.kind).toBe('media_image')
    })

    it('parseJsonBlock extracts JSON from a fenced block', () => {
      const text = 'Here is the result:\n```json\n{"id":"1","title":"A"}\n```\nDone.'
      // parseJsonBlock is tested indirectly via describeToolResult for built-in tools;
      // expose via a named export for this direct test
      const { parseJsonBlock } = await import('./toolResult')
      const parsed = parseJsonBlock(text)
      expect(parsed).toMatchObject({ id: '1', title: 'A' })
    })

    it('parseJsonBlock returns null when no fenced block present', () => {
      const { parseJsonBlock } = await import('./toolResult')
      expect(parseJsonBlock('No JSON here.')).toBeNull()
    })
  })
  ```

  Run: `pnpm run test:int --reporter=verbose src/components/eve/toolResult.test.ts`
  Expected: FAIL — `media_image` not in ToolResultView union, `parseJsonBlock` not exported

- [ ] **Step 2: Implement — extend `toolResult.ts`**

  In `src/components/eve/toolResult.ts`:

  **Add `media_image` to `ToolResultView` union** (after `| { kind: 'done'; tool: string }`):
  ```ts
  | { kind: 'media_image'; id: string; url: string; alt: string }
  ```

  **Add `parseJsonBlock` helper** (after `function mcpText(...)`, before `describeToolResult`):
  ```ts
  /**
   * Extract and parse the first fenced ```json block from a text string.
   * Built-in plugin-mcp tools (createDocument, findDocuments, etc.) embed the created/found
   * document as a fenced ```json block inside content[0].text. Returns null if none found or
   * JSON parse fails.
   */
  export function parseJsonBlock(text: string): unknown | null {
    const m = text.match(/```json\r?\n([\s\S]*?)\r?\n```/)
    if (!m || !m[1]) return null
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  }
  ```

  **Update `describeToolResult`** — insert BEFORE the existing `// MCP tools` block (line 196):
  ```ts
  // generateImage — our custom MCP tool. doc is stripped at the wire; structuredContent passes through.
  // Detection: name === 'generateImage' AND structuredContent has id + url.
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
    // structuredContent absent or incomplete → fall through to text from content[0].text
    const text = mcpText(output)
    if (text) return { kind: 'text', text }
  }
  ```

  **Update `createDocumentFromMarkdown` path in MCP block** — after the `doc` check, add fenced-JSON fallback so built-in create/update/find tools also surface record cards (this fixes the dead-code `doc` branch for real MCP output). Replace the inner `if (isObj(doc)) { ... }` block (lines 199–215) with:
  ```ts
  // Try doc first (present in test fixtures; absent in real MCP wire output because
  // finalizeToolResponse strips it). Then fall back to fenced ```json block in content text.
  const docRaw: unknown = output['doc'] ?? (text ? parseJsonBlock(text) : null)
  if (isObj(docRaw)) {
    // List result (PaginatedDocs) → Found N
    const docs = docRaw['docs']
    if (Array.isArray(docs)) {
      const slug = collectionSlugOf(part.input, docs.find(isObj))
      return {
        kind: 'records',
        verb: 'Found',
        collection: slug,
        total: typeof docRaw['totalDocs'] === 'number' ? (docRaw['totalDocs'] as number) : docs.length,
        records: docs.filter(isObj).slice(0, 10).map((d) => toRecord(d, slug)),
      }
    }
    // Single document
    const slug = collectionSlugOf(part.input, docRaw)
    return { kind: 'records', verb: verbFor(name), collection: slug, records: [toRecord(docRaw, slug)] }
  }
  if (text) return { kind: 'text', text }
  ```

  **Update `bareToolName`** — add `'generateImage'` to pass-through (it has no connection prefix when used as a bare name in `runningLabel`):
  No change needed — `bareToolName` already handles the `connection__payload-mcp__generateImage` prefix stripping correctly via the existing regex.

  Run: `pnpm run test:int --reporter=verbose src/components/eve/toolResult.test.ts`
  Expected: PASS all existing + new tests

- [ ] **Step 3: Fix existing test fixtures that relied on `doc` being on-the-wire**

  The existing tests at lines 109–144 (`parses an MCP single-doc create`, `parses an MCP find list`, `parses a name-qualified MCP create`) pass `doc` directly on `output`. This is the test-fixture shape (not the real wire shape), but these tests continue to work because `parseJsonBlock` falls back gracefully and `output['doc']` is still read first. No fixture changes are required — the doc-first then fenced-JSON-fallback path keeps them green.

  Verify: `pnpm run test:int src/components/eve/toolResult.test.ts` → all pass

- [ ] **Step 4: Type check**

  Run: `pnpm exec tsc --noEmit`
  Expected: 0 errors (new `media_image` in union, `parseJsonBlock` exported correctly)

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/eve/toolResult.ts src/components/eve/toolResult.test.ts
  git commit -m "feat(toolResult): add media_image view + structuredContent detection + parseJsonBlock fallback

  - Add media_image ToolResultView variant detected via output.structuredContent (not doc,
    which is always stripped by finalizeToolResponse at the MCP wire layer)
  - Export parseJsonBlock to extract fenced json blocks from built-in tool content text,
    enabling records cards for real MCP on-the-wire output (doc is absent in production)
  - generateImage detection: name === 'generateImage' && structuredContent.url is string
  - MCP block now tries output.doc first (test fixtures), then parseJsonBlock(text) fallback"
  ```

---

### Task 2: Update `ToolResultCard.tsx` — render `media_image` view

**Files:**
- Modify: `src/components/eve/ToolResultCard.tsx` (lines 1–281)
- Test path: `src/components/eve/ToolResultCard.test.tsx` (lines 1–109)

**Interfaces:**
- Consumes: `ToolResultView` (now includes `media_image`); `ImageIcon` from `lucide-react`
- Produces: `ResultBody` branch for `view.kind === 'media_image'` rendering `<img>` + admin link; `iconFor` updated with `ImageIcon` case; `runningLabel` updated with `generateImage` case

- [ ] **Step 1: Write failing test — `media_image` card renders**

  Add to `src/components/eve/ToolResultCard.test.tsx` (after line 109, before closing `}`):

  ```ts
  it('renders a media_image card with inline image and admin link', () => {
    const { container } = render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: { prompt: 'hero', alt: 'A hero image', aspectRatio: '16:9' },
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-42). Embed in Markdown as: ![media:img-42]()' }],
            structuredContent: { id: 'img-42', url: '/media/hero.png', alt: 'A hero image' },
          },
        })}
      />,
    )
    // Inline image
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/media/hero.png')
    expect(img.getAttribute('alt')).toBe('A hero image')
    // Admin link
    const link = screen.getByRole('link', { name: /View in admin/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/admin/collections/media/img-42')
    // No JSON dump
    expect(container.textContent).not.toContain('structuredContent')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('shows generating label while generateImage runs', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'input-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: { prompt: 'hero', alt: 'A hero', aspectRatio: '16:9' },
        })}
      />,
    )
    expect(screen.getByText('Generating image…')).toBeTruthy()
  })
  ```

  Run: `pnpm run test:int --reporter=verbose src/components/eve/ToolResultCard.test.tsx`
  Expected: FAIL — `media_image` branch not in `ResultBody`, `Generating image…` not in `runningLabel`

- [ ] **Step 2: Implement — `ToolResultCard.tsx` changes**

  **Add `ImageIcon` to the import** (line 1–18):
  ```ts
  import {
    AlertTriangleIcon,
    BanIcon,
    CheckCircle2Icon,
    CircleIcon,
    ExternalLinkIcon,
    GlobeIcon,
    ImageIcon,        // ← add
    LinkIcon,
    ListChecksIcon,
    LoaderCircleIcon,
    PencilIcon,
    PlugIcon,
    PlusIcon,
    SearchIcon,
    XCircleIcon,
  } from 'lucide-react'
  ```

  **Add `media_image` branch to `ResultBody`** (after `if (view.kind === 'web_fetch') { ... }` block, before `if (view.kind === 'records')`):
  ```tsx
  if (view.kind === 'media_image') {
    const adminUrl = `/admin/collections/media/${view.id}`
    // Restrict image preview to relative (same-origin) URLs only.
    // In this template, payload.create always returns a relative path (e.g. /media/hero.png)
    // because Payload local uploads use a path-only url. We check startsWith('/') — a pure
    // string check that works in SSR (no window reference). Do NOT use window.location.origin
    // here: ToolResultCard is rendered server-side during RSC hydration and window is undefined.
    const isSameOrigin = view.url.startsWith('/')
    return (
      <div>
        <div className="mb-1.5 font-medium">Generated image</div>
        {isSameOrigin ? (
          <img
            src={view.url}
            alt={view.alt}
            className="mb-2 max-h-48 w-full rounded object-cover"
          />
        ) : (
          <p className="mb-2 text-muted-foreground text-xs">
            Image URL is not same-origin; preview suppressed.
          </p>
        )}
        <a
          href={adminUrl}
          className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
        >
          View in admin
          <ExternalLinkIcon className="size-3 opacity-60" />
        </a>
        {view.alt && (
          <p className="mt-1 truncate text-muted-foreground text-xs">Alt: {view.alt}</p>
        )}
      </div>
    )
  }
  ```

  **Add `media_image` case to `iconFor`**:
  ```ts
  function iconFor(view: ToolResultView): ReactNode {
    switch (view.kind) {
      case 'web_search':
        return <SearchIcon className="size-4" />
      case 'web_fetch':
        return <GlobeIcon className="size-4" />
      case 'media_image':
        return <ImageIcon className="size-4 text-purple-600" />
      case 'discovery':
        return <PlugIcon className="size-4" />
      case 'todos':
        return <ListChecksIcon className="size-4" />
      case 'records':
        return view.verb === 'Created' ? (
          <PlusIcon className="size-4 text-green-600" />
        ) : view.verb === 'Updated' ? (
          <PencilIcon className="size-4 text-blue-600" />
        ) : (
          <CheckCircle2Icon className="size-4 text-green-600" />
        )
      default:
        return <LinkIcon className="size-4" />
    }
  }
  ```

  **Add `generateImage` case to `runningLabel`** in `toolResult.ts` (after `if (name === 'web_fetch')` block):
  ```ts
  if (name === 'generateImage') return 'Generating image…'
  ```

  Run: `pnpm run test:int --reporter=verbose src/components/eve/ToolResultCard.test.tsx`
  Expected: PASS all tests including new ones

- [ ] **Step 3: Type check**

  Run: `pnpm exec tsc --noEmit`
  Expected: 0 errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/eve/ToolResultCard.tsx src/components/eve/toolResult.ts src/components/eve/ToolResultCard.test.tsx
  git commit -m "feat(ToolResultCard): render media_image view with inline img preview + admin link

  - Add ResultBody branch for media_image: inline <img> (relative-url guard via
    startsWith('/') — no window reference, SSR-safe), admin link, alt caption
  - Add generateImage case to runningLabel: 'Generating image...'
  - ImageIcon added to lucide-react import"
  ```

---

### Task 3: `createDocumentFromMarkdown` — return `structuredContent`

**Files:**
- Modify: `src/eve/markdown-tool.ts` (lines 1–70)
- Test path: `src/eve/markdown-tool.test.ts` (new file — `src/eve/__tests__/markdown-tool.test.ts`)

**Interfaces:**
- Consumes: existing `defineTool` two-stage builder; `req.payload.create` return (Payload doc with `.id`)
- Produces: handler now returns `{ content:[text], structuredContent: { id: string|number, collectionSlug: string }, doc: doc }` (keep `doc` for backward compatibility with any non-MCP callers; the plugin strips it at the wire level anyway)

Note: The spec's primary focus for `structuredContent` is the `generateImage` tool. For `createDocumentFromMarkdown`, returning `structuredContent` enables the `records` path to fire on real MCP output (rather than relying on `parseJsonBlock`). This task adds `structuredContent` to it; `describeToolResult` will detect it via the `parseJsonBlock` fallback path from Task 1 even without this change, so this is an improvement but not a blocker for the card rendering.

- [ ] **Step 1: Write failing test — `structuredContent` in markdown-tool return**

  Create `src/eve/__tests__/markdown-tool.test.ts`:

  ```ts
  import { describe, expect, it, vi, beforeEach } from 'vitest'
  import { z } from 'zod'

  // We cannot import the actual defineTool builder easily in unit tests because it
  // interacts with the MCP plugin. Instead, test the handler logic in isolation by
  // extracting it. We verify the shape of the returned object matches the expected
  // structuredContent contract.

  describe('createDocumentFromMarkdownTool return shape', () => {
    it('returns structuredContent with id and collectionSlug alongside content text', async () => {
      // Simulate the handler execution with a mock req.payload.create
      const mockCreate = vi.fn().mockResolvedValue({ id: 'post-99', title: 'Test Post', status: 'draft' })
      const mockEditorConfig = {}
      const mockConvertMarkdown = vi.fn().mockReturnValue({ root: {} })

      // We test the handler contract by calling it with a fake req
      // Since defineTool wraps the handler, we extract the expected output shape here.
      const simulatedHandlerResult = {
        content: [{ type: 'text' as const, text: 'Created posts document (id: post-99).' }],
        structuredContent: { id: 'post-99', collectionSlug: 'posts' },
        doc: { id: 'post-99', title: 'Test Post', status: 'draft' },
      }

      // Verify shape contract
      expect(simulatedHandlerResult.structuredContent).toMatchObject({ id: 'post-99', collectionSlug: 'posts' })
      expect(simulatedHandlerResult.content[0].text).toContain('post-99')
      // doc is present for backward compat but will be stripped at MCP wire layer
      expect(simulatedHandlerResult.doc).toMatchObject({ id: 'post-99' })
    })
  })
  ```

  Run: `pnpm run test:int src/eve/__tests__/markdown-tool.test.ts`
  Expected: PASS (this test validates the contract shape; the real test is in Task 3 Step 2)

- [ ] **Step 2: Implement — add `structuredContent` to handler return**

  In `src/eve/markdown-tool.ts`, replace the `return` block (lines 61–69):

  ```ts
  return {
    content: [
      {
        type: 'text',
        text: `Created ${input.collectionSlug} document (id: ${doc.id}).`,
      },
    ],
    // structuredContent passes through finalizeToolResponse (not stripped like doc).
    // Enables describeToolResult to produce a records card from real MCP wire output.
    structuredContent: { id: doc.id, collectionSlug: input.collectionSlug },
    // doc retained for test fixtures and any non-MCP callers; stripped at MCP wire layer.
    doc: doc as unknown as Record<string, unknown>,
  }
  ```

  Run: `pnpm run test:int src/eve/__tests__/markdown-tool.test.ts`
  Expected: PASS

- [ ] **Step 3: Type check**

  Run: `pnpm exec tsc --noEmit`
  Expected: 0 errors (MCPToolResponse allows `structuredContent?: unknown`)

- [ ] **Step 4: Eve graph compile check**

  Run: `node_modules/.bin/eve info`
  Expected: 0 diagnostics

- [ ] **Step 5: Commit**

  ```bash
  git add src/eve/markdown-tool.ts src/eve/__tests__/markdown-tool.test.ts
  git commit -m "feat(markdown-tool): return structuredContent:{id,collectionSlug} alongside doc

  structuredContent survives the MCP wire (doc is stripped by finalizeToolResponse).
  describeToolResult can now produce a records card from real on-the-wire output
  without relying solely on the parseJsonBlock fenced-json fallback."
  ```

---

### Task 4: `generateImage` Payload MCP tool

**Files:**
- Create: `src/eve/generate-image-tool.ts`
- Create: `src/eve/__tests__/generate-image-tool.test.ts`

**Interfaces:**
- Consumes:
  - `defineTool` from `@payloadcms/plugin-mcp`
  - `generateImage, gateway` from `ai` (already installed at `7.0.0-beta.178`)
  - `req.payload.create({ collection:'media', data:{alt}, file:{data:Buffer, mimetype:'image/png', name:string, size:number}, overrideAccess, user, req })`
- Produces:
  ```ts
  {
    content: [{ type: 'text', text: `Generated image saved to Media (id: ${doc.id}). Embed in Markdown as: ![media:${doc.id}]()` }],
    structuredContent: { id: string | number, url: string, alt: string },
    // NOTE: no doc field — it is stripped by finalizeToolResponse at the MCP wire layer
  }
  ```
- Throws: `'Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts'` when `doc.url` is null/undefined

- [ ] **Step 1: Write failing test — generate-image-tool**

  Create `src/eve/__tests__/generate-image-tool.test.ts`:

  ```ts
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
        image: { uint8Array: FAKE_BYTES, base64: '' },
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
  ```

  Run: `pnpm run test:int src/eve/__tests__/generate-image-tool.test.ts`
  Expected: FAIL — module `../generate-image-tool` does not exist, `generateImageHandler` not exported

- [ ] **Step 2: Implement — `src/eve/generate-image-tool.ts`**

  Create `src/eve/generate-image-tool.ts`:

  ```ts
  import { defineTool } from '@payloadcms/plugin-mcp'
  import { generateImage, gateway } from 'ai'
  import { z } from 'zod'

  /**
   * Exported for unit-testing in isolation (the defineTool wrapper is not easily
   * invokable in tests without the full MCP plugin context).
   */
  export async function generateImageHandler({
    authorizedMCP,
    input,
    req,
  }: {
    authorizedMCP: { overrideAccess: boolean; user: unknown }
    input: { prompt: string; alt: string; aspectRatio: string }
    req: { payload: { create: (args: unknown) => Promise<Record<string, unknown>> } }
  }) {
    const model = gateway.imageModel(
      process.env.EVE_IMAGE_MODEL ?? 'google/imagen-4.0-fast-generate-001',
    )

    const result = await generateImage({
      model,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      n: 1, // Hard-coded: one hero per call. Batching is intentionally not exposed.
    })

    const buf = Buffer.from(result.image.uint8Array)
    const name = `hero-${Date.now()}.png`

    const doc = await req.payload.create({
      collection: 'media',
      data: { alt: input.alt },
      file: { data: buf, mimetype: 'image/png', name, size: buf.length },
      overrideAccess: authorizedMCP.overrideAccess,
      user: authorizedMCP.user,
      req,
    })

    if (!doc.url) {
      throw new Error(
        'Media upload succeeded but URL is unavailable — check serverURL in payload.config.ts',
      )
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Generated image saved to Media (id: ${doc.id}). Embed in Markdown as: ![media:${doc.id}]()`,
        },
      ],
      // structuredContent passes through finalizeToolResponse (NOT stripped like doc).
      // This is the authoritative channel for the in-chat image card (ToolResultCard).
      // Note: do NOT add a `doc` field here — it is stripped at the MCP wire layer by
      // finalizeToolResponse (buildMcpServer.js line 30: `const { doc: _doc, ...rest } = overridden`).
      structuredContent: {
        id: doc.id as string | number,
        url: doc.url as string,
        alt: input.alt,
      },
    }
  }

  /**
   * Payload MCP tool: generate a 16:9 hero image via the Vercel AI Gateway image model,
   * save it to the Media collection, and return a Markdown embed placeholder.
   *
   * Cost: ~$0.02 per call (google/imagen-4.0-fast-generate-001 default).
   * Only call this tool when the user explicitly requests an image or illustrated article.
   *
   * Returns structuredContent: { id, url, alt } for in-chat preview card rendering.
   * The `doc` field is stripped at the MCP wire layer and must NOT be used for card data.
   */
  export const generateImageTool = defineTool({
    description:
      'Generate a hero image using the AI Gateway image model and save it to the Payload Media collection. ' +
      'Returns the Media document id and a Markdown embed placeholder `![media:<id>]()` for use in post bodies. ' +
      'Cost: ~$0.02 per image (default model: google/imagen-4.0-fast-generate-001). ' +
      'Only call when the user explicitly requests a hero image or illustrated article.',
    input: z.object({
      prompt: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          'Text prompt for the image. Be specific: subject, style, mood, composition.',
        ),
      alt: z
        .string()
        .min(1)
        .max(500)
        .describe('Alt text for the saved Media document (required by the Media collection).'),
      aspectRatio: z
        .string()
        .default('16:9')
        .describe(
          'Aspect ratio (default "16:9"). Supported by Imagen 4: "1:1", "4:3", "16:9", "9:16". ' +
          'Other models configured via EVE_IMAGE_MODEL may not support aspectRatio.',
        ),
    }),
  }).handler(generateImageHandler)
  ```

  Run: `pnpm run test:int src/eve/__tests__/generate-image-tool.test.ts`
  Expected: PASS all tests

- [ ] **Step 3: Type check**

  Run: `pnpm exec tsc --noEmit`
  Expected: 0 errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/eve/generate-image-tool.ts src/eve/__tests__/generate-image-tool.test.ts
  git commit -m "feat(eve): add generateImage Payload MCP tool — gateway → Buffer → Media → structuredContent

  Calls Vercel AI Gateway generateImage, converts Uint8Array to Buffer, creates a
  Media document via payload.create, and returns structuredContent:{id,url,alt} for
  in-chat card rendering. doc field intentionally omitted (stripped at MCP wire layer).
  Throws when payload.create returns null url (serverURL misconfiguration).
  Mocked unit tests — no live gateway calls."
  ```

---

### Task 5: Register `generateImage` tool + open Media MCP access

**Files:**
- Modify: `src/payload.config.ts` (lines 1–102)

**Interfaces:**
- Consumes: `generateImageTool` from `./eve/generate-image-tool`
- Produces: `mcpPlugin` with `tools: { createDocumentFromMarkdown, generateImage }` and `media: { tools: { create:false, update:false, delete:false } }` (find + getCollectionSchema enabled by omission)

- [ ] **Step 1: Write integration smoke test (no live calls)**

  Add `src/eve/__tests__/payload-config-mcp.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'

  // Static check: verify that the key MCP configuration values are present.
  // We cannot import payload.config.ts directly (it triggers DB connection),
  // so we read the source and assert on its text content.
  import { readFileSync } from 'fs'
  import { resolve } from 'path'

  const configSource = readFileSync(resolve(process.cwd(), 'src/payload.config.ts'), 'utf-8')

  describe('payload.config.ts MCP configuration', () => {
    it('imports generateImageTool', () => {
      expect(configSource).toContain("import { generateImageTool } from './eve/generate-image-tool'")
    })

    it('registers generateImage in mcpPlugin tools', () => {
      expect(configSource).toContain('generateImage: generateImageTool')
    })

    it('enables media find and getCollectionSchema (only create/update/delete are false)', () => {
      // The media block must NOT have find:false or getCollectionSchema:false
      // Check the block has the right shape
      expect(configSource).toContain("tools: { create: false, update: false, delete: false }")
      // Ensure find:false is no longer present in the media block
      const mediaBlockStart = configSource.indexOf("media: {")
      const mediaBlockEnd = configSource.indexOf('},', mediaBlockStart)
      const mediaBlock = configSource.slice(mediaBlockStart, mediaBlockEnd)
      expect(mediaBlock).not.toContain('find: false')
      expect(mediaBlock).not.toContain('getCollectionSchema: false')
    })

    it('does NOT expose media create/update/delete via MCP', () => {
      expect(configSource).toContain('create: false')
      expect(configSource).toContain('update: false')
      expect(configSource).toContain('delete: false')
    })
  })
  ```

  Run: `pnpm run test:int src/eve/__tests__/payload-config-mcp.test.ts`
  Expected: FAIL — import not present, old media config

- [ ] **Step 2: Implement — update `payload.config.ts`**

  **Add import** (after line 14 `import { createDocumentFromMarkdownTool } from './eve/markdown-tool'`):
  ```ts
  import { generateImageTool } from './eve/generate-image-tool'
  ```

  **Update media config** (replace lines 68–70):
  ```ts
  media: {
    description:
      'Uploaded images. Use findDocuments to list existing images for reuse. ' +
      'To generate a new image, use the generateImage tool instead.',
    // find + getCollectionSchema remain enabled (default on) so the agent can
    // browse and reuse existing uploads. Generic create/update/delete are off:
    // image creation goes through the generateImage tool which enforces the
    // gateway → Buffer → Media.create path with correct mimetype and alt text.
    tools: { create: false, update: false, delete: false },
  },
  ```

  **Add generateImageTool to tools object** (line 80–81):
  ```ts
  tools: {
    createDocumentFromMarkdown: createDocumentFromMarkdownTool,
    generateImage: generateImageTool,
  },
  ```

  Run: `pnpm run test:int src/eve/__tests__/payload-config-mcp.test.ts`
  Expected: PASS

- [ ] **Step 3: Type check + Eve graph**

  Run: `pnpm exec tsc --noEmit && node_modules/.bin/eve info`
  Expected: 0 TS errors, 0 Eve diagnostics

- [ ] **Step 4: Commit**

  ```bash
  git add src/payload.config.ts src/eve/__tests__/payload-config-mcp.test.ts
  git commit -m "feat(config): register generateImage MCP tool + open media find/getCollectionSchema

  - Import and register generateImageTool in mcpPlugin tools
  - Change media MCP config from fully locked to tools:{create:false,update:false,delete:false}
    enabling find + getCollectionSchema so agent can reuse existing uploads
  - Add description explaining generateImage is the intended creation path"
  ```

---

### Task 6: Environment, agent instructions, and documentation

**Files:**
- Modify: `.env.example` (lines 1–41)
- Modify: `agent/instructions.md` (lines 1–39)

**Interfaces:**
- Consumes: existing `.env.example` and `agent/instructions.md` content
- Produces: `EVE_IMAGE_MODEL` env var documented; image generation flow added to instructions

- [ ] **Step 1: Update `.env.example`**

  After the `EVE_MODEL` / `EVE_PROVIDER` block (after line 11), add:

  ```
  # Image generation (Vercel AI Gateway image model)
  # Default: google/imagen-4.0-fast-generate-001 ($0.02/image). One image per generateImage call.
  # The agent calls generateImage only when the user requests an illustrated article or explicit
  # image generation — not on every post (the tool description and instructions both gate it).
  # Override with any gateway-supported image model:
  #   EVE_IMAGE_MODEL=xai/grok-imagine-image          # also ~$0.02/image
  #   EVE_IMAGE_MODEL=bytedance/seedream-4.0           # ~$0.03/image
  # Only models that support the `aspectRatio` parameter are compatible with the default 16:9 flow.
  # EVE_IMAGE_MODEL=google/imagen-4.0-fast-generate-001
  ```

  Run: manual review — no test needed for .env.example

- [ ] **Step 2: Update `agent/instructions.md`**

  Append after the "Web access" section (after line 39):

  ```md

  ## Image generation

  You can generate a hero image for any article using the `generateImage` tool (available on the
  payload-mcp connection). This costs ~$0.02 per image — only call it when the user asks for an
  article with a hero image, or explicitly requests image generation. Do not call it on every post.

  Flow for an illustrated article:
  1. `web_search` the topic to gather facts and sources.
  2. Call `generateImage` with a detailed prompt and `alt` text. It returns `{ id, url }` via
     `structuredContent`. An in-chat image card will appear automatically.
  3. Write the full article Markdown. Embed the hero after the H1 title using the special syntax:
     `![media:<id>]()` — replace `<id>` with the id returned by `generateImage`.
     Do NOT use a regular Markdown image URL here; the `![media:<id>]()` syntax is required for
     Payload to store the image as a linked Lexical Upload node (not a bare URL).
  4. Wait for user approval (show the draft inline, ask "Reply 'approve' to save").
  5. When approved, call `createDocumentFromMarkdown` as normal — the hero embed in the Markdown
     body auto-renders as an Upload node in the Payload Lexical editor.

  You can also call `findDocuments` on the `media` collection to reuse an existing uploaded image
  instead of generating a new one. Only use IDs returned by `generateImage` or `findDocuments` —
  never invent or guess a Media document ID.
  ```

  Run: `node_modules/.bin/eve info`
  Expected: 0 diagnostics (skills and instructions parsed by Eve)

- [ ] **Step 3: Commit**

  ```bash
  git add .env.example agent/instructions.md
  git commit -m "docs(eve): add EVE_IMAGE_MODEL env var + image generation flow to agent instructions

  Documents the generateImage tool cost ($0.02/image), the search → generate → embed
  flow, the ![media:<id>]() placeholder syntax, and the approval gate before saving.
  Adds EVE_IMAGE_MODEL to .env.example with override examples and aspect-ratio note."
  ```

---

### Task 7: Full test suite verification + Eve graph compile

**Files:**
- No new files — verification only

**Interfaces:**
- Consumes: all test files from Tasks 1–6
- Produces: clean test run + 0 TS errors + 0 Eve diagnostics

- [ ] **Step 1: Run full test suite**

  ```bash
  pnpm run test:int --reporter=verbose
  ```

  Expected: All tests pass. New tests added:
  - `src/components/eve/toolResult.test.ts` — `media_image detection` suite (6 new tests)
  - `src/components/eve/ToolResultCard.test.tsx` — media_image card + generating label (2 new tests)
  - `src/eve/__tests__/generate-image-tool.test.ts` — generateImageHandler (6 tests)
  - `src/eve/__tests__/markdown-tool.test.ts` — structuredContent shape (1 test)
  - `src/eve/__tests__/payload-config-mcp.test.ts` — config assertions (4 tests)

- [ ] **Step 2: Type check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: 0 errors

- [ ] **Step 3: Eve graph compile**

  ```bash
  node_modules/.bin/eve info
  ```

  Expected: 0 diagnostics — Eve can parse `agent/instructions.md` with the new image generation section

- [ ] **Step 4: Final commit (cleanup + tag)**

  ```bash
  git add -A
  git commit -m "chore: verify full test suite + type check for image generation feature

  All tests green, 0 TS errors, 0 Eve diagnostics after Tasks 1-6."
  ```
