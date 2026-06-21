# Eve Chat as a Payload v4 Sidebar Tab — Design Spec

**Date:** 2026-06-21
**Status:** Approved design, pre-plan

## Goal

Replace `EveChat`'s internal conversation sidebar with a **native Payload v4
sidebar tab**. Conversation history moves into the global admin sidebar panel
(a dedicated "Eve chat" tab); the chat view at `/admin/eve` then uses the
**entire content area** instead of giving ~256px to an in-view sidebar.

## Background / current state

- `EveNavLink` (registered in `admin.components.afterNavLinks`) renders an "Eve
  Chat" link to `/admin/eve`.
- `EveView` (custom admin view at `/admin/eve`) wraps `DefaultTemplate` and
  renders `EveChat`. It fetches the user's conversations via
  `listConversations(req.payload, user)` and passes them to `EveChat`.
- `EveChat` (client) renders `ConversationSidebar` — a `w-64` panel with a
  "New chat" button and the conversation list — **next to** the chat
  conversation area. So the admin shows two sidebars (Payload nav + this one),
  eating horizontal space.
- Session persistence: `EveChat` POSTs to `/api/eve/session-index` (upsert of
  the `conversations` row: id, continuationToken, streamIndex, title). The
  conversation **list** is only ever produced by server render
  (`listConversations`); there is no GET-list endpoint.
- New-chat immediacy: `onSessionChange` (fires when Eve first assigns a session
  id) adds `{ id, title }` to local `sidebarConversations` state and updates the
  URL with `window.history.replaceState('?conversation=<id>')` (a `router.push`
  would remount `EveChat` and drop the in-flight stream — see the prior
  session-lifecycle fix).

## Payload v4 sidebar tabs API (verified in installed canary dist)

- Config: `admin.components.sidebar.tabs?: SidebarTab[]`
  (`node_modules/payload/dist/config/types.d.ts`). `Nav/index.js` reads it and
  renders `<SidebarTabs>`; `SidebarTab` is exported from `payload`.
- `SidebarTab = { slug: string; label?: LabelFunction | StaticLabel;
  isDefaultActive?: boolean; disabled?: boolean; components: { Icon:
  PayloadComponent; Content: CustomComponent } }`.
- The collections nav becomes an implicit tab (slug `nav`,
  `DEFAULT_NAV_TAB_SLUG`). Custom tabs are appended. With ≥2 tabs the sidebar
  shows an icon **rail** (`Icon` per tab) plus a **content panel** (active
  tab's `Content`). Clicking a tab switches **only the panel** (persisted as the
  `activeTab` nav preference); it does **not** change the route/main view.
- Active-tab resolution: saved preference → first tab with `isDefaultActive` →
  first tab. We do **not** set `isDefaultActive` (collections stays default).
- `Content` rendering (`SidebarTabs/index.js`): the active tab's `Content`
  (a `CustomComponent`) is pre-rendered server-side into `initialTabContents`;
  **non-active** `CustomComponent` tabs are **lazy-loaded** on first activation
  via the `render-tab` server function (`renderTabServerFn.js`). Server props
  passed to `Content` in both paths: `{ i18n, locale, params, payload,
  permissions, req, searchParams, user }`.
- Lazy-loadable tabs are re-validated on **every activation**
  (`handleTabChange` → `loadTabContent(slug, { revalidate: true })`), so
  re-clicking the Eve tab always re-fetches a fresh server-rendered list.
- Once a tab's content has loaded, `SidebarTabsClient` keeps it mounted and
  toggles visibility with `display:none` — so an already-opened panel stays
  mounted (and keeps receiving window events) even while another tab is active.

## Design decisions (confirmed with user)

1. **Default active tab:** Collections (Payload default). Eve chat is **not**
   `isDefaultActive`.
2. **History freshness:** update **immediately** — new conversations appear in
   the panel the moment they are created, via a cross-tree window event.
3. **Nav link:** **remove** the standalone `EveNavLink`; the tab (its icon +
   "New chat" button + session list) is the single entry point.
4. **Label/slug:** label `"Eve chat"`, slug `eve-chat`.
5. **Icon:** lucide `MessageCircle` (already a dependency).

## Architecture

Two facts drive the design:

- **The tab `Content` is a server component** with `payload`/`user`/`req` in its
  server props, so it fetches its own conversation list — identical to how
  `EveView` does it. The chat view no longer needs to fetch or pass
  conversations.
- **The sidebar tab and the chat view are separate React trees** (the tab is
  rendered inside the persistent admin layout's `Nav`; the chat view is the
  routed page's children). They share no React context. Therefore live updates
  must cross the tree boundary via a `window` `CustomEvent`, not React state or
  `router.refresh`.

### Data / update flow

```
Server render (tab activation or first load)
  EveChatTab (server) → listConversations(payload, user)
                      → <ConversationHistoryPanel initialConversations={...} />

Live update (panel already mounted)
  EveChat.onSessionChange (new session)
    → window.dispatchEvent(CustomEvent('eve:conversation-created', {detail:{id,title}}))
  ConversationHistoryPanel
    → window 'eve:conversation-created' listener → merge {id,title} to top (dedupe by id)

Navigation (from the panel)
  click row     → router.push(`/admin/eve?conversation=<id>`)
  "New chat"    → router.push(`/admin/eve`)

Active highlight
  ConversationHistoryPanel reads useSearchParams()/usePathname():
  highlight row whose id === ?conversation, only when pathname is /admin/eve
```

Cold-path correctness: if the panel was never opened, it isn't mounted and
misses the event — but opening the tab triggers a fresh server render
(`revalidate:true`), so the new conversation is present. The event matters only
while the panel is already mounted (the case the user sees).

## Components

### New
- **`src/eve/sidebar-tabs.ts`** — exports
  `customSidebarTabs: SidebarTab[]` containing one tab:
  ```ts
  {
    slug: 'eve-chat',
    label: 'Eve chat',
    components: {
      Icon: '/components/eve/EveChatTabIcon#EveChatTabIcon',
      Content: '/components/eve/EveChatTab#EveChatTab',
    },
  }
  ```
- **`src/components/eve/EveChatTabIcon.tsx`** — small client component rendering
  lucide `MessageCircle` sized for the rail.
- **`src/components/eve/EveChatTab.tsx`** — **server** component. Narrows
  `user` to the `users` collection (`user && 'collection' in user &&
  user.collection === 'users'`); if not a user, render a minimal "Sign in to
  chat" note. Otherwise `listConversations(payload, user)` →
  `<ConversationHistoryPanel initialConversations={rows.map(...)} />` where each
  item is `{ id: row.eveSessionId ?? String(row.id), title: row.title ??
  'Untitled' }`.
- **`src/components/eve/ConversationHistoryPanel.tsx`** — **client** component.
  Props: `initialConversations: ConversationSummary[]`. Behavior:
  - `useState(initialConversations)`; re-sync from props via `useEffect` when a
    fresh server list arrives (revalidation replaces the element).
  - `useEffect` adds a `window` listener for `eve:conversation-created`;
    merges `{ id, title }` to the front, deduped by id; removes listener on
    cleanup.
  - `useRouter()` (from `@payloadcms/ui`) for navigation; `useSearchParams()` +
    `usePathname()` (from `next/navigation`) to compute the active id
    (`pathname` ends with `/admin/eve` AND `searchParams.get('conversation')`).
  - Renders a "New chat" button + a scrollable list of rows, styled with
    Payload nav classes (`nav__link-wrapper`, `nav__link`) plus minimal utility
    classes, with an `--active` style for the current thread.

### Modified
- **`src/payload.config.ts`**:
  - Add `sidebar: { tabs: customSidebarTabs }` under `admin.components`.
  - Remove `afterNavLinks: ['/components/eve/EveNavLink#EveNavLink']`.
  - Keep `views.eve` (the chat view stays).
- **`src/components/eve/EveView.tsx`**: remove the `listConversations` call and
  the `conversations` prop passed to `EveChat`. Keep user narrowing, `activeId`,
  `initialSession`, and the `DefaultTemplate` wrapper.
- **`src/components/eve/EveChat.tsx`**:
  - Remove `ConversationSidebar` import, the `conversations` prop, and the
    `sidebarConversations` state and its render.
  - In `onSessionChange`, replace the `setSidebarConversations(...)` update with
    `window.dispatchEvent(new CustomEvent('eve:conversation-created', { detail:
    { id: sid, title } }))`. Keep the `history.replaceState('?conversation=...')`
    URL update unchanged.
  - The chat content area now spans full width (remove the flex row that placed
    the sidebar beside it).

### Deleted
- **`src/components/eve/ConversationSidebar.tsx`** (+ any test) — replaced by
  `ConversationHistoryPanel`.
- **`src/components/eve/EveNavLink.tsx`** — replaced by the tab.

### Shared types
- `ConversationSummary = { id: string; title: string }` — currently exported
  from `ConversationSidebar.tsx`. Move it to `ConversationHistoryPanel.tsx` (or a
  small shared module) and update the re-export in `EveChat.tsx` if anything
  still imports it.

## The `eve:conversation-created` event contract

```ts
// dispatched by EveChat when Eve first assigns a session id for a new thread
new CustomEvent('eve:conversation-created', {
  detail: { id: string /* eveSessionId */, title: string },
})
```

- Fired **once** per new thread, from the existing `firstSeen && !activeId`
  branch of `onSessionChange`.
- The title is `titleRef.current ?? 'New conversation'` (the first user
  message), matching today's behavior. Titles do not change after creation, so
  no separate update event is needed. (If AI-generated titles are added later,
  a sibling `eve:conversation-updated` event would extend this.)
- The panel is the only listener. Merge semantics: if `id` already present,
  move/refresh it to the top; else prepend.

## Styling

The panel renders inside Payload's `Nav`, not inside `EveView`'s `.eve-scope`.
Use Payload's native nav classes (`nav__link-wrapper`, `nav__link`) for rows and
the New-chat button so it matches the shell, with minimal Tailwind utilities for
layout (column, gap, scroll). Do **not** wrap it in `.eve-scope` (that scope is
for the chat surface). This follows the project note that v4 admin is
Tailwind-first; no isolation needed.

## Testing

- **`ConversationHistoryPanel.test.tsx`** (new):
  - renders the initial list and the "New chat" button;
  - highlights the row matching `?conversation=<id>` when on `/admin/eve`;
  - merges an `eve:conversation-created` event (prepend; dedupe by id);
  - "New chat" / row click call `router.push` with the right paths.
  Mock `useRouter` (`@payloadcms/ui`), `useSearchParams`/`usePathname`
  (`next/navigation`); use `fireEvent`/`act` to flush state (RTL has no
  jest-dom here — plain assertions).
- **`payload-config` test** (extend existing static-source test): assert the
  config registers `sidebar`/`customSidebarTabs` and **no longer** references
  `EveNavLink`/`afterNavLinks`.
- **EveChat tests**: update any that referenced `ConversationSidebar` /
  `conversations` prop / `sidebarConversations`. Verify a new chat dispatches
  `eve:conversation-created` (spy on `window.dispatchEvent`).
- **Delete** `ConversationSidebar` tests if present.
- Gates: `pnpm run test:int`, `pnpm exec tsc --noEmit`, `node_modules/.bin/eve
  info` (0 diagnostics + 1 skill), and a real `pnpm build` (the only thing that
  catches client-bundle chunking — `EveChatTab` is a server component importing a
  client child, and `EveChatTabIcon`/panel are client; confirm no `eve/client`
  barrel creeps in).

## Risks / constraints

- **Canary feature.** Sidebar tabs is in the installed v4 canary dist (types +
  `Nav` wiring + `SidebarTabs` client + `render-tab` server fn all present) but
  v4 admin is pre-alpha; the API may shift on a future canary bump. Acceptable
  per user request; noted here.
- **First-open latency.** Eve isn't the default tab, so its panel lazy-loads on
  first click (one server round-trip). Expected; matches Payload's model.
- **Do not push to `main`.** `main` is Vercel-connected; a push can auto-deploy
  and spend. Work stays local/unpushed; merge to local `main` only.
- **Component path strings** use the `/components/...#Export` form resolved by
  the admin `importMap` (`baseDir: src`), same as the existing `views.eve` and
  `afterNavLinks` entries.

## Out of scope

- AI-generated conversation titles (titles remain the first user message).
- Renaming/deleting conversations from the panel.
- Making Eve the default tab, or any multi-tab UX beyond this one tab.
- A GET-list conversations endpoint (the server render + window event suffice).
