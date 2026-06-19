# Eve Post Preview (artifact, approve-before-create) — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — ready for implementation plan
**Goal:** Before Eve creates a post, show the generated article as an editable side-panel artifact and only write it to Payload after the user approves.

---

## 1. Summary

Today Eve creates posts directly: the model calls the MCP tool
`createDocumentFromMarkdown`, which runs server-side mid-stream and writes the
post immediately — the user never sees it first. This feature inserts a
**propose → preview → approve → create** step for posts:

- The agent proposes a draft via a new tool that performs **no write**.
- The chat opens a **side-panel artifact** (Claude.ai-style) showing the post's
  title, status, and Markdown body — **editable**.
- The post is created only when the user clicks **Create**, via a dedicated
  endpoint. **Discard** writes nothing.

Post creation is **always** gated this way; tasks are unaffected (still created
directly).

## 2. Requirements (decided during brainstorming)

- **Always gate** post creation behind preview+approve (the agent never writes a
  post directly).
- **Editable** preview: the user can change the title, status, and Markdown body
  before approving.
- **Side panel** surface (artifact slides in on the right; chat stays on the left).
- **Editor:** title input + status select (`draft`/`published`) + Markdown
  textarea with an **Edit | Preview** tab toggle (Preview renders via Streamdown,
  already a dependency).
- **Mechanism:** Approach A — a native `proposePost` tool (echo, no write) plus a
  commit endpoint (`POST /api/eve/posts`). Not AI-SDK tool-approval (awkward to
  edit MCP-bound args) and not text-marker parsing (fragile).
- Voice flow unchanged; Eve's spoken `<speak>` summary can point the user to the
  panel.

## 3. Architecture

```
ask ─► agent calls proposePost({title,status,markdown})   (NATIVE tool, NO write)
        │  execute echoes the draft back
        ▼
   assistant message gets a proposePost tool part
        ▼
EveChat detects it ─► opens PostPreviewPanel (right side), fields prefilled + editable
        │
        ├─ Discard ─► close panel, nothing written
        └─ Create  ─► POST /api/eve/posts { title, status, markdown }
                         │  payload.auth() gate
                         ▼  src/eve/post-create.ts
                      convertMarkdownToLexical + payload.create
                         ▼
                      { id, adminUrl } ─► panel shows "Created ✓ open in admin"
```

**Boundaries:**
- **`proposePost`** decouples *generation* (the model authors the article) from
  *persistence* (an explicit user action). It never touches the DB.
- **`POST /api/eve/posts`** is the only path that writes a post, gated by
  `payload.auth()` exactly like the other Eve routes.
- **`src/eve/post-create.ts`** is the single source of post creation
  (Markdown→Lexical + `payload.create`), reused from the endpoint.
- **`PostPreviewPanel`** owns the editing UI and the create/discard calls; it
  receives a draft and reports success/failure. It does not know about the agent
  or tools.

## 4. Component design

### 4.1 Post creation core (`src/eve/post-create.ts`, new)

Server-only. Factor the Markdown→Lexical + create logic (currently inside
`markdown-tool.ts`) into one function:

```ts
import type { Payload, TypedUser } from 'payload'

export async function createPostFromMarkdown(args: {
  title: string
  status: 'draft' | 'published'
  markdown: string
  payload: Payload
  user: TypedUser
}): Promise<{ id: string }>
```

- Builds `content` via `convertMarkdownToLexical({ editorConfig, markdown })` with
  `editorConfigFactory.default({ config: payload.config })`.
- `payload.create({ collection: 'posts', data: { title, status, content }, user, overrideAccess: false })`.
- Returns `{ id: String(doc.id) }`.

### 4.2 Commit endpoint (`src/app/api/eve/posts/route.ts`, new)

`POST`:
1. `getPayload`, `payload.auth({ headers })`; 401 when `!user`, 403 when
   `user.collection !== 'users'` (same gate as the chat/voice routes).
2. Parse `{ title, status, markdown }`; 400 if `title` or `markdown` is empty;
   default `status` to `draft` if missing/invalid.
3. `const { id } = await createPostFromMarkdown({ ...body, payload, user })`.
4. Respond `Response.json({ id, adminUrl: \`/admin/collections/posts/${id}\` })`.
5. On error: `payload.logger.error({ msg: 'Eve post create failed', err })` → 500
   `{ error: 'Could not create the post' }`.

### 4.3 `proposePost` tool (`src/eve/propose-tool.ts`, new)

A **native** Vercel AI SDK tool (not MCP), added to the `streamText` `tools` map
in `route.ts` alongside the MCP tools:

```ts
import { tool } from 'ai'
import { z } from 'zod'

export const proposePost = tool({
  description:
    'Propose a new blog post for the user to review and approve before it is created. ' +
    'Use this for ALL post creation — never create a post directly. The user sees an ' +
    'editable preview and approves it; this tool itself does NOT save anything.',
  inputSchema: z.object({
    title: z.string().describe('Post title'),
    status: z.enum(['draft', 'published']).default('draft'),
    markdown: z.string().describe('Post body as Markdown'),
  }),
  execute: async ({ title, status, markdown }) => ({ title, status, markdown }),
})
```

The echoed result is what the client renders. (Its execute does no I/O, so it's
trivially testable.)

### 4.4 Disable the agent's direct post-create

So the gate cannot be bypassed (the agent must have **no** tool that writes a post
directly):
- `payload.config.ts`: remove the `createDocumentFromMarkdown` tool registration
  from the MCP plugin `tools` map. Posts was its only allowed collection, so it has
  no remaining use; delete `src/eve/markdown-tool.ts` (and its `post-tool`-era
  references). If a future Lexical collection needs agent-driven create, re-add a
  tool for it then — out of scope here.
- `payload.config.ts`: the posts MCP config already disables the builtin `create`
  (`posts: { tools: { create: false, delete: false } }`) — keep it. With the
  custom tool gone and builtin create off, the only post-writing path is
  `POST /api/eve/posts` behind the panel.

### 4.5 System prompt (`src/eve/system-prompt.ts`)

Replace the "to CREATE a post use createDocumentFromMarkdown" guidance with:
- "To create a post, call `proposePost` with a `title`, `status`, and the body as
  `markdown`. This shows the user an editable preview to approve — it does not
  save. Never try to create a post any other way."
- Keep the "generate a sensible draft for vague requests" behavior (the agent
  still authors the content; it just proposes instead of writing).
- Tasks: unchanged (`createDocument` for tasks).

### 4.6 Preview panel (`src/components/eve/PostPreviewPanel.tsx`, new)

Client component. Props:

```ts
type Draft = { title: string; status: 'draft' | 'published'; markdown: string }
type PostPreviewPanelProps = {
  draft: Draft
  onClose: () => void          // Discard / close
  onCreated: (result: { id: string; adminUrl: string }) => void
}
```

- Local editable state seeded from `draft` (title input, status `Select`, Markdown
  `textarea`).
- **Edit | Preview** tabs: Edit shows the textarea; Preview renders the current
  Markdown with `Streamdown` (same renderer as chat messages).
- **Create** button → `POST /api/eve/posts` with the current fields; while
  pending, disabled + spinner; on success call `onCreated` and show a "Created ✓
  — Open in admin" link (`adminUrl`); on failure show the error inline and keep
  the draft for retry.
- **Discard** → `onClose`.
- Rendered with the existing shadcn UI primitives, inside `.eve-scope`.

### 4.7 `EveChat.tsx` integration

- Watch messages for a `proposePost` tool part (it arrives as a dynamic/native
  tool part). When the latest one appears, set it as the active draft and open the
  panel. (Tool parts already stream into `messages`.)
- Layout: wrap the existing chat column and the panel in a flex row; the panel
  occupies a right column (e.g. `w-[28rem]`, hidden when no active draft). Sidebar
  stays on the far left → sidebar | chat | panel.
- On `onCreated`, append a short confirmation to the chat (client-side info line
  or a system note) and close the panel. On `onClose`, just close.
- The proposePost tool part itself renders as a compact "Drafted a post — review
  it →" affordance in the message flow (clicking re-opens the panel if closed),
  rather than the raw tool JSON.

## 5. Data flow (one post)

1. User asks for a post → model calls `proposePost({title,status,markdown})`.
2. Tool echoes the draft → arrives as a tool part in the assistant message.
3. EveChat opens `PostPreviewPanel` with the draft.
4. User edits, clicks **Create** → `POST /api/eve/posts`.
5. Endpoint converts Markdown→Lexical, creates the post, returns `{ id, adminUrl }`.
6. Panel shows success + admin link; chat gets a confirmation; panel closes.
   (**Discard** at step 3–4 writes nothing.)

## 6. Error handling

- **Create failure** (conversion/DB/network): panel shows the error, keeps the
  edited draft so the user can retry; route logs via `payload.logger.error`.
- **Unauthorized:** endpoint returns 401/403; panel surfaces it.
- **Empty title/markdown:** endpoint 400; the Create button is also disabled
  client-side until both are non-empty.
- **Agent bypass:** with no direct post-create tool, the model cannot write a post
  without the panel.

## 7. Testing

Unit tests (vitest), matching the existing route/lib tests:
- **`createPostFromMarkdown`** — with a mocked `payload`, asserts it converts the
  Markdown (content becomes a Lexical object, not a string) and calls
  `payload.create` with `collection: 'posts'`, the title/status, and
  `overrideAccess: false` + user.
- **`POST /api/eve/posts`** — `vi.hoisted` mocks (payload/auth/config/post-create):
  401 (no user), 403 (non-users), 400 (empty title or markdown), 200 (returns
  `{ id, adminUrl }`), 500 (create throws → logged).
- **`proposePost`** — `execute` returns its input unchanged (no I/O).

Browser-only (manual): the panel UI, the Edit/Preview tabs, opening on a
`proposePost` tool part, Create/Discard, and the 3-pane layout.

## 8. New / changed files

- `src/eve/post-create.ts` — `createPostFromMarkdown`. *(new)*
- `src/eve/post-create.test.ts` — conversion/create test. *(new)*
- `src/app/api/eve/posts/route.ts` — commit endpoint. *(new)*
- `src/app/api/eve/posts/route.test.ts` — endpoint tests. *(new)*
- `src/eve/propose-tool.ts` — `proposePost` native tool. *(new)*
- `src/eve/propose-tool.test.ts` — echo test. *(new)*
- `src/app/api/eve/route.ts` — register `proposePost` in `tools`. *(modify)*
- `src/eve/system-prompt.ts` — posts → `proposePost`. *(modify)*
- `src/eve/markdown-tool.ts` — delete (posts was its only use). *(delete)*
- `src/payload.config.ts` — remove the `createDocumentFromMarkdown` tool
  registration; keep posts' builtin `create: false`. *(modify)*
- `src/components/eve/PostPreviewPanel.tsx` — the artifact panel. *(new)*
- `src/components/eve/EveChat.tsx` — detect `proposePost`, panel state, 3-pane
  layout, confirmation. *(modify)*

## 9. Out of scope (YAGNI)

- Editing/previewing existing posts (this is create-only).
- Preview for tasks or other collections.
- A full WYSIWYG editor (Markdown source + rendered preview only).
- Persisting drafts server-side before approval (the draft lives in the client
  until Create).
- Diffing or version history.
