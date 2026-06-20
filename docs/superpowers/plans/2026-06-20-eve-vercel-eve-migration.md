# Eve → Vercel Eve Framework Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this project's Vercel-AI-SDK chat agent with one built on the Vercel **Eve** framework (`vercel/eve`), embedded in the existing Payload/Next.js app, operating Posts & Tasks through the unchanged Payload MCP server, deployed on Vercel.

**Architecture:** Run `eve init .` to add an `agent/` project to this repo. `withEve()` mounts Eve's HTTP channel (`/eve/v1/session*`) onto the app's own origin. The agent uses an AI Gateway model and reaches Posts/Tasks via an Eve **MCP client connection** to Payload's existing `/api/mcp`. A custom Eve channel `AuthFn` bridges Payload admin-cookie auth (admin-only preserved). The `/admin/eve` React view swaps `useChat` for Eve's `useEveAgent` hook. A thin `Conversations` index keeps the history sidebar.

**Tech Stack:** Payload CMS v4 (canary), Next.js (App Router), React 19, TypeScript 6, `eve` (beta), `@payloadcms/plugin-mcp`, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-20-eve-vercel-eve-migration-design.md`

## Global Constraints

- **Scope this plan:** core chat + Posts/Tasks over MCP only. Do **not** wire post-preview (`proposePost`), web search (`webSearch`/`readUrl`), voice (STT/TTS), or a Sandbox tool. Their source files stay in the tree but are left unwired.
- **Admin-only:** every path that reaches the agent must reject non-admins and API-key principals (`user.collection === 'users'` is the only accepted principal), reproducing the old `/api/eve` guard exactly.
- **Payload MCP server is unchanged.** Do not edit the MCP plugin config, the Posts/Tasks collections, or the MCP write surface.
- **Eve is beta** (`eve@0.11.x` at time of writing). **Task 1 pins the exact installed version and the real API surface**; later tasks that reference Eve symbols must match Task 1's findings file — if a documented signature differs from the installed package's types, the installed package wins, and you update the step accordingly.
- **Default model:** `anthropic/claude-sonnet-4-6` via AI Gateway, read from env `EVE_MODEL`.
- **Package manager:** `pnpm`. **Dev server:** `pnpm devsafe` (clears the stale `.next` RSC cache; plain `pnpm dev` has a known canary cache quirk in this repo).
- Commit after every task. Conventional-commit messages.

---

### Task 1: Install Eve, scaffold a minimal agent, verify the mount + capture the API surface

This is a verification spike. Its deliverables: Eve installed (version pinned), a minimal agent answering over `/eve/v1/*` same-origin, and a findings file the rest of the plan relies on.

**Files:**
- Create: `agent/instructions.md`, `agent/agent.ts` (via `eve init .`)
- Modify: `next.config.ts`, `package.json` (deps added by `eve init`)
- Create: `docs/superpowers/notes/eve-api-findings.md`

**Interfaces:**
- Produces: `EVE_MODEL` env contract; documented signatures for `defineAgent`, `defineMcpClientConnection`, `eveChannel`/`AuthFn`/`localDev`/`vercelOidc`, `useEveAgent`, and the session-history/list capability — recorded in the findings file and consumed by Tasks 2–8.

- [ ] **Step 1: Install Eve into the existing app**

Run from the repo root (it must have `package.json` and no `agent/` yet):

```bash
pnpm dlx eve@latest init .
```

Expected: adds `eve` (plus `ai`, `zod` if missing) to `package.json`, creates `agent/instructions.md` and `agent/agent.ts`, and does not modify existing source files. If it fails to detect Next.js, fall back to `pnpm add eve@latest` and create the two `agent/` files manually (see Steps 3–4).

- [ ] **Step 2: Pin the installed version**

Run:

```bash
node -p "require('./node_modules/eve/package.json').version"
```

Record the exact version at the top of `docs/superpowers/notes/eve-api-findings.md`. Pin it in `package.json` (replace any `^`/`latest` with the exact version) so the beta can't drift under us.

- [ ] **Step 3: Set the minimal agent config**

`agent/agent.ts`:

```ts
import { defineAgent } from 'eve'

export default defineAgent({
  model: process.env.EVE_MODEL || 'anthropic/claude-sonnet-4-6',
})
```

`agent/instructions.md`:

```md
You are Eve, an assistant embedded in a Payload CMS admin. Be concise.
```

- [ ] **Step 4: Ensure the Next.js mount is wired**

Confirm `eve init` wrapped `next.config.ts` with `withEve`. The export must compose with the existing `withPayload` wrapper. Target shape (adjust to the real `withEve` import path from the installed package):

```ts
import { withPayload } from '@payloadcms/next/withPayload'
import { withEve } from 'eve/next' // verify exact path in node_modules/eve

// ...existing nextConfig...

export default withEve(withPayload(nextConfig, { devBundleServerPackages: false }))
```

If `withEve` is not the mount mechanism (e.g. Eve uses a catch-all route handler instead), record the actual mechanism in the findings file and wire that instead.

- [ ] **Step 5: Provide a local model credential**

Add to `.env` (local dev has no Vercel OIDC):

```
EVE_MODEL=anthropic/claude-sonnet-4-6
AI_GATEWAY_API_KEY=   # your AI Gateway key for local dev
```

- [ ] **Step 6: Start the app and verify the channel serves**

Run `pnpm devsafe`, then in a second shell:

```bash
curl -s -X POST http://localhost:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"say hello"}' -i | head -40
```

Expected: a 2xx response carrying an `x-eve-session-id` header and a `continuationToken` in the body. If 404, the mount (Step 4) is wrong — fix before proceeding. If 401, note the default channel auth policy (Task 4 replaces it).

- [ ] **Step 7: Capture the API surface in the findings file**

In `docs/superpowers/notes/eve-api-findings.md`, record, by reading `node_modules/eve` types and the curl behavior:
- exact import paths + signatures for `defineAgent`, `defineMcpClientConnection` (`eve/connections`), `eveChannel` (`eve/channels/eve`), `AuthFn`/`localDev`/`vercelOidc` (`eve/channels/auth`).
- the `useEveAgent` return shape: the messages array field name, each message's `role` and `parts`/content shape, the send function name + signature, and the status/streaming field. **Tasks 6–7 depend on this.**
- whether the HTTP API can **list a user's sessions** and **replay a past session's messages** to a reattaching client (endpoint + shape). This decides Task 7's persistence approach.

- [ ] **Step 8: Commit**

```bash
git add agent next.config.ts package.json pnpm-lock.yaml .env.example docs/superpowers/notes/eve-api-findings.md
git commit -m "feat(eve): install Eve framework, scaffold minimal agent, verify mount"
```

---

### Task 2: Port the system prompt (Posts/Tasks-only) to instructions.md

**Files:**
- Modify: `agent/instructions.md`

**Interfaces:**
- Consumes: nothing. Produces: the agent's behavior contract for core chat.

- [ ] **Step 1: Write the instructions**

Replace `agent/instructions.md` with the Posts/Tasks-relevant guidance from `src/eve/system-prompt.ts`, **dropping** the `proposePost`/web-search lines (deferred). For this pass, posts are created directly via the MCP create tool (no preview step):

```md
You are Eve, an assistant embedded in a Payload CMS admin. You help the user
manage content through the tools provided over MCP.

You can work with two collections, addressed by their slug:
- "posts": blog posts (title, content, status: draft|published, author)
- "tasks": to-do items (title, done, priority: low|medium|high, dueDate)

Guidelines:
- Use the provided tools to read and write real data. Never fabricate IDs or claim a
  record exists that you have not actually read or created via a tool.
- Authoring new content is your job: when asked to create something without specifics,
  generate sensible content yourself (invent a reasonable title and a few paragraphs of
  Markdown body) and create it with a default status of "draft". Only ask a clarifying
  question when the request is genuinely ambiguous.
- Reading/updating use the generic tools (findDocuments, updateDocument): pass the target
  collection as "collectionSlug" ("posts" or "tasks") and put fields under "data".
- To create a post, use createDocumentFromMarkdown (collectionSlug "posts", plain fields
  like title/status in "data", body in "markdown" as { "content": "..." }).
- To create a task, use createDocument with collectionSlug "tasks".
- For updates, identify the right record first (find it if needed).
- After a change, state plainly what you created or updated.
- Keep replies concise. Use Markdown for lists and emphasis when helpful.
```

- [ ] **Step 2: Commit**

```bash
git add agent/instructions.md
git commit -m "feat(eve): port Posts/Tasks system prompt to agent instructions"
```

---

### Task 3: Wire the Payload MCP server as an Eve connection

**Files:**
- Create: `agent/connections/payload-mcp.ts`
- Create: `agent/connections/payload-mcp.test.ts`

**Interfaces:**
- Consumes: env `MCP_SERVER_URL` (default `http://localhost:3000/api/mcp`), `MCP_API_KEY` (optional in dev).
- Produces: Posts/Tasks MCP tools (`findDocuments`, `updateDocument`, `createDocument`, `createDocumentFromMarkdown`) available to the agent.

- [ ] **Step 1: Write the failing test for the connection config helper**

Factor the token logic into a pure helper so it is testable. `agent/connections/payload-mcp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mcpAuthHeaderToken } from './payload-mcp'

describe('mcpAuthHeaderToken', () => {
  it('returns the trimmed key when set', () => {
    expect(mcpAuthHeaderToken('  abc ')).toBe('abc')
  })
  it('returns undefined when unset or blank', () => {
    expect(mcpAuthHeaderToken(undefined)).toBeUndefined()
    expect(mcpAuthHeaderToken('   ')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run agent/connections/payload-mcp.test.ts`
Expected: FAIL — `mcpAuthHeaderToken` is not exported.

- [ ] **Step 3: Implement the connection**

`agent/connections/payload-mcp.ts` (verify `defineMcpClientConnection` import path + auth shape against Task 1 findings):

```ts
import { defineMcpClientConnection } from 'eve/connections'

/** Returns the trimmed MCP bearer token, or undefined when unset/blank. */
export function mcpAuthHeaderToken(raw: string | undefined): string | undefined {
  const t = raw?.trim()
  return t ? t : undefined
}

const url = process.env.MCP_SERVER_URL || 'http://localhost:3000/api/mcp'
const token = mcpAuthHeaderToken(process.env.MCP_API_KEY)

export default defineMcpClientConnection({
  url,
  description: 'Payload CMS: Posts and Tasks (find, create, update) over MCP.',
  // Dev: Payload MCP accepts no auth (overrideAuth). Prod: Bearer MCP_API_KEY.
  ...(token ? { auth: { getToken: async () => ({ token }) } } : {}),
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run agent/connections/payload-mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Manually verify the agent can reach the tools**

With `pnpm devsafe` running, start a session asking Eve to "list my tasks". Expected: the NDJSON stream shows a tool call to `findDocuments` (collectionSlug `tasks`) and a reply. (Requires Mongo running and at least an empty `tasks` collection.)

- [ ] **Step 6: Commit**

```bash
git add agent/connections
git commit -m "feat(eve): connect the Payload MCP server as an Eve MCP connection"
```

---

### Task 4: Bridge Payload admin auth into the Eve channel (admin-only)

**Files:**
- Create: `src/eve/auth.ts` (shared `authenticateAdmin` helper)
- Create: `src/eve/auth.test.ts`
- Create: `agent/channels/eve.ts`

**Interfaces:**
- Consumes: `payload.auth()`.
- Produces: `authenticateAdmin(headers: Headers): Promise<{ id: string } | null>` — returns the admin user id, or `null` for anonymous/non-admin/API-key principals.

- [ ] **Step 1: Write the failing test**

`src/eve/auth.test.ts` (mock `getPayload` so the test asserts the gate, not the DB):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn()
vi.mock('payload', () => ({ getPayload: async () => ({ auth: authMock }) }))
vi.mock('@payload-config', () => ({ default: {} }))

import { authenticateAdmin } from './auth'

beforeEach(() => authMock.mockReset())

describe('authenticateAdmin', () => {
  it('accepts a users-collection user', async () => {
    authMock.mockResolvedValue({ user: { id: '42', collection: 'users' } })
    expect(await authenticateAdmin(new Headers())).toEqual({ id: '42' })
  })
  it('rejects anonymous', async () => {
    authMock.mockResolvedValue({ user: null })
    expect(await authenticateAdmin(new Headers())).toBeNull()
  })
  it('rejects an API-key principal', async () => {
    authMock.mockResolvedValue({ user: { id: 'k1', collection: 'payload-mcp-api-keys' } })
    expect(await authenticateAdmin(new Headers())).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/eve/auth.test.ts`
Expected: FAIL — `authenticateAdmin` not defined.

- [ ] **Step 3: Implement the helper**

`src/eve/auth.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Validates the request's Payload session and returns the admin user id, or null.
 * Only real users-collection users are accepted (mirrors the old /api/eve guard:
 * anonymous and MCP-API-key principals are rejected).
 */
export async function authenticateAdmin(headers: Headers): Promise<{ id: string } | null> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })
  if (!user || user.collection !== 'users') return null
  return { id: String(user.id) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/eve/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the channel auth**

`agent/channels/eve.ts` (verify imports against Task 1 findings):

```ts
import { eveChannel } from 'eve/channels/eve'
import { localDev, vercelOidc, type AuthFn } from 'eve/channels/auth'
import { authenticateAdmin } from '../../src/eve/auth'

const appAuth: AuthFn<Request> = async (request) => {
  const admin = await authenticateAdmin(request.headers)
  if (!admin) return null
  return {
    principalType: 'user',
    principalId: admin.id,
    authenticator: 'app',
    issuer: 'payload-eve-chat',
  }
}

export default eveChannel({ auth: [appAuth, localDev(), vercelOidc()] })
```

- [ ] **Step 6: Manually verify the gate**

With the app running: an unauthenticated `curl -X POST /eve/v1/session` must be rejected; the same request from a logged-in admin browser (cookie present) must succeed. Confirm in the next task via the UI.

- [ ] **Step 7: Commit**

```bash
git add src/eve/auth.ts src/eve/auth.test.ts agent/channels/eve.ts
git commit -m "feat(eve): bridge Payload admin auth into the Eve channel (admin-only)"
```

---

### Task 5: Repurpose the Conversations collection as a thin session index

Decision driver: Task 1's findings on session listing/replay. This task implements the **thin-index** path (sidebar threads map to Eve session ids; messages live in Eve). If Task 1 found Eve **cannot** replay prior turns to the browser, also keep the `messages` JSON field as a rendered-transcript cache (kept below as an optional field).

**Files:**
- Modify: `src/collections/Conversations.ts`
- Rewrite: `src/eve/conversations.ts`
- Modify: `src/eve/conversations.test.ts` (if present) or create it

**Interfaces:**
- Produces:
  - `createConversation(payload, user, title, eveSessionId): Promise<Conversation>`
  - `listConversations(payload, user): Promise<Conversation[]>`
  - `loadConversationBySession(payload, eveSessionId, user): Promise<Conversation | null>`

- [ ] **Step 1: Add the `eveSessionId` field**

In `src/collections/Conversations.ts`, add an indexed `eveSessionId` text field and update the doc comment. Keep `messages` (json) as an optional transcript cache:

```ts
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'eveSessionId', type: 'text', index: true },
    // Optional rendered-transcript cache; only used if Eve cannot replay sessions.
    { name: 'messages', type: 'json' },
  ],
```

- [ ] **Step 2: Rewrite the helpers**

`src/eve/conversations.ts` — replace the AI-SDK message persistence with session-index helpers:

```ts
import type { Payload } from 'payload'
import type { Conversation, User } from '@/payload-types'

export async function createConversation(
  payload: Payload,
  user: User,
  title: string,
  eveSessionId: string,
): Promise<Conversation> {
  return payload.create({
    collection: 'conversations',
    data: { title: title.slice(0, 80), user: user.id, eveSessionId },
    overrideAccess: false,
    user,
  })
}

export async function listConversations(payload: Payload, user: User): Promise<Conversation[]> {
  const res = await payload.find({
    collection: 'conversations',
    where: { user: { equals: user.id } },
    sort: '-updatedAt',
    limit: 100,
    overrideAccess: false,
    user,
  })
  return res.docs
}

export async function loadConversationBySession(
  payload: Payload,
  eveSessionId: string,
  user: User,
): Promise<Conversation | null> {
  const res = await payload.find({
    collection: 'conversations',
    where: { eveSessionId: { equals: eveSessionId }, user: { equals: user.id } },
    limit: 1,
    overrideAccess: false,
    user,
  })
  return res.docs[0] ?? null
}
```

- [ ] **Step 3: Update/replace the helper test**

Create/replace `src/eve/conversations.test.ts` to cover `createConversation` title truncation and that `listConversations`/`loadConversationBySession` pass `overrideAccess: false` + the user (mock `payload.create`/`payload.find`). Run:

```bash
pnpm vitest run src/eve/conversations.test.ts
```
Expected: PASS.

- [ ] **Step 4: Regenerate Payload types**

Run: `pnpm payload generate:types`
Expected: `Conversation` in `src/payload-types.ts` now has `eveSessionId`.

- [ ] **Step 5: Commit**

```bash
git add src/collections/Conversations.ts src/eve/conversations.ts src/eve/conversations.test.ts src/payload-types.ts
git commit -m "feat(eve): repurpose Conversations as a thin Eve-session index"
```

---

### Task 6: Rewrite EveChat on useEveAgent (core chat, no voice/preview)

**Files:**
- Rewrite: `src/components/eve/EveChat.tsx`

**Interfaces:**
- Consumes: `useEveAgent` (shape from Task 1 findings); `ConversationSidebar` (`id`, `title`, `activeId`, `onSelect`, `onNew`).
- Produces: a client chat component that streams from the Eve channel and creates a sidebar entry for a new thread.

> The hook field names below (`agent.messages`, `agent.sendMessage`, `agent.status`, `agent.sessionId`) follow the documented `useEveAgent` model. **Before writing, confirm the real names in Task 1's findings file and substitute throughout.** Map each Eve message part to the existing AI Elements components (`MessageResponse` for text, `Tool`/`ToolHeader`/`ToolInput`/`ToolOutput` for tool calls, `Reasoning` for reasoning).

- [ ] **Step 1: Write the new component**

Replace `src/components/eve/EveChat.tsx` with a voice-free, preview-free version:

```tsx
'use client'
import React, { useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { useEveAgent } from 'eve/react' // verify path in Task 1 findings
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import './eve.css'

export { type ConversationSummary }

export const EveChat: React.FC<{
  conversations: ConversationSummary[]
  activeId?: string
}> = ({ conversations, activeId }) => {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [sidebarConversations, setSidebarConversations] = useState(conversations)

  // Same-origin; the browser sends the Payload admin cookie automatically.
  // resumeSessionId reattaches to a thread opened from the sidebar.
  const agent = useEveAgent({ resumeSessionId: activeId })

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text) return
    setInput('')
    const isNew = !activeId
    await agent.sendMessage({ message: text })
    // After the first turn of a brand-new chat, record the session in the sidebar
    // and adopt it in the URL so follow-ups persist to the same thread.
    if (isNew && agent.sessionId) {
      const id = agent.sessionId
      setSidebarConversations((prev) =>
        prev.some((c) => c.id === id) ? prev : [{ id, title: text.slice(0, 80) }, ...prev],
      )
      router.push(`?conversation=${id}`)
    }
  }

  return (
    <div className="eve-scope flex h-[calc(100dvh-var(--app-header-height,48px))] min-h-[600px]">
      <ConversationSidebar
        conversations={sidebarConversations}
        activeId={activeId}
        onSelect={(id) => router.push(`?conversation=${id}`)}
        onNew={() => router.push('?')}
      />
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <Conversation className="flex-1">
          <ConversationContent>
            {agent.messages.length === 0 ? (
              <ConversationEmptyState
                title="Chat with Eve"
                description="Ask Eve to create a post or manage your tasks."
              />
            ) : (
              agent.messages.map((m, index) => {
                const key = m.id || `message-${index}`
                return (
                  <Message from={m.role} key={key}>
                    <MessageContent>
                      {m.parts.map((part, i) => {
                        if (part.type === 'text') {
                          return <MessageResponse key={`${key}-${i}`}>{part.text}</MessageResponse>
                        }
                        if (part.type === 'tool') {
                          return (
                            <Tool key={`${key}-${i}`}>
                              <ToolHeader type="dynamic-tool" toolName={part.toolName} state={part.state} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                {part.output !== undefined ? (
                                  <ToolOutput output={part.output} errorText={undefined} />
                                ) : null}
                              </ToolContent>
                            </Tool>
                          )
                        }
                        return null
                      })}
                    </MessageContent>
                  </Message>
                )
              })
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-3">
          <PromptInputTextarea
            value={input}
            placeholder="Message Eve…"
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <PromptInputFooter>
            <PromptInputSubmit
              status={agent.status}
              onStop={agent.stop}
              disabled={agent.status !== 'streaming' && agent.status !== 'submitted' && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Reconcile the part/status mapping with Task 1 findings**

If the real `useEveAgent` exposes message parts or status values differently than above (e.g. `content` instead of `parts`, or tool parts shaped unlike `{ type:'tool', toolName, state, input, output }`), update the `.map(...)` branches and the `PromptInputSubmit` `status` values to match. The AI Elements `status` prop accepts `'submitted' | 'streaming' | 'ready' | 'error'`; adapt Eve's status into one of those.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit` (or the repo's `lint`/typecheck script).
Expected: no type errors in `EveChat.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/eve/EveChat.tsx
git commit -m "feat(eve): rewrite EveChat on the useEveAgent hook (core chat)"
```

---

### Task 7: Update EveView to the thin index + drop AI-SDK message loading

**Files:**
- Modify: `src/components/eve/EveView.tsx`

**Interfaces:**
- Consumes: `listConversations` (Task 5), `EveChat` (Task 6, new props: `conversations`, `activeId`).

- [ ] **Step 1: Update the server view**

In `src/components/eve/EveView.tsx`: remove the `UIMessage`/`loadConversation`/`initialMessages` and `sttAvailable`/`ttsAvailable` wiring; pass only `conversations` + `activeId`. The `activeId` is now the Eve `sessionId` (stored as `eveSessionId`). Replace the import and the `<EveChat .../>` props:

```tsx
import { listConversations } from '../../eve/conversations'
// ...
  const conversations = user ? await listConversations(req.payload, user) : []
// ...
        <EveChat
          key={activeId ?? 'new'}
          conversations={conversations.map((c) => ({
            id: c.eveSessionId ?? String(c.id),
            title: c.title ?? 'Untitled',
          }))}
          activeId={activeId}
        />
```

Drop the now-unused `loadConversation`/`UIMessage` imports and the `active`/`initialMessages` lines.

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no type errors. (`loadConversation` no longer imported; `EveChat` props match Task 6.)

- [ ] **Step 3: Manual end-to-end smoke**

`pnpm devsafe`, log in as admin, open `/admin/eve`. Send "create a task called Buy milk". Expected: the tool call renders, the task is created, a thread appears in the sidebar; reload and reopen it from the sidebar — it reattaches to the session (history renders if Eve replays; otherwise see Task 1 findings / transcript-cache fallback).

- [ ] **Step 4: Commit**

```bash
git add src/components/eve/EveView.tsx
git commit -m "feat(eve): EveView uses the thin session index, drops AI-SDK message loading"
```

---

### Task 8: Remove the AI-SDK chat stack

**Files:**
- Delete: `src/app/api/eve/route.ts`, `src/eve/mcp-client.ts`, `src/eve/provider.ts`, `src/eve/provider.test.ts`
- Modify: `package.json`

**Interfaces:** none produced.

- [ ] **Step 1: Confirm nothing references the deletions**

Run:

```bash
grep -rn "api/eve\b\|mcp-client\|@/eve/provider\|resolveModel\|createPayloadMcpTools" src --include=*.ts --include=*.tsx | grep -v "transcribe\|speak"
```

Expected: no remaining references outside the deferred transcribe/speak routes. (Those POST to `/api/eve/transcribe` and `/api/eve/speak`, which are **not** the deleted `/api/eve` chat route — leave them.) If anything else shows up, resolve it before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/app/api/eve/route.ts src/eve/mcp-client.ts src/eve/provider.ts src/eve/provider.test.ts
```

- [ ] **Step 3: Remove now-unused AI-SDK deps**

Only `@ai-sdk/react`, `@ai-sdk/mcp`, `@ai-sdk/anthropic`, `@ai-sdk/openai` if grep confirms they are unused (the voice routes may still import `ai` helpers — keep `ai` and `zod`). Verify per-package, then:

```bash
pnpm remove @ai-sdk/react @ai-sdk/mcp @ai-sdk/anthropic @ai-sdk/openai
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: green. Fix any dangling imports the deletions exposed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(eve): remove the Vercel AI SDK chat route, MCP client, and provider"
```

---

### Task 9: Update env template + README

**Files:**
- Modify: `.env.example`, `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update `.env.example`**

Add the Eve/AI-Gateway block; mark the old AI-SDK provider/Ollama vars as the `ai-sdk` branch's:

```
# --- Eve (Vercel Eve framework) ---
EVE_MODEL=anthropic/claude-sonnet-4-6
AI_GATEWAY_API_KEY=          # required for local dev; on Vercel use OIDC
MCP_SERVER_URL=http://localhost:3000/api/mcp
MCP_API_KEY=                 # optional in dev; required in production

# The Vercel AI SDK provider vars (AI_PROVIDER / ANTHROPIC_API_KEY / OLLAMA_*)
# apply only to the `ai-sdk` branch.
```

- [ ] **Step 2: Update the README**

In `README.md`: change the "AI Chat Agent (Eve)" section to describe the Eve framework (agent-as-directory, AI Gateway, durable sessions, `withEve` mount) instead of `streamText`/AI Elements transport; replace the "Switching providers"/Ollama subsections with the AI Gateway model note; add a line that the previous AI-SDK implementation lives on the `ai-sdk` branch; note the MongoDB-Atlas requirement for the Vercel deploy. Keep deferred features (voice/web-search/post-preview) documented as "available on the `ai-sdk` branch; Eve port pending".

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs(eve): document the Eve framework + AI Gateway setup"
```

---

### Task 10: End-to-end test — Eve creates a task via the admin UI

**Files:**
- Create: `tests/e2e/eve-chat.spec.ts` (match the repo's existing Playwright layout)

**Interfaces:**
- Consumes: a running app + seeded admin (see `payload-eve-chat-test-admin` creds).

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test'

test('Eve creates a task from the chat', async ({ page }) => {
  // Log in as the test admin.
  await page.goto('/admin/login')
  await page.fill('#field-email', 'admin@example.com')
  await page.fill('#field-password', 'Test12345!')
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')

  await page.goto('/admin/eve')
  await page.getByPlaceholder('Message Eve…').fill('Create a task called Playwright Smoke')
  await page.keyboard.press('Enter')

  // The assistant confirms; the task exists in the tasks collection.
  await expect(page.getByText(/Playwright Smoke/i)).toBeVisible({ timeout: 30_000 })
  await page.goto('/admin/collections/tasks')
  await expect(page.getByText('Playwright Smoke')).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm playwright test tests/e2e/eve-chat.spec.ts` (against a running dev server + Mongo; requires `AI_GATEWAY_API_KEY`).
Expected: PASS. If model nondeterminism makes the assertion flaky, assert on the tool call / created record rather than reply prose.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/eve-chat.spec.ts
git commit -m "test(eve): e2e — Eve creates a task via the admin chat"
```

---

## Self-Review

**Spec coverage:**
- §2 in-scope core chat → Tasks 1, 6, 7, 10. Posts/Tasks via MCP → Task 3. ✓
- §3 AI Gateway model → Tasks 1, 9. Embedded mount → Task 1. ✓
- §4.1 agent dir (instructions/agent/connections/channels) → Tasks 1, 2, 3, 4. ✓
- §4.2 EveChat on useEveAgent + deletions → Tasks 6, 8. ✓
- §4.3 thin Conversations index + replay fallback → Tasks 1 (replay finding), 5, 7. ✓
- §4.1 auth bridge (admin-only) → Task 4. ✓
- §5 env/infra (AI Gateway, Mongo Atlas, MCP vars) → Task 9 (Atlas is a deploy note, not code). ✓
- §6 testing (auth unit, MCP config unit, e2e) → Tasks 3, 4, 5, 10. ✓
- §7 risks: mount (Task 1 Step 6), replay (Task 1 Step 7 → Task 5), local-dev gateway auth (Task 1 Step 5), auth fidelity (Task 4 tests). ✓
- §2 deferred features left unwired → enforced by Global Constraints + Task 8 Step 1 grep guard. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"-style steps. The Eve-API uncertainties are explicit, bounded verification steps (Task 1 findings + per-task "reconcile with findings"), which is the correct treatment for a beta dependency, not a hidden gap.

**Type consistency:** `authenticateAdmin` returns `{ id: string } | null` (Task 4) and is consumed in `agent/channels/eve.ts` (Task 4) consistently. `createConversation/listConversations/loadConversationBySession` (Task 5) match their EveView consumption (Task 7). `EveChat` props (`conversations`, `activeId`) match between Tasks 6 and 7. `eveSessionId` field name consistent across Tasks 5/7.

**Known residual risk:** `useEveAgent` field names and the `withEve` import path are written from docs, not a running install; Task 1 is the gate that converts them to verified fact, and Tasks 4/6 carry explicit "reconcile with findings" steps.
