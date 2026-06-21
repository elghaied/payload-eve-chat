# Eve Chat Sidebar Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Eve's conversation history into a native Payload v4 **sidebar tab**, freeing the `/admin/eve` view to use the full content area for the chat.

**Architecture:** A new `SidebarTab` ("Eve chat") whose `Content` server component fetches the user's conversations and renders a client `ConversationHistoryPanel`. The panel navigates to `/admin/eve?conversation=<id>` and stays live via a `window` `CustomEvent('eve:conversation-created')` dispatched by `EveChat` (the tab and the chat view are separate React trees). `EveChat` drops its internal `ConversationSidebar`; `EveView` stops fetching conversations; the old `EveNavLink` is removed.

**Tech Stack:** Payload v4 canary (`admin.components.sidebar.tabs`, `SidebarTab`), Next App Router, React client components, `@payloadcms/ui` `useRouter`, `next/navigation` `usePathname`/`useSearchParams`, `lucide-react`, Vitest + React Testing Library (jsdom).

## Global Constraints

- **Do NOT push to `main`.** `main` is Vercel-connected; a push can auto-deploy and spend. All work stays local/unpushed; merge to local `main` only.
- **Admin component path strings** use the `/components/...#Export` form (resolved by `admin.importMap`, `baseDir: src`), exactly like the existing `views.eve` (`/components/eve/EveView#EveView`).
- **Never import from the `eve/client` barrel in a browser/client component** — it drags Eve's runtime (`node:module`) into the client bundle and breaks `pnpm build` (tsc/vitest/`eve info` do NOT catch it; only a real build does). The new client files import only React, `@payloadcms/ui`, `next/navigation`, and `lucide-react`.
- **The sidebar tab renders inside Payload's `Nav` tree, not inside `EveView`'s `.eve-scope`.** Tailwind/`eve.css` utilities are not guaranteed to apply there. Style the panel with Payload's own nav classes plus **inline styles**; do **not** wrap it in `.eve-scope` and do **not** rely on Tailwind utility classes.
- **Tests:** Vitest + jsdom + RTL, but **no `jest-dom`** — use plain assertions (`expect(x).toBeTruthy()`, `.toBe(...)`). Use `fireEvent`/`act` to flush React state (a bare `.click()` will not).
- **Default active sidebar tab stays Collections** — do not set `isDefaultActive` on the Eve tab.
- **Sidebar tabs is a canary feature** (verified present in the installed dist); acceptable per the spec, but treat the API as possibly-volatile across canary bumps.
- Per-task gates: `pnpm exec tsc --noEmit` and `pnpm run test:int`. Final gate (Task 5): `node_modules/.bin/eve info` (0 diagnostics + 1 skill) and a real `pnpm build`.

## File Structure

- Create: `src/components/eve/ConversationHistoryPanel.tsx` — client; the history list + "New chat" + the event contract (name, detail type, `dispatchConversationCreated`, `ConversationSummary`).
- Create: `src/components/eve/ConversationHistoryPanel.test.tsx` — unit tests.
- Create: `src/components/eve/EveChatTabIcon.tsx` — client; lucide rail icon.
- Create: `src/components/eve/EveChatTab.tsx` — server; fetches conversations → panel.
- Create: `src/eve/sidebar-tabs.ts` — `customSidebarTabs: SidebarTab[]`.
- Modify: `src/payload.config.ts` — register `sidebar.tabs`; later remove `afterNavLinks`.
- Modify: `src/components/eve/EveChat.tsx` — drop the in-view sidebar + `conversations` prop; dispatch the event; full-width layout.
- Modify: `src/components/eve/EveView.tsx` — stop fetching/passing `conversations`.
- Modify: `src/eve/__tests__/payload-config-mcp.test.ts` (the static-source config test) — assert the tab is registered and `EveNavLink`/`afterNavLinks` is gone.
- Delete: `src/components/eve/ConversationSidebar.tsx`, `src/components/eve/EveNavLink.tsx`.

---

### Task 1: ConversationHistoryPanel (client) + tests

**Files:**
- Create: `src/components/eve/ConversationHistoryPanel.tsx`
- Test: `src/components/eve/ConversationHistoryPanel.test.tsx`

**Interfaces:**
- Produces:
  - `export type ConversationSummary = { id: string; title: string }`
  - `export const CONVERSATION_CREATED_EVENT = 'eve:conversation-created'`
  - `export type ConversationCreatedDetail = { id: string; title: string }`
  - `export function dispatchConversationCreated(detail: ConversationCreatedDetail): void`
  - `export const ConversationHistoryPanel: React.FC<{ initialConversations: ConversationSummary[] }>`
- Consumes: `useRouter` from `@payloadcms/ui`; `usePathname`, `useSearchParams` from `next/navigation`.

- [ ] **Step 1: Write the failing test**

Create `src/components/eve/ConversationHistoryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const pushMock = vi.fn()
vi.mock('@payloadcms/ui', () => ({ useRouter: () => ({ push: pushMock }) }))

let mockPathname = '/admin/eve'
let mockSearch = new URLSearchParams('')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearch,
}))

import {
  ConversationHistoryPanel,
  CONVERSATION_CREATED_EVENT,
  dispatchConversationCreated,
} from './ConversationHistoryPanel'

const LIST = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
]

beforeEach(() => {
  pushMock.mockReset()
  mockPathname = '/admin/eve'
  mockSearch = new URLSearchParams('')
  cleanup()
})

describe('ConversationHistoryPanel', () => {
  it('renders the New chat button and the initial conversations', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('shows an empty state when there are no conversations', () => {
    render(<ConversationHistoryPanel initialConversations={[]} />)
    expect(screen.getByText(/no conversations yet/i)).toBeTruthy()
  })

  it('marks the active conversation (aria-current) when on /admin/eve with ?conversation', () => {
    mockSearch = new URLSearchParams('conversation=b')
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByText('Beta').getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Alpha').getAttribute('aria-current')).toBeNull()
  })

  it('does NOT mark any conversation active when not on /admin/eve', () => {
    mockPathname = '/admin/collections/posts'
    mockSearch = new URLSearchParams('conversation=b')
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByText('Beta').getAttribute('aria-current')).toBeNull()
  })

  it('navigates to the chat view with the conversation id when a row is clicked', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(pushMock).toHaveBeenCalledWith('/admin/eve?conversation=a')
  })

  it('navigates to a fresh chat view when New chat is clicked', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(pushMock).toHaveBeenCalledWith('/admin/eve')
  })

  it('merges an eve:conversation-created event to the top, deduped by id', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONVERSATION_CREATED_EVENT, { detail: { id: 'z', title: 'Zed' } }),
      )
    })
    expect(screen.getByText('Zed')).toBeTruthy()
    // Re-dispatching the same id updates in place (no duplicate row).
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONVERSATION_CREATED_EVENT, { detail: { id: 'z', title: 'Zed 2' } }),
      )
    })
    expect(screen.getAllByText(/Zed/).length).toBe(1)
    expect(screen.getByText('Zed 2')).toBeTruthy()
  })

  it('re-syncs the list when initialConversations changes (server revalidation)', () => {
    const { rerender } = render(<ConversationHistoryPanel initialConversations={LIST} />)
    rerender(<ConversationHistoryPanel initialConversations={[{ id: 'c', title: 'Gamma' }]} />)
    expect(screen.getByText('Gamma')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('dispatchConversationCreated emits the event with the given detail', () => {
    const spy = vi.fn()
    window.addEventListener(CONVERSATION_CREATED_EVENT, spy)
    dispatchConversationCreated({ id: 'q', title: 'Quartz' })
    window.removeEventListener(CONVERSATION_CREATED_EVENT, spy)
    expect(spy).toHaveBeenCalledOnce()
    const evt = spy.mock.calls[0][0] as CustomEvent
    expect(evt.detail).toEqual({ id: 'q', title: 'Quartz' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/components/eve/ConversationHistoryPanel.test.tsx`
Expected: FAIL (module `./ConversationHistoryPanel` does not exist).

- [ ] **Step 3: Implement the panel**

Create `src/components/eve/ConversationHistoryPanel.tsx`:

```tsx
'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'

export type ConversationSummary = { id: string; title: string }

export type ConversationCreatedDetail = { id: string; title: string }

/** Admin route that hosts the full-space chat. The sidebar tab navigates here. */
const EVE_VIEW_PATH = '/admin/eve'

/**
 * Window event used to keep the history panel live. The panel and the chat view
 * (EveChat) live in separate React trees — the panel inside Payload's Nav, the
 * chat inside the routed page — so they communicate via a window CustomEvent
 * rather than shared React state.
 */
export const CONVERSATION_CREATED_EVENT = 'eve:conversation-created'

/** Announce that a brand-new conversation was created (called by EveChat). */
export function dispatchConversationCreated(detail: ConversationCreatedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONVERSATION_CREATED_EVENT, { detail }))
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--base, 4px)',
  padding: 'calc(var(--base, 20px) / 2)',
}
const newBtnStyle: React.CSSProperties = {
  textAlign: 'left',
  cursor: 'pointer',
  fontWeight: 600,
}
const itemBaseStyle: React.CSSProperties = {
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/**
 * Conversation history rendered inside the "Eve chat" sidebar tab. Seeded by a
 * server-fetched list, kept live by the CONVERSATION_CREATED_EVENT, and
 * highlighting the active thread from the URL. Styled with Payload's nav classes
 * + inline styles (Tailwind/eve.css are not guaranteed inside the Nav tree).
 */
export const ConversationHistoryPanel: React.FC<{
  initialConversations: ConversationSummary[]
}> = ({ initialConversations }) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations)

  // Server revalidation (tab re-activation) hands us a fresh list — adopt it.
  useEffect(() => {
    setConversations(initialConversations)
  }, [initialConversations])

  // Live updates from the chat view (separate React tree).
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent<ConversationCreatedDetail>).detail
      if (!detail?.id) return
      setConversations((prev) => [
        { id: detail.id, title: detail.title || 'New conversation' },
        ...prev.filter((c) => c.id !== detail.id),
      ])
    }
    window.addEventListener(CONVERSATION_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(CONVERSATION_CREATED_EVENT, onCreated)
  }, [])

  const activeId =
    pathname === EVE_VIEW_PATH ? (searchParams.get('conversation') ?? undefined) : undefined

  const openConversation = useCallback(
    (id: string) => router.push(`${EVE_VIEW_PATH}?conversation=${id}`),
    [router],
  )
  const startNewChat = useCallback(() => router.push(EVE_VIEW_PATH), [router])

  return (
    <div style={wrapStyle}>
      <button type="button" className="nav__link" style={newBtnStyle} onClick={startNewChat}>
        + New chat
      </button>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {conversations.length === 0 ? (
          <p className="nav__label" style={{ opacity: 0.7, padding: 4 }}>
            No conversations yet.
          </p>
        ) : (
          conversations.map((c) => {
            const isActive = c.id === activeId
            return (
              <button
                key={c.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => openConversation(c.id)}
                className="nav__link"
                style={{
                  ...itemBaseStyle,
                  fontWeight: isActive ? 600 : undefined,
                  background: isActive ? 'var(--theme-elevation-100)' : undefined,
                }}
              >
                {c.title || 'Untitled'}
              </button>
            )
          })
        )}
      </nav>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm exec vitest run src/components/eve/ConversationHistoryPanel.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/eve/ConversationHistoryPanel.tsx src/components/eve/ConversationHistoryPanel.test.tsx
git commit -m "feat(eve): conversation history panel for the sidebar tab"
```

---

### Task 2: Tab scaffolding + config registration

**Files:**
- Create: `src/components/eve/EveChatTabIcon.tsx`
- Create: `src/components/eve/EveChatTab.tsx`
- Create: `src/eve/sidebar-tabs.ts`
- Modify: `src/payload.config.ts`
- Modify: `src/eve/__tests__/payload-config-mcp.test.ts`

**Interfaces:**
- Consumes: `ConversationHistoryPanel` + `ConversationSummary` (Task 1); `listConversations` from `src/eve/conversations.ts`; `SidebarTab` from `payload`.
- Produces: `export const customSidebarTabs: SidebarTab[]`; `export const EveChatTab`; `export const EveChatTabIcon`.

This task leaves the OLD nav link and in-view sidebar in place — both entry points coexist, build stays green. (Cutover is Task 3; cleanup is Task 4.)

- [ ] **Step 1: Create the rail icon**

Create `src/components/eve/EveChatTabIcon.tsx`:

```tsx
'use client'
import React from 'react'
import { MessageCircle } from 'lucide-react'

/** Icon for the Eve chat tab in the admin sidebar rail. */
export const EveChatTabIcon: React.FC = () => <MessageCircle size={18} aria-hidden="true" />
```

- [ ] **Step 2: Create the tab Content server component**

Create `src/components/eve/EveChatTab.tsx`:

```tsx
import React from 'react'
import type { SidebarTabServerProps } from 'payload'
import type { User } from '@/payload-types'
import { listConversations } from '../../eve/conversations'
import { ConversationHistoryPanel } from './ConversationHistoryPanel'

/**
 * Content of the "Eve chat" sidebar tab. Server component: fetches the signed-in
 * user's conversations (same as EveView) and hands them to the client panel.
 *
 * `user` is the project-wide union (widened by the MCP plugin). Only a
 * users-collection document can own conversations, so we narrow first.
 */
export const EveChatTab = async ({ payload, user }: SidebarTabServerProps) => {
  const typedUser: User | null =
    user && 'collection' in user && user.collection === 'users' ? (user as User) : null

  if (!typedUser) {
    return (
      <p className="nav__label" style={{ opacity: 0.7, padding: 8 }}>
        Sign in to chat with Eve.
      </p>
    )
  }

  const rows = await listConversations(payload, typedUser)
  const initialConversations = rows.map((c) => ({
    id: c.eveSessionId ?? String(c.id),
    title: c.title ?? 'Untitled',
  }))

  return <ConversationHistoryPanel initialConversations={initialConversations} />
}
```

- [ ] **Step 3: Create the tab config module**

Create `src/eve/sidebar-tabs.ts`:

```ts
import type { SidebarTab } from 'payload'

/**
 * Custom admin sidebar tabs. The "Eve chat" tab shows conversation history in
 * the sidebar panel; the chat itself stays at the /admin/eve view. Component
 * paths are resolved by admin.importMap (baseDir: src), like views.eve.
 *
 * Collections remains the default tab (no isDefaultActive here).
 */
export const customSidebarTabs: SidebarTab[] = [
  {
    slug: 'eve-chat',
    label: 'Eve chat',
    components: {
      Icon: '/components/eve/EveChatTabIcon#EveChatTabIcon',
      Content: '/components/eve/EveChatTab#EveChatTab',
    },
  },
]
```

- [ ] **Step 4: Register the tab in payload.config.ts**

In `src/payload.config.ts`, add the import alongside the other eve imports:

```ts
import { customSidebarTabs } from './eve/sidebar-tabs'
```

Then add `sidebar` inside `admin.components` (keep `afterNavLinks` and `views` as-is for now):

```ts
    components: {
      afterNavLinks: ['/components/eve/EveNavLink#EveNavLink'],
      sidebar: {
        tabs: customSidebarTabs,
      },
      views: {
        eve: {
          Component: '/components/eve/EveView#EveView',
          path: '/eve',
        },
      },
    },
```

- [ ] **Step 5: Extend the static config test**

In `src/eve/__tests__/payload-config-mcp.test.ts`, add a new `describe` block (the file reads `configSource` from disk):

```ts
describe('payload.config.ts sidebar tab registration', () => {
  it('imports customSidebarTabs from sidebar-tabs', () => {
    expect(configSource).toContain("from './eve/sidebar-tabs'")
    expect(configSource).toContain('customSidebarTabs')
  })

  it('registers the sidebar tabs under admin.components.sidebar', () => {
    expect(configSource).toContain('sidebar:')
    expect(configSource).toContain('tabs: customSidebarTabs')
  })
})
```

- [ ] **Step 6: Run the config test + typecheck**

Run: `pnpm exec vitest run src/eve/__tests__/payload-config-mcp.test.ts`
Expected: PASS (existing + 2 new).
Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/eve/EveChatTabIcon.tsx src/components/eve/EveChatTab.tsx src/eve/sidebar-tabs.ts src/payload.config.ts src/eve/__tests__/payload-config-mcp.test.ts
git commit -m "feat(eve): register Eve chat sidebar tab (icon + server content)"
```

---

### Task 3: Cut EveChat/EveView over to the tab

**Files:**
- Modify: `src/components/eve/EveChat.tsx`
- Modify: `src/components/eve/EveView.tsx`

**Interfaces:**
- Consumes: `dispatchConversationCreated` from `./ConversationHistoryPanel` (Task 1).
- Produces: `EveChatProps` no longer has a `conversations` field.

After this task the chat is full-width and history updates live through the tab; the old `ConversationSidebar.tsx` file and `EveNavLink` still exist but `EveChat` no longer imports the sidebar (cleanup is Task 4).

- [ ] **Step 1: Update EveChat imports**

In `src/components/eve/EveChat.tsx`, replace the `ConversationSidebar` import line:

```ts
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
```

with:

```ts
import { dispatchConversationCreated } from './ConversationHistoryPanel'
```

Remove the `export { type ConversationSummary }` re-export line (search for `export { type ConversationSummary }` and delete it — the type now lives in `ConversationHistoryPanel` and nothing else imports it from here).

- [ ] **Step 2: Drop the `conversations` prop from the type**

In `EveChatProps`, remove the `conversations: ConversationSummary[]` line:

```ts
export interface EveChatProps {
  activeId?: string
  initialSession?: SessionCursor
  initialEvents?: unknown[]
  /** True when DEEPGRAM_API_KEY is set server-side (read by EveView RSC). */
  voiceAvailable?: boolean
}
```

- [ ] **Step 3: Remove the sidebar state and destructure**

In `EveChatInner`, remove `conversations` from the destructured props and delete the `sidebarConversations` state line:

Delete:
```ts
  conversations,
```
(from the `EveChatInner` destructure) and
```ts
  const [sidebarConversations, setSidebarConversations] = useState(conversations)
```

- [ ] **Step 4: Dispatch the event in onSessionChange**

In `onSessionChange`, replace the `setSidebarConversations(...)` block with the event dispatch. The branch becomes:

```ts
      // Brand-new chat: the moment Eve assigns a session id (mid-turn), reflect it in the
      // URL (history.replaceState, NOT router.push — a push remounts EveChat and drops the
      // in-flight stream) and announce it so the sidebar-tab history panel (a separate React
      // tree) adds it live.
      if (firstSeen && !activeId) {
        const title = titleRef.current ?? 'New conversation'
        dispatchConversationCreated({ id: sid, title })
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `?conversation=${sid}`)
        }
      }
```

- [ ] **Step 5: Remove the sidebar from the render + go full-width**

In the return, delete the `<ConversationSidebar .../>` element entirely:

```tsx
      <ConversationSidebar
        conversations={sidebarConversations}
        activeId={activeId}
        onSelect={(id) => router.push(`?conversation=${id}`)}
        onNew={() => router.push('?')}
      />
```

The remaining structure (the outer `eve-scope flex` div now wrapping only the chat column with `flex-1`) already fills the width — no further layout change needed. `router` is still used elsewhere (e.g. `handleRetry`/photos), so keep the `useRouter()` call.

- [ ] **Step 6: Update EveView to stop fetching/passing conversations**

In `src/components/eve/EveView.tsx`:

- Change the import to drop `listConversations`:

```ts
import { loadConversationBySession } from '../../eve/conversations'
```

- Delete the line:

```ts
  const conversations = user ? await listConversations(req.payload, user) : []
```

- Remove the `conversations={...}` prop from `<EveChat .../>`:

```tsx
        <EveChat
          key={activeId ?? 'new'}
          activeId={activeId}
          initialSession={initialSession}
          voiceAvailable={!!process.env.DEEPGRAM_API_KEY}
        />
```

- [ ] **Step 7: Typecheck + full test run**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0 (no remaining references to `conversations`/`ConversationSidebar`/`sidebarConversations` in EveChat or EveView).
Run: `pnpm run test:int`
Expected: PASS (all suites; the multimodal test simulates the render loop and does not construct `<EveChat>`, so it is unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/components/eve/EveChat.tsx src/components/eve/EveView.tsx
git commit -m "feat(eve): full-width chat; history via sidebar tab event"
```

---

### Task 4: Remove the old nav link and sidebar component

**Files:**
- Modify: `src/payload.config.ts`
- Modify: `src/eve/__tests__/payload-config-mcp.test.ts`
- Delete: `src/components/eve/EveNavLink.tsx`
- Delete: `src/components/eve/ConversationSidebar.tsx`

- [ ] **Step 1: Remove afterNavLinks from the config**

In `src/payload.config.ts`, delete the `afterNavLinks` line so `components` is:

```ts
    components: {
      sidebar: {
        tabs: customSidebarTabs,
      },
      views: {
        eve: {
          Component: '/components/eve/EveView#EveView',
          path: '/eve',
        },
      },
    },
```

- [ ] **Step 2: Delete the now-unused files**

```bash
git rm src/components/eve/EveNavLink.tsx src/components/eve/ConversationSidebar.tsx
```

- [ ] **Step 3: Assert removal in the config test**

In `src/eve/__tests__/payload-config-mcp.test.ts`, add to the sidebar `describe`:

```ts
  it('no longer registers the standalone Eve nav link', () => {
    expect(configSource).not.toContain('afterNavLinks')
    expect(configSource).not.toContain('EveNavLink')
  })
```

- [ ] **Step 4: Verify nothing references the deleted files**

Run: `grep -rn "EveNavLink\|ConversationSidebar" src` — expected: no results.

- [ ] **Step 5: Typecheck + full test run**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.
Run: `pnpm run test:int`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(eve): remove standalone nav link + in-view conversation sidebar"
```

---

### Task 5: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Eve discovery diagnostics**

Run: `node_modules/.bin/eve info`
Expected: `Diagnostics 0 errors, 0 warnings`, `Skills 1 skill`.

- [ ] **Step 2: Production build (catches client-bundle chunking)**

Run: `pnpm build`
Expected: build completes; routes including `/admin/[[...segments]]` compile. This is the only gate that catches a stray `eve/client` import in the new client components — confirm it passes.

- [ ] **Step 3: Manual smoke (user-driven, note in report)**

Not automated (requires the running admin). The implementer notes for the human:
- `pnpm devsafe`, open `/admin` → an icon rail appears with Collections + a chat-bubble tab.
- Click the chat tab → conversation history + "New chat" in the panel.
- "New chat" → `/admin/eve`, full-width chat. Send a message → the new thread appears at the top of the panel live; its row is highlighted.
- Click another thread → loads it; refresh → last message persists (unchanged behavior).

- [ ] **Step 4: Final whole-branch review + finish**

Use superpowers:requesting-code-review for a whole-branch review against the spec, then superpowers:finishing-a-development-branch (merge to local `main`, no-ff; do NOT push — Vercel constraint).
