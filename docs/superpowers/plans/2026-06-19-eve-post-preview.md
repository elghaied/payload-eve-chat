# Eve Post Preview (artifact, approve-before-create) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before Eve creates a post, show the generated article as an editable side-panel artifact; the agent only writes it (via the existing MCP `createDocumentFromMarkdown` tool) after the user approves.

**Architecture:** A new native `proposePost` tool (echo, no write) makes the agent propose a draft; the client opens an editable side panel; on "Add it" the client sends an approval message that re-engages the agent to call the existing MCP create tool. MCP stays the only thing that writes a post.

**Tech Stack:** Vercel AI SDK v6 (`tool()`), React 19, shadcn UI (tabs/select/input/textarea/button), Streamdown (via `MessageResponse`), vitest.

**Design spec:** `docs/superpowers/specs/2026-06-19-eve-post-preview-design.md`

## Global Constraints

- **MCP stays the creator.** The post is written only by the existing MCP `createDocumentFromMarkdown` tool — never a separate REST endpoint or a client-side write. Do not delete `src/eve/markdown-tool.ts` and do not change `payload.config.ts`'s tool wiring.
- **`proposePost` performs no write** — its `execute` echoes its input.
- **Gate is a prompt rule:** for posts the agent must call `proposePost` first and `createDocumentFromMarkdown` only after the user approves, using the approved content verbatim.
- **Approval is a client→agent message** built by `buildApprovalMessage`, sent through the existing `useChat` flow with the same `{ conversationId }` body shape as a normal send.
- **Editable preview:** title (text), status (`draft`/`published` select), Markdown body (textarea) with an **Edit | Preview** tab toggle; Preview renders with `MessageResponse` (Streamdown).
- **Side panel** surface: `sidebar | chat | panel`; panel hidden when no active draft.
- **Test command:** `pnpm run test:int` (vitest, jsdom, auto-discovers `src/**/*.test.ts`). Typecheck: `pnpm exec tsc --noEmit`. Lint: `pnpm lint`.
- Tasks unaffected (still created with `createDocument`).

---

## File Structure

- `src/eve/propose-tool.ts` *(new)* — `proposePost` native tool (echo).
- `src/eve/propose-tool.test.ts` *(new)* — echo test.
- `src/eve/approval-message.ts` *(new)* — `PostDraft` type + `buildApprovalMessage(draft)`.
- `src/eve/approval-message.test.ts` *(new)* — builder test.
- `src/app/api/eve/route.ts` *(modify)* — merge `proposePost` into the tools map.
- `src/eve/system-prompt.ts` *(modify)* — posts: propose first, create only after approval, verbatim.
- `src/components/eve/PostPreviewPanel.tsx` *(new)* — the editable artifact panel.
- `src/components/eve/EveChat.tsx` *(modify)* — detect `tool-proposePost`, panel state, 3-pane layout, send approval on Add it.
- `README.md` *(modify)* — document the preview-before-create behavior.

---

## Task 1: `proposePost` tool + registration + prompt rule

**Files:**
- Create: `src/eve/propose-tool.ts`, `src/eve/propose-tool.test.ts`
- Modify: `src/app/api/eve/route.ts`, `src/eve/system-prompt.ts`

**Interfaces:**
- Produces: `proposePost` (Vercel AI SDK `tool`) with input `{ title: string; status: 'draft'|'published'; markdown: string }`; `execute` returns that same object (no I/O).

- [ ] **Step 1: Write the failing test**

Create `src/eve/propose-tool.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { proposePost } from './propose-tool'

describe('proposePost', () => {
  it('echoes the draft, performing no side effects', async () => {
    const draft = { title: 'Hello World', status: 'draft' as const, markdown: '# Hi\n\nBody.' }
    // AI SDK passes (input, { toolCallId, messages, abortSignal }); a stub is fine here.
    const out = await proposePost.execute!(draft, { toolCallId: 't1', messages: [] } as never)
    expect(out).toEqual(draft)
  })

  it('defaults status to draft', async () => {
    const parsed = proposePost.inputSchema.parse({ title: 'T', markdown: 'B' })
    expect(parsed.status).toBe('draft')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int -- src/eve/propose-tool.test.ts`
Expected: FAIL — `./propose-tool` cannot be resolved.

- [ ] **Step 3: Implement `src/eve/propose-tool.ts`**

```ts
import { tool } from 'ai'
import { z } from 'zod'

/**
 * Native (non-MCP) tool the agent calls to PROPOSE a post for the user to review.
 * It performs no write — it echoes the draft so the client can render an editable
 * preview. The post is only created after the user approves, when the agent calls
 * the MCP `createDocumentFromMarkdown` tool with the approved content.
 */
export const proposePost = tool({
  description:
    'Propose a new blog post for the user to review and approve before it is created. ' +
    'Use this FIRST for every post — it shows the user an editable preview and does NOT ' +
    'save anything. Only after the user approves (they will send an explicit "create this ' +
    'post" message with the final content) do you create it with createDocumentFromMarkdown, ' +
    'using the approved content verbatim.',
  inputSchema: z.object({
    title: z.string().describe('Post title'),
    status: z.enum(['draft', 'published']).default('draft'),
    markdown: z.string().describe('Post body as Markdown'),
  }),
  execute: async ({ title, status, markdown }) => ({ title, status, markdown }),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int -- src/eve/propose-tool.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Register the tool in `src/app/api/eve/route.ts`**

Add the import near the other `@/eve` imports:

```ts
import { proposePost } from '@/eve/propose-tool'
```

Find:

```ts
  const { tools, close } = await createPayloadMcpTools(eveConfig)
```

Replace with (merge the native tool alongside the MCP tools):

```ts
  const { tools: mcpTools, close } = await createPayloadMcpTools(eveConfig)
  const tools = { ...mcpTools, proposePost }
```

(`streamText({ ..., tools, ... })` already references `tools` — no further change there.)

- [ ] **Step 6: Update the prompt rule in `src/eve/system-prompt.ts`**

Change the authoring bullet so the agent *proposes* rather than creates. Find:

```
  invent a reasonable title and a few paragraphs of Markdown body — and create it
  (default status "draft"). Don't interrogate the user for details you can reasonably
```

Replace with:

```
  invent a reasonable title and a few paragraphs of Markdown body — and propose it
  (default status "draft"). Don't interrogate the user for details you can reasonably
```

Then replace the post-creation bullet. Find:

```
- To CREATE a post, use "createDocumentFromMarkdown" with collectionSlug "posts":
  put plain fields (title, status) in "data", and the rich-text body in "markdown"
  as { "content": "..." } written in Markdown. Do not use createDocument for posts.
```

Replace with:

```
- To CREATE a post: FIRST call "proposePost" with a title, status, and the body as
  "markdown". This shows the user an editable preview — it does NOT save. Do not call
  any create tool yet. Only AFTER the user approves (they will send an explicit
  "create this post" message containing the final content) do you call
  "createDocumentFromMarkdown" (collectionSlug "posts", plain fields like title/status
  in "data", body in "markdown" as { "content": "..." }). Use the approved
  title/status/Markdown EXACTLY as given — do not rewrite it. Never use createDocument
  for posts.
```

- [ ] **Step 7: Verify typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/eve/propose-tool.ts src/eve/propose-tool.test.ts src/app/api/eve/route.ts src/eve/system-prompt.ts
git commit -m "feat(eve): proposePost tool + prompt rule (propose posts, create only after approval)"
```

---

## Task 2: approval-message builder

**Files:**
- Create: `src/eve/approval-message.ts`, `src/eve/approval-message.test.ts`

**Interfaces:**
- Produces: `type PostDraft = { title: string; status: 'draft' | 'published'; markdown: string }` and `buildApprovalMessage(draft: PostDraft): string`.

- [ ] **Step 1: Write the failing test**

Create `src/eve/approval-message.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApprovalMessage } from './approval-message'

describe('buildApprovalMessage', () => {
  it('names the MCP tool and includes title, status, and the exact Markdown', () => {
    const md = '# Heading\n\nA paragraph with *emphasis*.'
    const msg = buildApprovalMessage({ title: 'My Post', status: 'published', markdown: md })
    expect(msg).toContain('createDocumentFromMarkdown')
    expect(msg).toContain('title: My Post')
    expect(msg).toContain('status: published')
    expect(msg).toContain(md) // verbatim body
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:int -- src/eve/approval-message.test.ts`
Expected: FAIL — `./approval-message` cannot be resolved.

- [ ] **Step 3: Implement `src/eve/approval-message.ts`**

```ts
export type PostDraft = { title: string; status: 'draft' | 'published'; markdown: string }

/**
 * The follow-up message the client sends when the user approves a proposed post.
 * It instructs the agent to create the post via the MCP `createDocumentFromMarkdown`
 * tool using the approved content verbatim. Sent through the normal chat flow.
 */
export function buildApprovalMessage(draft: PostDraft): string {
  return [
    'Approved — create this post now with createDocumentFromMarkdown, using this content exactly (do not change it):',
    `- title: ${draft.title}`,
    `- status: ${draft.status}`,
    '- markdown (content):',
    draft.markdown,
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test:int -- src/eve/approval-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eve/approval-message.ts src/eve/approval-message.test.ts
git commit -m "feat(eve): approval-message builder for approved posts"
```

---

## Task 3: `PostPreviewPanel` component

**Files:**
- Create: `src/components/eve/PostPreviewPanel.tsx`

**Interfaces:**
- Consumes: `PostDraft` (Task 2); `MessageResponse` from `@/components/ai-elements/message`; shadcn `Tabs`, `Select`, `Input`, `Textarea`, `Button`.
- Produces:
  ```ts
  const PostPreviewPanel: React.FC<{
    draft: PostDraft
    onApprove: (final: PostDraft) => void
    onClose: () => void
  }>
  ```

> Browser-only component — verified via typecheck/lint + manual (Task 4 Step 5), not unit-tested.

- [ ] **Step 1: Implement `src/components/eve/PostPreviewPanel.tsx`**

```tsx
'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MessageResponse } from '@/components/ai-elements/message'
import { XIcon } from 'lucide-react'
import type { PostDraft } from '@/eve/approval-message'

/**
 * Editable side-panel artifact for a proposed post. Holds local edits to title,
 * status, and Markdown; "Add it" hands the final draft back to the parent (which
 * re-engages the agent to create it via MCP). The panel itself writes nothing.
 */
export const PostPreviewPanel: React.FC<{
  draft: PostDraft
  onApprove: (final: PostDraft) => void
  onClose: () => void
}> = ({ draft, onApprove, onClose }) => {
  const [title, setTitle] = useState(draft.title)
  const [status, setStatus] = useState<PostDraft['status']>(draft.status)
  const [markdown, setMarkdown] = useState(draft.markdown)

  const canCreate = title.trim().length > 0 && markdown.trim().length > 0

  return (
    <aside className="flex w-[28rem] shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between border-b border-border p-3">
        <h2 className="font-medium text-sm">Post preview</h2>
        <Button aria-label="Close preview" onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-2 p-3">
        <Input
          aria-label="Post title"
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Post title"
          value={title}
        />
        <Select onValueChange={(v) => setStatus(v as PostDraft['status'])} value={status}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs className="flex min-h-0 flex-1 flex-col px-3" defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent className="min-h-0 flex-1" value="edit">
          <Textarea
            aria-label="Post Markdown body"
            className="h-full min-h-64 resize-none font-mono text-sm"
            onChange={(e) => setMarkdown(e.currentTarget.value)}
            placeholder="Write the post in Markdown…"
            value={markdown}
          />
        </TabsContent>
        <TabsContent className="min-h-0 flex-1 overflow-auto" value="preview">
          <MessageResponse>{markdown}</MessageResponse>
        </TabsContent>
      </Tabs>

      <footer className="flex justify-end gap-2 border-t border-border p-3">
        <Button onClick={onClose} variant="ghost">
          Discard
        </Button>
        <Button
          disabled={!canCreate}
          onClick={() => onApprove({ title: title.trim(), status, markdown })}
        >
          Add it
        </Button>
      </footer>
    </aside>
  )
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no type errors; no new lint errors for `PostPreviewPanel.tsx`. (If a shadcn export name differs, fix the import to match `src/components/ui/{tabs,select}.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/eve/PostPreviewPanel.tsx
git commit -m "feat(eve): editable PostPreviewPanel artifact (title/status/markdown + preview tabs)"
```

---

## Task 4: Wire the panel into `EveChat`

**Files:**
- Modify: `src/components/eve/EveChat.tsx`

**Interfaces:**
- Consumes: `PostPreviewPanel` (Task 3), `buildApprovalMessage` + `PostDraft` (Task 2); existing `useChat` `messages`/`sendMessage`; the `tool-proposePost` message part emitted by the native tool (Task 1).

> Browser-only integration — verified via typecheck/lint + the full unit suite + manual steps, not new unit tests.

- [ ] **Step 1: Add imports**

Near the other local imports in `src/components/eve/EveChat.tsx`:

```tsx
import { PostPreviewPanel } from './PostPreviewPanel'
import { buildApprovalMessage, type PostDraft } from '@/eve/approval-message'
```

Ensure `useEffect` and `useRef` are imported from React (the file already imports `useState`):

```tsx
import React, { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 2: Add panel state + draft detection**

After the `useChat({ ... })` call and the existing `assistantText` derivation, add:

```tsx
  // The post draft currently shown in the side panel (from a proposePost tool part).
  const [activeDraft, setActiveDraft] = useState<{ id: string; draft: PostDraft } | null>(null)
  // The proposePost call id we've already surfaced, so re-renders don't reopen it
  // after the user closes the panel.
  const handledProposeIdRef = useRef<string | undefined>(undefined)

  // Open the panel when the agent proposes a post.
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j] as { type: string; toolCallId?: string; input?: unknown; output?: unknown }
        if (p.type !== 'tool-proposePost') continue
        const id = p.toolCallId ?? `${i}-${j}`
        const draft = (p.output ?? p.input) as PostDraft | undefined
        if (draft && id !== handledProposeIdRef.current) {
          handledProposeIdRef.current = id
          setActiveDraft({ id, draft })
        }
        return
      }
    }
  }, [messages])

  const handleApprovePost = (final: PostDraft) => {
    // Re-engage the agent to create the post via MCP, using the approved content.
    sendMessage({ text: buildApprovalMessage(final) }, { body: { conversationId } })
    setActiveDraft(null)
  }
```

- [ ] **Step 3: Render the panel (3rd pane) and a re-open affordance**

In the message `parts.map(...)`, add a branch for the proposePost part (alongside the existing `dynamic-tool` branch) so it shows a compact affordance instead of raw tool JSON:

```tsx
                      if (part.type === 'tool-proposePost') {
                        const tp = part as { toolCallId?: string; input?: unknown; output?: unknown }
                        const draft = (tp.output ?? tp.input) as PostDraft | undefined
                        return (
                          <button
                            className="text-left text-muted-foreground text-sm underline-offset-2 hover:text-foreground hover:underline"
                            key={`${messageKey}-${i}`}
                            onClick={() =>
                              draft &&
                              setActiveDraft({ id: tp.toolCallId ?? `${messageKey}-${i}`, draft })
                            }
                            type="button"
                          >
                            📝 Drafted a post{draft?.title ? ` — "${draft.title}"` : ''} — review it →
                          </button>
                        )
                      }
```

Then render the panel as the third flex child of the `.eve-scope` row. Find the closing of the chat column and the root `</div>`:

```tsx
        </PromptInput>
      </div>
    </div>
    </TooltipProvider>
```

Replace with (insert the panel between the chat column's `</div>` and the root `</div>`):

```tsx
        </PromptInput>
      </div>
      {activeDraft && (
        <PostPreviewPanel
          draft={activeDraft.draft}
          onApprove={handleApprovePost}
          onClose={() => setActiveDraft(null)}
        />
      )}
    </div>
    </TooltipProvider>
```

- [ ] **Step 4: Verify typecheck, lint, and unit suite**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm run test:int`
Expected: no type/lint errors; all unit tests pass (the new `propose-tool`/`approval-message` tests included). The pre-existing `tests/int/api.int.spec.ts` needs a live MongoDB — ignore it if it times out in this environment.

- [ ] **Step 5: Manual verification (documented; needs the running app + an LLM)**

1. Start the stack (`docker compose up -d`, then the app) and open `/admin/eve`.
2. Ask: "write a post about our launch". Confirm: Eve calls `proposePost`, the **side panel opens** on the right with a title, status, and the Markdown (no post created yet — `/admin/collections/posts` still empty).
3. Edit the title and body; switch **Edit ↔ Preview** and confirm the preview renders the Markdown.
4. Click **Add it**. Confirm: an approval message is sent, Eve then calls `createDocumentFromMarkdown`, the chat shows the create tool result, and the post now exists in `/admin/collections/posts` with your edited content.
5. Ask for another post and click **Discard**; confirm no post is created and the panel closes.
6. Confirm the proposePost line in the transcript re-opens the panel when clicked.

- [ ] **Step 6: Commit**

```bash
git add src/components/eve/EveChat.tsx
git commit -m "feat(eve): side-panel post preview — open on proposePost, approve to create via MCP"
```

---

## Task 5: Document the feature

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short subsection under the Eve section**

Add after the "MCP authentication" subsection (before `## Voice`):

```markdown
### Post preview (approve before create)

When you ask Eve to create a post, it doesn't write it immediately — it calls a
`proposePost` tool that opens an **editable side panel** (title, status, and the
Markdown body with an Edit/Preview toggle). Nothing is saved until you click
**Add it**, which tells Eve to create the post via the MCP `createDocumentFromMarkdown`
tool using your approved content; **Discard** writes nothing. Tasks are still created
directly. See `docs/superpowers/specs/2026-06-19-eve-post-preview-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Eve post preview (approve-before-create)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §4.1 proposePost → Task 1; §4.2 register tool → Task 1 Step 5; §4.3 keep MCP create → enforced (no deletion; constraint stated); §4.4 system prompt → Task 1 Step 6; §4.5 approval signal → Task 2 + Task 4 Step 2; §4.6 PostPreviewPanel → Task 3; §4.7 EveChat integration (detect part, 3-pane, affordance) → Task 4; §6 error handling → Task 3 (Add-it disabled until non-empty) + existing MCP tool UI; §7 testing → Tasks 1–2 unit + Task 4 manual; §8 file list → all covered; §9 out-of-scope respected (create-only, no endpoint, no WYSIWYG).
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `PostDraft` defined in `approval-message.ts` (Task 2) and imported by `PostPreviewPanel` (Task 3) and `EveChat` (Task 4); `proposePost` input shape `{title,status,markdown}` (Task 1) matches the `PostDraft` fields and the `tool-proposePost` part's `input`/`output` read in Task 4; `buildApprovalMessage(PostDraft)` (Task 2) matches `handleApprovePost`'s call (Task 4); panel props `{draft,onApprove,onClose}` (Task 3) match the `<PostPreviewPanel>` usage (Task 4).
