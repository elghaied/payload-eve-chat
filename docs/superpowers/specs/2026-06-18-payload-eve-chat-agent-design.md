# Payload + Vercel AI SDK Chat Agent — Design

**Date:** 2026-06-18
**Status:** Approved (design); implementation plan pending
**Purpose:** A shareable, well-organized example showing how to build a chat agent inside a
Payload CMS admin using the Vercel AI SDK, where the agent operates the CMS entirely through
Payload's own MCP server.

---

## 1. Goal & Showcase

One-sentence showcase: **Payload exposes its collections over MCP, and an in-admin chat agent
built on the Vercel AI SDK operates the CMS entirely through those MCP tools — provider-swappable
between Claude and GPT.**

This is an *example project* meant to be read and copied. Clarity and clean organization are
explicit requirements, on par with it working. Favor small, single-purpose files with clear names;
group related code in folders; avoid kawlya-specific complexity (no billing, plan-gating,
multi-tenancy, file attachments, or streaming confirmation cards).

## 2. Decisions (locked)

| Decision            | Choice                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| AI engine           | Vercel AI SDK (`ai`, `@ai-sdk/react`)                                  |
| Provider            | Provider-agnostic; default Anthropic (latest Claude), OpenAI swappable |
| Agent ↔ Payload     | MCP: agent is an MCP **client** of Payload's `@payloadcms/plugin-mcp`  |
| Chat UI             | Vercel **AI Elements** (shadcn/Tailwind based)                        |
| Demo collections    | `Posts` + `Tasks`                                                      |
| Persistence         | `Conversations` collection (threads + messages), with history sidebar  |
| Access              | Admin-only (lives inside the Payload admin)                            |
| MCP write surface   | Expose find/create/update for Posts & Tasks; **no delete** (safer demo)|

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Payload Admin (Next.js / React 19)                              │
│                                                                 │
│  Custom view  /admin/eve                                        │
│   EveView (server) ──► EveChat (client, AI Elements + useChat)  │
│                              │ POST /api/eve                     │
└──────────────────────────────┼──────────────────────────────────┘
                               ▼
                  src/app/(payload)/api/eve/route.ts
                   - payload.auth() (admin-only)
                   - load/create Conversation
                   - streamText({ model, tools, system })
                   - persist UIMessage[] onFinish
                          │              │
              provider.ts ▼              ▼ mcp-client.ts
        (anthropic | openai)      createMCPClient(HTTP)
                                          │
                                          ▼
                            POST /api/mcp  (@payloadcms/plugin-mcp)
                                          │
                                          ▼
                       Payload Local API → Posts / Tasks
```

Note: the agent reaches Payload via an HTTP MCP round-trip to the same server. This is
intentional — it is the honest, faithful demonstration of the MCP integration, and is exactly how
an external MCP client (Cursor, Claude Desktop, etc.) would connect too.

## 4. File Organization

Clean grouping is a requirement. Domain code for the agent lives under a single `eve/` folder
(server) and `components/eve/` (UI). Demo collections are grouped separately from infrastructure
collections.

```
src/
├── collections/
│   ├── Users.ts                 # existing (admin auth)
│   ├── Media.ts                 # existing
│   ├── Conversations.ts         # chat persistence (threads + messages JSON)
│   └── demo/                    # collections the agent operates on
│       ├── Posts.ts
│       └── Tasks.ts
│
├── eve/                         # server-side agent (no React here)
│   ├── config.ts                # env reading: provider, keys, MCP base URL
│   ├── provider.ts              # resolveModel() — anthropic | openai
│   ├── mcp-client.ts            # connect to Payload MCP, return tools(), close()
│   ├── system-prompt.ts         # the agent's instructions
│   └── conversations.ts         # load/create/save conversation helpers (Local API)
│
├── components/
│   ├── ui/                      # shadcn primitives (generated)
│   ├── ai-elements/             # Vercel AI Elements components (generated)
│   └── eve/                     # the chat feature UI
│       ├── EveView.tsx          # server: DefaultTemplate shell + auth + data load
│       ├── EveChat.tsx          # client: useChat + AI Elements wiring
│       ├── ConversationSidebar.tsx
│       └── eve.css              # Tailwind entry, scoped to the Eve view
│
├── app/(payload)/
│   └── api/eve/route.ts         # the chat endpoint (Next route handler)
│
└── payload.config.ts           # register collections, mcpPlugin, the /eve view + nav
```

Naming conventions: collections are `PascalCase.ts` exporting a named `CollectionConfig` (matches
existing `Users.ts`/`Media.ts`); agent modules are `kebab-case.ts` with named exports; React
components are `PascalCase.tsx`. Each file has one clear responsibility.

## 5. Components in Detail

### 5.1 Collections

- **`Posts`** — `title` (text, required), `content` (richText), `status` (select:
  draft/published, default draft), `author` (relationship→users). `admin.useAsTitle: 'title'`.
- **`Tasks`** — `title` (text, required), `done` (checkbox, default false), `priority` (select:
  low/medium/high, default medium), `dueDate` (date, optional).
- **`Conversations`** — `title` (text), `user` (relationship→users), `messages` (json — stores the
  AI SDK `UIMessage[]` verbatim), timestamps. `access.read/update` restricted to the owning user.
- **`payload-mcp-api-keys`** — added automatically by the MCP plugin (not authored by us).

### 5.2 MCP plugin

- `@payloadcms/plugin-mcp` pinned to the release matching Payload `3.85.x`. (The plugin's config
  API differs between Payload v3 and v4 — the plan must confirm the exact version/API; this design
  assumes per-collection tool configuration is available.)
- Expose **Posts** and **Tasks** with find/create/update tools. **No delete.** Do not expose
  Users, Conversations, or the api-keys collection.

### 5.3 Agent (`src/eve/`)

- **`config.ts`** — reads `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MCP_API_KEY`
  (optional in dev), `MCP_SERVER_URL` (default `http://localhost:3000/api/mcp`). Single source of
  truth for env; throws clear errors when a required key is missing.
- **`provider.ts`** — `resolveModel()` returns a Vercel AI SDK `LanguageModel` based on
  `AI_PROVIDER`. Default `anthropic` → latest Claude model id; `openai` → a current GPT model.
- **`mcp-client.ts`** — `createPayloadMcpTools()` builds an MCP client via
  `createMCPClient({ transport: { type: 'http', url, headers } })`, returns `{ tools, close }`.
  Bearer header included only when `MCP_API_KEY` is set (dev needs none).
- **`system-prompt.ts`** — concise instructions: you manage Posts and Tasks for the user via the
  provided tools; confirm what you changed; don't invent data.
- **`conversations.ts`** — `loadConversation(id, user)`, `createConversation(user)`,
  `saveMessages(id, messages, user)` using the Local API with `overrideAccess: false`.

### 5.4 Chat endpoint (`src/app/(payload)/api/eve/route.ts`)

`POST` handler:
1. `getPayload({ config })`, then `payload.auth({ headers })` → reject 401 if no admin user.
2. Parse `{ messages, conversationId }` from the request.
3. Load or create the conversation for this user.
4. Open MCP tools; `streamText({ model: resolveModel(), system, messages, tools, stopWhen: stepCountIs(5) })`.
5. Return `result.toUIMessageStreamResponse()`.
6. In `onFinish`, persist the full `UIMessage[]` to the conversation; close the MCP client.

### 5.5 View (`src/components/eve/`)

- **`EveView.tsx`** (server, `AdminViewServerProps`) — renders inside Payload's `DefaultTemplate`,
  gets `req.user` (admin gate), loads the user's conversations, passes them + the active
  conversation's messages to `EveChat`.
- **`EveChat.tsx`** (client) — `useChat({ api: '/api/eve' })`; renders with AI Elements
  `Conversation`, `Message`, `Response` (markdown), `PromptInput`; renders tool calls with the
  `Tool` component so the MCP calls are visible. Full-height layout. "New chat" button.
- **`ConversationSidebar.tsx`** — lists past conversations, switch/new, like kawlya's history.

### 5.6 Tailwind ↔ Payload admin (the integration risk)

AI Elements is shadcn/Tailwind v4 based; Payload admin is SCSS. Mitigation:
- Add Tailwind v4 with its stylesheet imported **only** by the Eve view (`eve.css`).
- Disable Tailwind Preflight (or wrap it in a scoped `@layer` under a root class) so it cannot
  reset Payload's admin styles.
- Generate shadcn primitives into `components/ui` and AI Elements into `components/ai-elements`
  via their CLIs.
- Acceptance: the Eve view renders cleanly AND the rest of the Payload admin is visually
  unchanged. This must be verified in a browser before the feature is called done.

## 6. Configuration & Env

`.env.example` gains:
```
AI_PROVIDER=anthropic            # or: openai
ANTHROPIC_API_KEY=...            # required when AI_PROVIDER=anthropic
OPENAI_API_KEY=...               # required when AI_PROVIDER=openai
MCP_API_KEY=                     # optional in dev; required in production
MCP_SERVER_URL=http://localhost:3000/api/mcp
```

## 7. Errors & Edge Cases

- Missing provider key → endpoint returns a clear 500 with a readable message (caught in `config.ts`).
- Unauthenticated request to `/api/eve` → 401.
- MCP client failure → surface a friendly assistant error; always `close()` the client.
- Conversation not owned by the user → treated as not found (access control via `overrideAccess: false`).
- `stopWhen: stepCountIs(5)` bounds the agent loop so a misbehaving model can't loop forever.

## 8. Testing & Verification

- Type-check + lint pass (`pnpm generate:types`, `pnpm lint`).
- Manual/browser verification: send "create a task to buy milk", confirm a `Tasks` doc is created
  via the MCP tool and the tool call is visible in the UI; reload and confirm the conversation
  persisted; switch provider via env and confirm it still works; confirm admin styling intact.
- (Stretch) An integration test hitting `/api/eve` with a mocked model is optional for an example;
  prioritize the manual demo path.

## 9. README

Add an "AI Chat Agent" section explaining the architecture (the diagram above), the env setup,
how to get an MCP API key for production, and how to switch providers — so the repo stands alone as
a teaching example.

## 10. Out of Scope (YAGNI)

Billing, plan-gating, multi-tenancy, file/image attachments, streaming confirmation/approval cards,
i18n label tables, voice — all kawlya-specific and intentionally excluded.
