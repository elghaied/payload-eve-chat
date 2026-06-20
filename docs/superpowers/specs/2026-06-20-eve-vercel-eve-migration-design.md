# Migrating Eve from the Vercel AI SDK to the Vercel Eve framework — Design

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan pending
**Branch context:** The current Vercel AI SDK implementation is preserved on the **`ai-sdk`**
branch (pushed to origin). This migration lands on **`main`**.

**Purpose:** Replace this project's hand-wired chat agent — built on the Vercel **AI SDK**
(`streamText` + a manual MCP client) — with an agent built on Vercel's **Eve** framework
(`vercel/eve`, `eve.dev`), embedded in the existing Payload CMS / Next.js app and deployed on
Vercel.

---

## 1. Background & motivation

The agent in this repo is named "Eve" but is built on the Vercel **AI SDK** (`ai`,
`@ai-sdk/react`, `@ai-sdk/mcp`). Vercel's **Eve** framework (a separate product — a
filesystem-first framework for durable backend agents) launched 2026-06-17, one day before this
project's original design spec was written. The intended foundation was the Eve framework; the
implementation diverged to the AI SDK. This migration corrects that.

The AI SDK version is not discarded — it remains on the `ai-sdk` branch as a working reference and
rollback point.

## 2. Goal & scope

**Goal:** The in-admin chat agent at `/admin/eve` operates Posts & Tasks through the existing
Payload MCP server, but driven by the **Eve framework** (durable sessions, AI Gateway model
routing) instead of the AI SDK, deployed on Vercel.

**In scope (this pass):**
- Eve agent project (`agent/`) embedded in this repo via `eve init .`.
- Core chat: `/admin/eve` UI on `useEveAgent`, streaming from Eve's HTTP channel.
- Posts & Tasks operated via the **existing** Payload MCP server, wired as an Eve MCP connection.
- Payload admin auth bridged into Eve (admin-only preserved).
- Conversation history sidebar preserved.
- Deployment on Vercel (AI Gateway models, hosted MongoDB).

**Deferred (later passes, not in this migration):**
- Post preview / approve-before-create (`proposePost`).
- Web search + read-URL (`webSearch` / `readUrl`, SearXNG).
- Voice (STT/TTS).
- A new code-execution tool powered by **Vercel Sandbox**.

These deferred features' source files (`src/eve/propose-tool.ts`, `web-search.ts`, `read-url.ts`,
`audio.ts`, the voice components, `PostPreviewPanel.tsx`, the transcribe/speak routes) remain in
the tree but are **not wired into the Eve agent** in this pass. They will be re-homed onto Eve in
follow-up specs.

## 3. Decisions (locked)

| Decision | Choice |
| --- | --- |
| Agent framework | **Vercel Eve** (`eve`), embedded via `eve init .` |
| Deployment | Vercel cloud, Eve-native (Functions, Workflows, AI Gateway, Observability) |
| App topology | **Single app** — Eve mounts into the existing Next.js/Payload app, same origin, same deploy |
| Model routing | **AI Gateway** model strings (default `anthropic/claude-sonnet-4-6`) |
| Agent ↔ Payload | Eve **MCP client connection** to the existing `@payloadcms/plugin-mcp` server at `/api/mcp` (server unchanged) |
| Frontend | `useEveAgent` (Eve Next.js hook) replaces `useChat`, same-origin + cookie auth |
| Auth | Custom Eve channel `AuthFn` validates the Payload admin cookie (`payload.auth()`); admin-only preserved |
| Persistence | Eve durable sessions own message storage; a **thin `Conversations` index** keeps the sidebar |
| Rollback | `ai-sdk` branch |

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Payload Admin (Next.js / React 19) — custom view /admin/eve        │
│   EveView (server) ─► EveChat (client)                             │
│        useEveAgent()  ── same-origin, Payload cookie ──┐           │
└────────────────────────────────────────────────────────┼──────────┘
                                                          ▼
                         Eve channel (mounted in this app)  /eve/v1/session*
                          agent/channels/eve.ts
                          auth: [appAuth(payload.auth), localDev(), vercelOidc()]
                                                          │  (admin-only gate)
                                                          ▼
                          Eve runtime  (agent/agent.ts + agent/instructions.md)
                          model: AI Gateway "anthropic/claude-sonnet-4-6"
                          durable session (Vercel Workflows)
                                                          │
                          agent/connections/payload-mcp.ts (MCP client)
                                                          ▼
                          POST /api/mcp  (@payloadcms/plugin-mcp)  ← unchanged
                                                          ▼
                          Payload Local API → Posts / Tasks
```

### 4.1 The `agent/` directory (new)
- **`agent/instructions.md`** — system prompt. Ported from `src/eve/system-prompt.ts` (chat
  behavior + Posts/Tasks guidance only; preview/search/voice instructions dropped for this pass).
- **`agent/agent.ts`** — `defineAgent({ model: 'anthropic/claude-sonnet-4-6' })`. The model id is
  read from an env var so it stays swappable.
- **`agent/connections/payload-mcp.ts`** — `defineMcpClientConnection({ url: MCP_SERVER_URL,
  ... })`. In production the connection sends the Bearer `MCP_API_KEY`; in dev the Payload MCP
  endpoint's dev `overrideAuth` accepts no key (existing behavior). Exposes Posts/Tasks
  `find`/`create`/`update` and `createDocumentFromMarkdown` to the model.
- **`agent/channels/eve.ts`** — `eveChannel({ auth: [appAuth, localDev(), vercelOidc()] })`.
  `appAuth: AuthFn<Request>` calls Payload's auth against the request cookies; returns a
  `principalType: 'user'` principal for admins, or `null` to reject. This replaces the
  `payload.auth()` gate that lived in `src/app/api/eve/route.ts`.

### 4.2 Existing app changes
- **`src/components/eve/EveChat.tsx`** — replace `useChat` (`@ai-sdk/react`) with `useEveAgent`
  (`eve`). A small adapter maps Eve's NDJSON lifecycle events → the message/tool-part shape the
  AI Elements components already render, so the visual chat UI is largely retained.
- **`src/components/eve/EveView.tsx`**, **`EveNavLink.tsx`**, **`ConversationSidebar.tsx`** — kept;
  the sidebar's data source changes per §4.3.
- **Deleted:** `src/app/api/eve/route.ts` (chat route), `src/eve/mcp-client.ts` (manual MCP
  client), `src/eve/provider.ts` (provider resolution — superseded by AI Gateway), and the AI-SDK
  chat glue in `src/eve/conversations.ts` that is replaced by Eve sessions. AI-SDK chat deps
  (`@ai-sdk/react`, `@ai-sdk/mcp`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) are removed once nothing
  references them; `ai` and `zod` stay (Eve depends on them).
- **Untouched this pass:** the deferred-feature files in §2, and the `transcribe`/`speak` routes.

### 4.3 Conversation history / sidebar
Eve owns durable per-session message storage. To preserve the existing sidebar with minimal
change, keep a **thin `Conversations` collection** holding only `{ eveSessionId, title, user,
createdAt, updatedAt }` — no message bodies.

- **New chat:** create an Eve session; create one `Conversations` row keyed by its `eveSessionId`,
  owned by the current admin user.
- **List threads:** the sidebar queries `Conversations` filtered to the current user.
- **Open thread:** resume the Eve session by id and stream its history into the UI.

If the Eve API can list and replay a user's sessions directly (to be confirmed in planning), the
collection can be dropped and the sidebar can read sessions from Eve instead. If Eve cannot replay
prior turns to a reattaching browser client, the `Conversations` row additionally caches the
rendered transcript so reopened threads display immediately.

### 4.4 Data flow
Browser (`useEveAgent`, Payload cookie) → same-origin `POST /eve/v1/session` → `appAuth` validates
admin → Eve model loop (AI Gateway model) → agent invokes Posts/Tasks tools through the Payload MCP
connection → Payload Local API → NDJSON lifecycle events stream back → UI renders. The session is
durable and resumes across cold starts and deploys.

## 5. Environment & infrastructure

| Concern | Today (AI SDK, self-host) | After (Eve, Vercel) |
| --- | --- | --- |
| Model | `AI_PROVIDER` + provider key / Ollama | **AI Gateway** model string; OIDC on Vercel, `AI_GATEWAY_API_KEY` (or a direct provider key) for local dev. `AI_PROVIDER` / `OLLAMA_*` retire. |
| Database | local MongoDB / Docker | **MongoDB Atlas** for the Vercel deploy; local Mongo still fine for `pnpm dev`. |
| MCP | `MCP_SERVER_URL`, `MCP_API_KEY` | unchanged. |
| Durability/observability | none | Vercel Workflows + Observability (built in). |

`.env.example` and the README's "Environment setup" / "Switching providers" sections are updated to
the AI Gateway path; the Ollama section is removed (or moved to an "AI SDK version: see `ai-sdk`
branch" note).

## 6. Testing

- **Unit:** `appAuth` (cookie → admin principal; non-admin/anonymous → `null`); the MCP connection
  config (prod sends Bearer key, dev sends none).
- **E2E (Playwright, already configured):** load `/admin/eve` as an admin, send "create a task
  called X", assert the Task is created and the assistant confirms. A second test reopens a past
  thread from the sidebar and asserts its history renders.
- Existing unit tests for deferred files (`web-search`, `read-url`, `audio`, etc.) stay green —
  those modules are untouched.

## 7. Risks & mitigations (Eve is days-old public beta)

1. **API churn** — `eve@0.11.x`, beta; APIs may change before GA. *Mitigation:* pin the exact Eve
   version; `ai-sdk` branch is the rollback.
2. **Next.js mount** — exact mechanism serving `/eve/v1/*` inside this app and any conflict with
   Payload's `(payload)` route group / catch-all. *Mitigation:* verify the mount immediately at
   the start of implementation, before porting tools or UI.
3. **Session replay to a reattaching browser** — if Eve can't stream prior turns on reopen, the
   thin `Conversations` index caches the rendered transcript (§4.3).
4. **AI Gateway local-dev auth** — no OIDC locally. *Mitigation:* `AI_GATEWAY_API_KEY` or a direct
   provider key for `pnpm dev`.
5. **Auth bridge fidelity** — Eve's `AuthFn` must reproduce the exact admin-only guarantee of the
   old `payload.auth()` route. *Mitigation:* unit-test non-admin and anonymous rejection.

## 8. Out of scope / non-goals

- Re-homing post-preview, web search, voice (separate follow-up specs).
- Building a Vercel Sandbox code-execution tool (separate follow-up spec).
- Changing the Payload MCP server, the Posts/Tasks collections, or the MCP write surface.
- Multi-provider local self-hosting of Eve (this project chose the Vercel-cloud path).
