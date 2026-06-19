# Eve Post Preview (artifact, approve-before-create) — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — ready for implementation plan
**Goal:** Before Eve creates a post, show the generated article as an editable side-panel artifact; the agent only writes it (via the existing MCP create tool) after the user approves.

---

## 1. Summary

Today Eve creates posts directly: the model calls the MCP tool
`createDocumentFromMarkdown`, which runs server-side mid-stream and writes the
post immediately — the user never sees it first. This feature inserts a
**propose → preview → approve → create** step for posts, **without** changing how
the post is ultimately written (still the MCP tool):

- The agent proposes a draft via a new `proposePost` tool that performs **no write**.
- The chat opens an **editable side-panel artifact** (Claude.ai-style) with the
  post's title, status, and Markdown body.
- On **Add it**, the client re-engages the agent, which calls the existing MCP
  `createDocumentFromMarkdown` tool to actually create the post. **Discard** writes
  nothing.

The "gate" is a system-prompt rule: for posts the agent must `proposePost` first
and only `createDocumentFromMarkdown` **after** the user approves. MCP remains the
creation mechanism. Tasks are unaffected.

## 2. Requirements (decided during brainstorming)

- **Preview + approve** before any post is created; the agent proposes first.
- **Editable** preview: title, status, and Markdown body before approving.
- **Side panel** surface (artifact on the right; chat on the left).
- **Editor:** title input + status select (`draft`/`published`) + Markdown textarea
  with an **Edit | Preview** tab toggle (Preview renders via Streamdown).
- **MCP stays the creator.** The post is written by the existing MCP
  `createDocumentFromMarkdown` tool — NOT a separate REST endpoint and NOT a
  client-side write. Approval re-engages the agent to call that tool.
- Voice flow unchanged; Eve's spoken `<speak>` summary can point to the panel.

**Accepted trade-off:** on approval the (possibly edited) content rides back to the
agent, which passes it to the MCP tool. The prompt instructs the agent to use the
approved content verbatim; strong models honor this and qwen3 usually does. (A
hard, model-independent guarantee would require a direct endpoint, which the user
explicitly rejected in favor of keeping MCP as the creator.)

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
        └─ Add it ─► sendMessage("approved, create exactly this", final fields) + close
                         ▼
                   agent calls MCP createDocumentFromMarkdown(posts, data+markdown)
                         ▼
                   /api/mcp ─► payload.create ─► post created
                         ▼
                   chat shows the create tool call + Eve's confirmation (+ admin link)
```

**Boundaries:**
- **`proposePost`** decouples *authoring* (model writes the article) from
  *persistence*; it never touches the DB.
- **Approval** is a client→agent signal (a follow-up message carrying the final
  fields) that resumes generation.
- **`createDocumentFromMarkdown`** (existing MCP tool) remains the only thing that
  writes a post — unchanged.
- **`PostPreviewPanel`** owns the editing UI; on Add it it sends the approval
  message and closes. It does not write anything itself.

## 4. Component design

### 4.1 `proposePost` tool (`src/eve/propose-tool.ts`, new)

A **native** Vercel AI SDK tool (not MCP), added to the `streamText` `tools` map in
`route.ts` alongside the MCP tools:

```ts
import { tool } from 'ai'
import { z } from 'zod'

export const proposePost = tool({
  description:
    'Propose a new blog post for the user to review and approve before it is created. ' +
    'Use this FIRST for every post — it shows the user an editable preview and does ' +
    'NOT save anything. Only after the user approves do you create the post with ' +
    'createDocumentFromMarkdown, using the approved content verbatim.',
  inputSchema: z.object({
    title: z.string().describe('Post title'),
    status: z.enum(['draft', 'published']).default('draft'),
    markdown: z.string().describe('Post body as Markdown'),
  }),
  execute: async ({ title, status, markdown }) => ({ title, status, markdown }),
})
```

The echoed result is what the client renders. Its execute does no I/O (trivially
testable).

### 4.2 Register the tool (`src/app/api/eve/route.ts`)

Merge `proposePost` into the tools passed to `streamText` alongside the MCP tools:

```ts
const { tools: mcpTools, close } = await createPayloadMcpTools(eveConfig)
const tools = { ...mcpTools, proposePost }
```

No other route changes; `createDocumentFromMarkdown` continues to arrive via
`mcpTools` and remains the creator.

### 4.3 Keep the MCP create path

- `src/eve/markdown-tool.ts` and its registration in `src/payload.config.ts` stay
  as-is — `createDocumentFromMarkdown` is still how posts get written.
- Posts' builtin MCP `create` stays disabled (`posts: { tools: { create: false,
  delete: false } }`); the agent creates posts only through
  `createDocumentFromMarkdown`, after approval.

### 4.4 System prompt (`src/eve/system-prompt.ts`)

Replace the current "to CREATE a post, use createDocumentFromMarkdown" guidance
with a two-step rule:

- "To create a post: FIRST call `proposePost` with a `title`, `status`, and the
  body as `markdown`. This shows the user an editable preview — it does NOT save.
  Do not call any create tool yet."
- "Only AFTER the user approves (they will send an explicit 'create this post'
  message with the final content) do you call `createDocumentFromMarkdown`
  (collectionSlug `posts`, plain fields in `data`, body in `markdown` as
  `{ content }`). Use the approved title/status/Markdown EXACTLY as given — do not
  rewrite it."
- Keep "generate a sensible draft for vague requests" (the agent still authors the
  content; it just proposes first).
- Tasks: unchanged (`createDocument` for tasks).

### 4.5 Approval signal (client → agent)

On **Add it**, `PostPreviewPanel` calls the chat's `sendMessage` with a concise
instruction carrying the final (edited) fields, e.g.:

```
Approved — create this post now with createDocumentFromMarkdown, using this content
exactly (do not change it):
- title: <title>
- status: <status>
- markdown (content): <markdown>
```

This is sent through the existing `useChat` flow (same `conversationId`/`voice`
body). The agent then calls `createDocumentFromMarkdown`, and the normal chat
rendering shows the tool call + result + Eve's confirmation. The panel closes on
send. (The message is verbose by design so the agent has the exact content.)

### 4.6 Preview panel (`src/components/eve/PostPreviewPanel.tsx`, new)

Client component. Props:

```ts
type Draft = { title: string; status: 'draft' | 'published'; markdown: string }
type PostPreviewPanelProps = {
  draft: Draft
  onApprove: (final: Draft) => void   // -> EveChat sends the approval message, closes
  onClose: () => void                  // Discard / close
}
```

- Local editable state seeded from `draft`: title input, status `Select`, Markdown
  `textarea`.
- **Edit | Preview** tabs: Edit shows the textarea; Preview renders the current
  Markdown with `Streamdown` (same renderer as chat messages).
- **Add it** → `onApprove(currentFields)`; disabled while title or markdown is
  empty.
- **Discard** → `onClose`.
- Built with existing shadcn primitives, inside `.eve-scope`.

The panel does not call any network itself — creation happens through the agent.

### 4.7 `EveChat.tsx` integration

- Watch messages for the latest `proposePost` tool part; set it as the active draft
  and open the panel. (Tool parts already stream into `messages`.)
- Layout: wrap the chat column and the panel in a flex row; the panel is a right
  column (e.g. `w-[28rem]`), hidden when there's no active draft. Result:
  sidebar | chat | panel.
- `onApprove(final)` → `sendMessage({ text: approvalText(final) }, { body: {
  conversationId, voice: false } })`, then clear the active draft (close panel).
- `onClose` → clear the active draft.
- The `proposePost` tool part renders in the message flow as a compact "Drafted a
  post — review it →" affordance (clicking re-opens the panel if it was closed),
  not raw tool JSON. The subsequent `createDocumentFromMarkdown` tool part renders
  with the existing tool UI (shows the created doc).

## 5. Data flow (one post)

1. User asks for a post → model calls `proposePost({title,status,markdown})`.
2. Tool echoes the draft → arrives as a tool part → EveChat opens the panel.
3. User edits, clicks **Add it** → EveChat sends the approval message and closes
   the panel.
4. Agent calls `createDocumentFromMarkdown` (MCP) with the approved content →
   `/api/mcp` → `payload.create` → post created.
5. Chat shows the create tool call + result + Eve's confirmation (admin link from
   the tool result). (**Discard** before step 3 writes nothing.)

## 6. Error handling

- **Create failure** (conversion/DB) surfaces the normal way — the MCP tool result
  shows the error in the chat tool UI; the user can ask Eve to retry. (Unchanged
  from today's behavior.)
- **Empty title/markdown:** the **Add it** button is disabled until both are
  non-empty.
- **Model doesn't honor "verbatim":** mitigated by the explicit instruction;
  acceptable per §2 trade-off.
- **Auth:** unchanged — the create still flows through the authenticated `/api/eve`
  → `/api/mcp` path.

## 7. Testing

Unit tests (vitest):
- **`proposePost`** — `execute` returns its input unchanged (no I/O).
- **approval-message builder** — a small pure helper `buildApprovalMessage(draft)`
  (extracted so it's testable) produces a string containing the title, status, and
  the exact Markdown.

Browser-only (manual): the panel UI + Edit/Preview tabs; opening on a `proposePost`
tool part; **Add it** sending the approval and the agent then creating via MCP;
**Discard**; the 3-pane layout. (The create path itself is the existing,
already-working MCP flow.)

## 8. New / changed files

- `src/eve/propose-tool.ts` — `proposePost` native tool. *(new)*
- `src/eve/propose-tool.test.ts` — echo test. *(new)*
- `src/eve/approval-message.ts` — `buildApprovalMessage(draft)` helper. *(new)*
- `src/eve/approval-message.test.ts` — builder test. *(new)*
- `src/app/api/eve/route.ts` — merge `proposePost` into `tools`. *(modify)*
- `src/eve/system-prompt.ts` — posts: propose first, create only after approval,
  verbatim. *(modify)*
- `src/components/eve/PostPreviewPanel.tsx` — the artifact panel. *(new)*
- `src/components/eve/EveChat.tsx` — detect `proposePost`, panel state + 3-pane
  layout, send the approval message on Add it. *(modify)*

(`src/eve/markdown-tool.ts` and `src/payload.config.ts` are **unchanged** —
`createDocumentFromMarkdown` stays the creator.)

## 9. Out of scope (YAGNI)

- Editing/previewing existing posts (create-only).
- Preview for tasks or other collections.
- A full WYSIWYG editor (Markdown source + rendered preview only).
- Persisting drafts server-side before approval (the draft lives in the client
  until approval).
- A hard, model-independent create guarantee (would need a direct endpoint, which
  was rejected to keep MCP as the creator).
