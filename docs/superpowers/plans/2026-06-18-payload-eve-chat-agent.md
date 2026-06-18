# Payload + Vercel AI SDK Chat Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-admin chat agent for this Payload app, powered by the Vercel AI SDK, that operates the CMS entirely through Payload's own MCP server — provider-swappable between Claude and GPT.

**Architecture:** A custom Payload admin view (`/admin/eve`) renders a Vercel AI Elements chat UI driven by `useChat`. It posts to a Next route handler (`/api/eve`) that authenticates the admin user, connects to Payload's MCP server (`/api/mcp`, exposed by `@payloadcms/plugin-mcp`) as an MCP **client**, hands those tools to `streamText`, streams the response back, and persists the conversation to a `Conversations` collection.

**Tech Stack:** Payload 3.85.1, Next.js 16, React 19, MongoDB, `@payloadcms/plugin-mcp@3.85.1`, Vercel AI SDK v6 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/mcp`), AI Elements (shadcn/Tailwind v4), Zod, Vitest.

## Global Constraints

- Payload version is pinned at `3.85.1`. Use `@payloadcms/plugin-mcp@3.85.1` (peer `payload: 3.85.1`) — this is the **v3** config API (`enabled: { find, create, update }` per collection), NOT the v4 opt-out API.
- Package manager is **pnpm**.
- This is a teaching example: clean code and logical file grouping are first-class requirements. Server agent code lives under `src/eve/`; chat UI under `src/components/eve/`; demo collections under `src/collections/demo/`; generated shadcn primitives under `src/components/ui/`; generated AI Elements under `src/components/ai-elements/`.
- Naming: collections are `PascalCase.ts` exporting a named `CollectionConfig`; agent modules are `kebab-case.ts` with named exports; React components are `PascalCase.tsx`.
- Provider-agnostic: default provider `anthropic`; model ids overridable via env (`ANTHROPIC_MODEL` default `claude-sonnet-4-6`, `OPENAI_MODEL` default `gpt-4o`).
- The chat view is admin-only (gated by `payload.auth`).
- MCP write surface: Posts & Tasks get `find`/`create`/`update` only — **no delete**. Do not expose Users, Conversations, or the api-keys collection.
- Run `pnpm generate:types` after any collection change; run `pnpm lint` before each commit.
- After editing `payload.config.ts` admin components/views, run `pnpm generate:importmap`.
- A note on TDD: pure logic modules (`src/eve/config.ts`, `src/eve/provider.ts`) are built test-first with Vitest. Config-, integration-, and UI-heavy tasks (plugin wiring, the route, AI Elements view) are verified with typecheck + `curl`/browser checks, since they depend on a live DB/model and a browser — their verification steps are explicit and mandatory.

---

## File Structure

```
src/
├── collections/
│   ├── Users.ts                 # existing
│   ├── Media.ts                 # existing
│   ├── Conversations.ts         # NEW — chat persistence
│   └── demo/
│       ├── Posts.ts             # NEW
│       └── Tasks.ts             # NEW
├── eve/                         # NEW — server agent (no React)
│   ├── config.ts                # env reading + validation
│   ├── provider.ts              # resolveModel(): anthropic | openai
│   ├── mcp-client.ts            # connect to Payload MCP, return tools + close
│   ├── system-prompt.ts         # agent instructions
│   └── conversations.ts         # load/create/save helpers (Local API)
├── components/
│   ├── ui/                      # NEW — shadcn primitives (generated)
│   ├── ai-elements/             # NEW — AI Elements (generated)
│   └── eve/                     # NEW — chat feature UI
│       ├── EveView.tsx          # server admin view
│       ├── EveChat.tsx          # client chat
│       ├── ConversationSidebar.tsx
│       └── eve.css              # Tailwind entry, scoped to the view
├── app/(payload)/
│   └── api/eve/route.ts         # NEW — chat endpoint
└── payload.config.ts            # MODIFY — collections, plugin, view, nav
```

---

## Task 1: Demo collections (Posts + Tasks)

**Files:**
- Create: `src/collections/demo/Posts.ts`
- Create: `src/collections/demo/Tasks.ts`
- Modify: `src/payload.config.ts` (imports + `collections` array)

**Interfaces:**
- Produces: `Posts` and `Tasks` named `CollectionConfig` exports with slugs `posts` and `tasks`.

- [ ] **Step 1: Create `src/collections/demo/Posts.ts`**

```ts
import type { CollectionConfig } from 'payload'

/**
 * A classic blog collection. The chat agent reads and writes these via MCP.
 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'author', 'updatedAt'],
    group: 'Content',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'content', type: 'richText' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
    },
    { name: 'author', type: 'relationship', relationTo: 'users' },
  ],
  timestamps: true,
}
```

- [ ] **Step 2: Create `src/collections/demo/Tasks.ts`**

```ts
import type { CollectionConfig } from 'payload'

/**
 * A simple to-do collection. The chat agent manages these via MCP.
 */
export const Tasks: CollectionConfig = {
  slug: 'tasks',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'done', 'priority', 'dueDate'],
    group: 'Content',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'done', type: 'checkbox', defaultValue: false },
    {
      name: 'priority',
      type: 'select',
      defaultValue: 'medium',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
    },
    { name: 'dueDate', type: 'date' },
  ],
  timestamps: true,
}
```

- [ ] **Step 3: Register both in `src/payload.config.ts`**

Replace the existing import block and `collections` array:

```ts
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Posts } from './collections/demo/Posts'
import { Tasks } from './collections/demo/Tasks'
```

```ts
  collections: [Users, Media, Posts, Tasks],
```

- [ ] **Step 4: Generate types**

Run: `pnpm generate:types`
Expected: completes with no error; `src/payload-types.ts` now contains `Post` and `Task` interfaces.

- [ ] **Step 5: Verify the dev server boots and the collections appear**

Run: `pnpm dev` (then stop it once it compiles)
Expected: no config error; the admin nav shows "Posts" and "Tasks" under a "Content" group.

- [ ] **Step 6: Commit**

```bash
git add src/collections/demo/Posts.ts src/collections/demo/Tasks.ts src/payload.config.ts src/payload-types.ts
git commit -m "feat: add Posts and Tasks demo collections"
```

---

## Task 2: Conversations collection

**Files:**
- Create: `src/collections/Conversations.ts`
- Modify: `src/payload.config.ts` (import + `collections` array)

**Interfaces:**
- Produces: `Conversations` `CollectionConfig`, slug `conversations`, fields: `title` (text), `user` (relationship→users), `messages` (json, holds AI SDK `UIMessage[]`). Read/update/delete restricted to the owning user; create requires a logged-in user.

- [ ] **Step 1: Create `src/collections/Conversations.ts`**

```ts
import type { Access, CollectionConfig } from 'payload'

/** A user may only see and change their own conversations. */
const ownConversations: Access = ({ req }) => {
  if (!req.user) return false
  return { user: { equals: req.user.id } }
}

/**
 * Stores chat threads for the Eve agent. `messages` holds the AI SDK
 * `UIMessage[]` verbatim so the client can rehydrate a thread on reload.
 */
export const Conversations: CollectionConfig = {
  slug: 'conversations',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'user', 'updatedAt'],
    group: 'Eve',
  },
  access: {
    read: ownConversations,
    update: ownConversations,
    delete: ownConversations,
    create: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'messages', type: 'json' },
  ],
  timestamps: true,
}
```

- [ ] **Step 2: Register in `src/payload.config.ts`**

```ts
import { Conversations } from './collections/Conversations'
```

```ts
  collections: [Users, Media, Posts, Tasks, Conversations],
```

- [ ] **Step 3: Generate types**

Run: `pnpm generate:types`
Expected: `src/payload-types.ts` contains a `Conversation` interface with `messages?: ... | null`.

- [ ] **Step 4: Commit**

```bash
git add src/collections/Conversations.ts src/payload.config.ts src/payload-types.ts
git commit -m "feat: add Conversations collection for chat persistence"
```

---

## Task 3: Install & wire the Payload MCP plugin

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/payload.config.ts` (`plugins` array)

**Interfaces:**
- Produces: a working MCP endpoint at `POST /api/mcp` exposing `posts` and `tasks` with find/create/update tools. In dev, no auth required.

- [ ] **Step 1: Install the plugin (version-pinned)**

Run: `pnpm add @payloadcms/plugin-mcp@3.85.1`
Expected: installs with no peer-dependency warning against `payload@3.85.1`.

- [ ] **Step 2: Configure the plugin in `src/payload.config.ts`**

Add the import:

```ts
import { mcpPlugin } from '@payloadcms/plugin-mcp'
```

Replace `plugins: []` with:

```ts
  plugins: [
    mcpPlugin({
      collections: {
        posts: {
          description:
            'Blog posts. Use find to list/read, create to add, update to edit. Fields: title, content, status (draft|published), author.',
          enabled: { find: true, create: true, update: true },
        },
        tasks: {
          description:
            'To-do tasks. Use find to list/read, create to add, update to edit. Fields: title, done (boolean), priority (low|medium|high), dueDate.',
          enabled: { find: true, create: true, update: true },
        },
      },
    }),
  ],
```

- [ ] **Step 3: Generate types (the plugin adds the `payload-mcp-api-keys` collection)**

Run: `pnpm generate:types`
Expected: completes; a `PayloadMcpApiKey` (or similar) interface appears in `payload-types.ts`.

- [ ] **Step 4: Verify the MCP endpoint lists the tools (dev mode, no auth)**

Start `pnpm dev`, then run:

```bash
curl -s 'http://localhost:3000/api/mcp' \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```

Expected: a JSON-RPC result whose `tools` array contains entries for finding/creating/updating `posts` and `tasks` (tool names are generated by the plugin, e.g. containing `posts`/`tasks`). Record the exact tool names seen — they confirm the agent will receive them. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/payload.config.ts src/payload-types.ts
git commit -m "feat: expose Posts and Tasks over MCP via @payloadcms/plugin-mcp"
```

---

## Task 4: Agent config + provider resolution (TDD)

**Files:**
- Create: `src/eve/config.ts`
- Create: `src/eve/provider.ts`
- Test: `src/eve/config.test.ts`
- Test: `src/eve/provider.test.ts`

**Interfaces:**
- Produces:
  - `type EveConfig = { provider: 'anthropic' | 'openai'; anthropicApiKey?: string; openaiApiKey?: string; anthropicModel: string; openaiModel: string; mcpServerUrl: string; mcpApiKey?: string }`
  - `getEveConfig(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): EveConfig` — throws `Error` with a readable message if the active provider's API key is missing.
  - `resolveModel(config: EveConfig): LanguageModel` (from `ai`).

- [ ] **Step 1: Install AI SDK packages**

Run: `pnpm add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/mcp @ai-sdk/react zod`
Expected: installs (`ai@6.x`, `@ai-sdk/react@3.x`, providers `@3.x`, `@ai-sdk/mcp@1.x`, `zod@4.x`).

- [ ] **Step 2: Write the failing test `src/eve/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { getEveConfig } from './config'

describe('getEveConfig', () => {
  it('defaults to anthropic with default model and requires its key', () => {
    const cfg = getEveConfig({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(cfg.provider).toBe('anthropic')
    expect(cfg.anthropicModel).toBe('claude-sonnet-4-6')
    expect(cfg.mcpServerUrl).toBe('http://localhost:3000/api/mcp')
  })

  it('throws a readable error when the anthropic key is missing', () => {
    expect(() => getEveConfig({})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('selects openai and validates its key', () => {
    const cfg = getEveConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-o' })
    expect(cfg.provider).toBe('openai')
    expect(cfg.openaiModel).toBe('gpt-4o')
    expect(() => getEveConfig({ AI_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/)
  })

  it('honors model and mcp overrides', () => {
    const cfg = getEveConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-opus-4-8',
      MCP_SERVER_URL: 'http://localhost:4000/api/mcp',
      MCP_API_KEY: 'mcp-key',
    })
    expect(cfg.anthropicModel).toBe('claude-opus-4-8')
    expect(cfg.mcpServerUrl).toBe('http://localhost:4000/api/mcp')
    expect(cfg.mcpApiKey).toBe('mcp-key')
  })
})
```

- [ ] **Step 3: Run it; verify it fails**

Run: `pnpm test:int src/eve/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 4: Implement `src/eve/config.ts`**

```ts
export type EveProvider = 'anthropic' | 'openai'

export type EveConfig = {
  provider: EveProvider
  anthropicApiKey?: string
  openaiApiKey?: string
  anthropicModel: string
  openaiModel: string
  mcpServerUrl: string
  mcpApiKey?: string
}

type Env = Record<string, string | undefined>

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const DEFAULT_MCP_SERVER_URL = 'http://localhost:3000/api/mcp'

/**
 * Reads and validates the Eve agent configuration from the environment.
 * Throws a readable error if the active provider's API key is missing.
 */
export function getEveConfig(env: Env = process.env): EveConfig {
  const provider: EveProvider = env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic'

  const config: EveConfig = {
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    mcpServerUrl: env.MCP_SERVER_URL || DEFAULT_MCP_SERVER_URL,
    mcpApiKey: env.MCP_API_KEY,
  }

  if (provider === 'anthropic' && !config.anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY (AI_PROVIDER=anthropic).')
  }
  if (provider === 'openai' && !config.openaiApiKey) {
    throw new Error('Missing OPENAI_API_KEY (AI_PROVIDER=openai).')
  }

  return config
}
```

- [ ] **Step 5: Run config tests; verify they pass**

Run: `pnpm test:int src/eve/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing test `src/eve/provider.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { resolveModel } from './provider'
import type { EveConfig } from './config'

const base: EveConfig = {
  provider: 'anthropic',
  anthropicApiKey: 'k',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4o',
  mcpServerUrl: 'http://localhost:3000/api/mcp',
}

describe('resolveModel', () => {
  it('returns an anthropic model with the configured id', () => {
    const model = resolveModel(base)
    expect(model.provider).toContain('anthropic')
    expect(model.modelId).toBe('claude-sonnet-4-6')
  })

  it('returns an openai model when provider is openai', () => {
    const model = resolveModel({ ...base, provider: 'openai', openaiApiKey: 'k' })
    expect(model.provider).toContain('openai')
    expect(model.modelId).toBe('gpt-4o')
  })
})
```

- [ ] **Step 7: Run it; verify it fails**

Run: `pnpm test:int src/eve/provider.test.ts`
Expected: FAIL — cannot find module `./provider`.

- [ ] **Step 8: Implement `src/eve/provider.ts`**

```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { EveConfig } from './config'

/** Builds the Vercel AI SDK language model for the configured provider. */
export function resolveModel(config: EveConfig): LanguageModel {
  if (config.provider === 'openai') {
    const openai = createOpenAI({ apiKey: config.openaiApiKey })
    return openai(config.openaiModel)
  }
  const anthropic = createAnthropic({ apiKey: config.anthropicApiKey })
  return anthropic(config.anthropicModel)
}
```

- [ ] **Step 9: Run provider tests; verify they pass**

Run: `pnpm test:int src/eve/provider.test.ts`
Expected: PASS (2 tests). If the SDK exposes `model.modelId`/`model.provider` under different names, adjust the assertions to the actual property names (inspect with a temporary `console.log(model)`), then keep the corrected test.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/eve/config.ts src/eve/config.test.ts src/eve/provider.ts src/eve/provider.test.ts
git commit -m "feat: add Eve config + provider resolution with tests"
```

---

## Task 5: MCP client helper + system prompt

**Files:**
- Create: `src/eve/mcp-client.ts`
- Create: `src/eve/system-prompt.ts`

**Interfaces:**
- Consumes: `EveConfig` from `src/eve/config.ts`.
- Produces:
  - `createPayloadMcpTools(config: EveConfig): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }>`
  - `EVE_SYSTEM_PROMPT: string`

- [ ] **Step 1: Create `src/eve/system-prompt.ts`**

```ts
export const EVE_SYSTEM_PROMPT = `You are Eve, an assistant embedded in a Payload CMS admin.
You help the user manage their content through the tools provided over MCP.

You can work with two collections:
- "posts": blog posts (title, content, status: draft|published, author)
- "tasks": to-do items (title, done, priority: low|medium|high, dueDate)

Guidelines:
- Use the provided tools to read and write real data. Never invent records or IDs.
- Before creating or updating, make sure you have the details you need; ask a brief
  clarifying question if something essential is missing.
- After a change, state plainly what you created or updated.
- Keep replies concise. Use Markdown for lists and emphasis when helpful.`
```

- [ ] **Step 2: Create `src/eve/mcp-client.ts`**

```ts
import { createMCPClient } from '@ai-sdk/mcp'
import type { EveConfig } from './config'

/**
 * Connects to the Payload MCP server (exposed by @payloadcms/plugin-mcp) as a
 * client and returns its tools for use with streamText. Always call `close()`
 * when the run finishes to release the connection.
 *
 * In development the MCP endpoint needs no auth; in production it requires a
 * Bearer API key from the `payload-mcp-api-keys` collection (set MCP_API_KEY).
 */
export async function createPayloadMcpTools(
  config: EveConfig,
): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }> {
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: config.mcpServerUrl,
      headers: config.mcpApiKey
        ? { Authorization: `Bearer ${config.mcpApiKey}` }
        : undefined,
    },
  })

  const tools = await client.tools()
  return { tools, close: () => client.close() }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors in `src/eve/`. (If `createMCPClient`'s transport object shape differs in the installed `@ai-sdk/mcp@1.x`, correct it per the package's exported types — the HTTP transport accepts `{ type: 'http', url, headers }`.)

- [ ] **Step 4: Commit**

```bash
git add src/eve/mcp-client.ts src/eve/system-prompt.ts
git commit -m "feat: add MCP client helper and Eve system prompt"
```

---

## Task 6: Conversation persistence helpers

**Files:**
- Create: `src/eve/conversations.ts`

**Interfaces:**
- Consumes: Payload `BasePayload` and `TypedUser` types; `Conversation` from `@/payload-types`.
- Produces:
  - `loadConversation(payload, id, user): Promise<Conversation | null>`
  - `createConversation(payload, user, title): Promise<Conversation>`
  - `saveMessages(payload, id, messages, user): Promise<void>`
  - `listConversations(payload, user): Promise<Conversation[]>`

  All enforce ownership via `overrideAccess: false` + `user`.

- [ ] **Step 1: Create `src/eve/conversations.ts`**

```ts
import type { BasePayload, TypedUser } from 'payload'
import type { Conversation } from '@/payload-types'

/** Lists the current user's conversations, newest first. */
export async function listConversations(
  payload: BasePayload,
  user: TypedUser,
): Promise<Conversation[]> {
  const { docs } = await payload.find({
    collection: 'conversations',
    user,
    overrideAccess: false,
    sort: '-updatedAt',
    limit: 50,
    depth: 0,
  })
  return docs
}

/** Loads one conversation if it belongs to the user; otherwise null. */
export async function loadConversation(
  payload: BasePayload,
  id: string,
  user: TypedUser,
): Promise<Conversation | null> {
  try {
    return await payload.findByID({
      collection: 'conversations',
      id,
      user,
      overrideAccess: false,
      depth: 0,
    })
  } catch {
    return null
  }
}

/** Creates a new conversation owned by the user. */
export async function createConversation(
  payload: BasePayload,
  user: TypedUser,
  title: string,
): Promise<Conversation> {
  return payload.create({
    collection: 'conversations',
    user,
    overrideAccess: false,
    data: { title, user: user.id, messages: [] },
  })
}

/** Replaces the stored messages array for a conversation. */
export async function saveMessages(
  payload: BasePayload,
  id: string,
  messages: unknown,
  user: TypedUser,
): Promise<void> {
  await payload.update({
    collection: 'conversations',
    id,
    user,
    overrideAccess: false,
    data: { messages },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `payload.create` rejects `messages: []` typing, cast via `data: { ... } as Conversation` or `messages: [] as unknown as Conversation['messages']`.)

- [ ] **Step 3: Commit**

```bash
git add src/eve/conversations.ts
git commit -m "feat: add conversation persistence helpers"
```

---

## Task 7: Chat endpoint `/api/eve`

**Files:**
- Create: `src/app/(payload)/api/eve/route.ts`

**Interfaces:**
- Consumes: `getEveConfig`, `resolveModel`, `createPayloadMcpTools`, `EVE_SYSTEM_PROMPT`, conversation helpers.
- Produces: `POST /api/eve` accepting `{ messages: UIMessage[]; conversationId?: string }`, returning a UI message stream; persists the conversation in `onFinish`. Returns 401 if unauthenticated.

- [ ] **Step 1: Create `src/app/(payload)/api/eve/route.ts`**

```ts
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getEveConfig } from '@/eve/config'
import { resolveModel } from '@/eve/provider'
import { createPayloadMcpTools } from '@/eve/mcp-client'
import { EVE_SYSTEM_PROMPT } from '@/eve/system-prompt'
import {
  createConversation,
  loadConversation,
  saveMessages,
} from '@/eve/conversations'

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { messages: UIMessage[]; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { messages, conversationId } = body

  // Resolve (or create) the conversation this thread persists to.
  const firstUserText =
    messages
      .find((m) => m.role === 'user')
      ?.parts.find((p) => p.type === 'text')?.text ?? 'New conversation'
  let conversation = conversationId
    ? await loadConversation(payload, conversationId, user)
    : null
  if (!conversation) {
    conversation = await createConversation(payload, user, firstUserText.slice(0, 80))
  }

  let eveConfig
  try {
    eveConfig = getEveConfig()
  } catch (err) {
    payload.logger.error({ msg: 'Eve config error', err })
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }

  const { tools, close } = await createPayloadMcpTools(eveConfig)

  const result = streamText({
    model: resolveModel(eveConfig),
    system: EVE_SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
    onFinish: () => {
      void close()
    },
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      void saveMessages(payload, String(conversation!.id), finalMessages, user)
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `toUIMessageStreamResponse`'s `onFinish` payload key differs in `ai@6.x`, inspect the type and use the property holding the full message list. If `originalMessages` is not accepted, drop it and persist from the `onFinish` messages alone.)

- [ ] **Step 3: Verify auth gate (server running)**

Start `pnpm dev`, then run (no auth cookie):

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/eve' \
  -X POST -H 'Content-Type: application/json' \
  -d '{"messages":[]}'
```

Expected: `401`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(payload)/api/eve/route.ts"
git commit -m "feat: add /api/eve chat endpoint with MCP tools and persistence"
```

---

## Task 8: Tailwind v4 + AI Elements scaffolding (scoped to the view)

**Files:**
- Create: `src/components/eve/eve.css`
- Create/Modify: Tailwind + shadcn config files (generated)
- Create: `src/components/ui/*`, `src/components/ai-elements/*` (generated)
- Modify: `components.json`, `tsconfig.json` paths if needed

**Interfaces:**
- Produces: AI Elements components importable from `@/components/ai-elements/*`, styled via a Tailwind stylesheet that does **not** alter Payload's admin styling.

- [ ] **Step 1: Install Tailwind v4 + the AI Elements peer libs**

Run: `pnpm add -D tailwindcss @tailwindcss/postcss postcss`
Run: `pnpm add lucide-react class-variance-authority clsx tailwind-merge`
Expected: installs succeed.

- [ ] **Step 2: Create the scoped Tailwind entry `src/components/eve/eve.css`**

Preflight (Tailwind's global reset) must NOT leak into Payload's admin. Import Tailwind without Preflight and scope utilities under a wrapper class:

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
/* Note: Preflight is intentionally omitted to avoid resetting Payload admin styles. */

/* shadcn design tokens, scoped to the Eve view only. */
.eve-scope {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --primary: #0a0a0a;
  --primary-foreground: #fafafa;
  --radius: 0.625rem;
}
```

- [ ] **Step 3: Initialize shadcn (creates `components.json`, base utils)**

Run: `pnpm dlx shadcn@latest init`
When prompted: base color Neutral; use `src/components/ui` for components; `@/lib/utils` for utils; CSS file `src/components/eve/eve.css`. (If the CLI rewrites `eve.css`, re-apply the no-Preflight imports from Step 2 afterward.)
Expected: `components.json` created; `src/lib/utils.ts` created with `cn()`.

- [ ] **Step 4: Add the AI Elements components used by the chat UI**

Run: `pnpm dlx ai-elements@latest add conversation message prompt-input response tool`
Expected: files appear under `src/components/ai-elements/` (`conversation.tsx`, `message.tsx`, `prompt-input.tsx`, `response.tsx`, `tool.tsx`) and any missing shadcn primitives under `src/components/ui/`.

- [ ] **Step 5: Ensure the admin loads `eve.css` only where needed**

The view component (Task 10) imports `eve.css` directly. Confirm `next.config.ts`/PostCSS picks up Tailwind: create `postcss.config.mjs` if shadcn didn't:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

- [ ] **Step 6: Verify admin styling is intact**

Start `pnpm dev`, open `http://localhost:3000/admin`. Expected: the standard Payload admin looks unchanged (no broken fonts/spacing from a global reset). Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tailwind v4 + AI Elements scoped to the Eve view"
```

---

## Task 9: EveChat client component

**Files:**
- Create: `src/components/eve/EveChat.tsx`
- Create: `src/components/eve/ConversationSidebar.tsx`

**Interfaces:**
- Consumes: AI Elements components; `useChat` from `@ai-sdk/react`; `DefaultChatTransport` from `ai`; `Conversation` from `@/payload-types`.
- Produces:
  - `EveChat` (default-ish named export) props: `{ initialMessages: UIMessage[]; conversations: ConversationSummary[]; activeId?: string }`.
  - `type ConversationSummary = { id: string; title: string }`.
  - `ConversationSidebar` props: `{ conversations: ConversationSummary[]; activeId?: string; onSelect: (id: string) => void; onNew: () => void }`.

- [ ] **Step 1: Create `src/components/eve/ConversationSidebar.tsx`**

```tsx
'use client'
import React from 'react'

export type ConversationSummary = { id: string; title: string }

export const ConversationSidebar: React.FC<{
  conversations: ConversationSummary[]
  activeId?: string
  onSelect: (id: string) => void
  onNew: () => void
}> = ({ conversations, activeId, onSelect, onNew }) => (
  <aside className="eve-scope flex w-64 shrink-0 flex-col gap-2 border-r border-[var(--border)] p-3">
    <button
      type="button"
      onClick={onNew}
      className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]"
    >
      + New chat
    </button>
    <nav className="flex flex-col gap-1 overflow-y-auto">
      {conversations.length === 0 ? (
        <p className="px-2 py-1 text-sm text-[var(--muted-foreground)]">No conversations yet.</p>
      ) : (
        conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`truncate rounded-[var(--radius)] px-3 py-2 text-left text-sm ${
              c.id === activeId ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]'
            }`}
          >
            {c.title || 'Untitled'}
          </button>
        ))
      )}
    </nav>
  </aside>
)
```

- [ ] **Step 2: Create `src/components/eve/EveChat.tsx`**

```tsx
'use client'
import React, { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import './eve.css'

export const EveChat: React.FC<{
  initialMessages: UIMessage[]
  conversations: ConversationSummary[]
  activeId?: string
}> = ({ initialMessages, conversations, activeId }) => {
  const [conversationId, setConversationId] = useState<string | undefined>(activeId)
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, setMessages } = useChat({
    id: conversationId ?? 'new',
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/eve',
      prepareSendMessagesRequest: ({ messages }) => ({
        body: { messages, conversationId },
      }),
    }),
  })

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim()) return
    sendMessage({ text: message.text })
    setInput('')
  }

  const startNewChat = () => {
    setConversationId(undefined)
    setMessages([])
  }

  return (
    <div className="eve-scope flex h-[calc(100vh-var(--app-header-height,0px))] min-h-[600px]">
      <ConversationSidebar
        conversations={conversations}
        activeId={conversationId}
        onSelect={(id) => {
          setConversationId(id)
          // Reload the page on the thread route is the simplest correct reload;
          // here we let the server view re-render by navigating.
          window.location.search = `?conversation=${id}`
        }}
        onNew={startNewChat}
      />
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="Chat with Eve"
                description="Ask Eve to create a post or manage your tasks."
              />
            ) : (
              messages.map((message) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        return (
                          <MessageResponse key={`${message.id}-${i}`}>
                            {part.text}
                          </MessageResponse>
                        )
                      }
                      // MCP tools surface as dynamic tool parts; render them so
                      // the agent's CMS calls are visible.
                      if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
                        const p = part as unknown as {
                          toolName?: string
                          type: string
                          state?: string
                          input?: unknown
                          output?: unknown
                          errorText?: string
                        }
                        return (
                          <Tool key={`${message.id}-${i}`}>
                            <ToolHeader
                              type={(p.toolName ?? p.type) as `tool-${string}`}
                              state={(p.state ?? 'output-available') as never}
                            />
                            <ToolContent>
                              <ToolInput input={p.input} />
                              <ToolOutput output={p.output} errorText={p.errorText} />
                            </ToolContent>
                          </Tool>
                        )
                      }
                      return null
                    })}
                  </MessageContent>
                </Message>
              ))
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
          <PromptInputSubmit
            status={status === 'streaming' ? 'streaming' : 'ready'}
            disabled={!input.trim()}
          />
        </PromptInput>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. The exact prop names for `Tool`/`ToolHeader`/`ToolOutput` and the tool part shape come from the generated `tool.tsx` (Task 8) — open that file and align the props/casts to what it actually exports. Likewise confirm `MessageResponse` vs `Response` naming in the generated `message.tsx`/`response.tsx` and import accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/components/eve/EveChat.tsx src/components/eve/ConversationSidebar.tsx
git commit -m "feat: add EveChat client UI with AI Elements + tool rendering"
```

---

## Task 10: EveView server view + register in admin

**Files:**
- Create: `src/components/eve/EveView.tsx`
- Modify: `src/payload.config.ts` (`admin.components.views.eve` + nav link)

**Interfaces:**
- Consumes: `AdminViewServerProps` from `payload`; `listConversations`, `loadConversation`; `EveChat`.
- Produces: an admin view at `/admin/eve`.

- [ ] **Step 1: Create `src/components/eve/EveView.tsx`**

```tsx
import React from 'react'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import type { UIMessage } from 'ai'
import { listConversations, loadConversation } from '../../eve/conversations'
import { EveChat } from './EveChat'

/**
 * Admin view for the Eve chat agent. Renders inside the Payload admin shell.
 * Loads the signed-in user's conversations and (optionally) the active thread's
 * messages, then hands them to the client chat component.
 */
export const EveView: React.FC<AdminViewServerProps> = async ({
  initPageResult,
  params,
  searchParams,
}) => {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const user = req.user

  const activeId =
    typeof searchParams?.conversation === 'string' ? searchParams.conversation : undefined

  const conversations = user ? await listConversations(req.payload, user) : []
  const active = user && activeId ? await loadConversation(req.payload, activeId, user) : null
  const initialMessages = (active?.messages as UIMessage[] | undefined) ?? []

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={user ?? undefined}
      visibleEntities={visibleEntities}
    >
      {user ? (
        <EveChat
          initialMessages={initialMessages}
          conversations={conversations.map((c) => ({ id: String(c.id), title: c.title ?? 'Untitled' }))}
          activeId={activeId}
        />
      ) : (
        <Gutter>
          <h1>Eve</h1>
          <p>Please sign in to chat with Eve.</p>
        </Gutter>
      )}
    </DefaultTemplate>
  )
}
```

- [ ] **Step 2: Register the view and a nav link in `src/payload.config.ts`**

Inside `admin`, add a `components` block (merge if one already exists):

```ts
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      views: {
        eve: {
          Component: '/components/eve/EveView#EveView',
          path: '/eve',
        },
      },
    },
  },
```

- [ ] **Step 3: Regenerate the import map**

Run: `pnpm generate:importmap`
Expected: `src/app/(payload)/admin/importMap.js` now references `EveView`.

- [ ] **Step 4: Verify the view renders**

Start `pnpm dev`, sign into `/admin`, then open `http://localhost:3000/admin/eve`.
Expected: the chat surface renders inside the admin shell with the sidebar + composer; admin styling elsewhere is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/eve/EveView.tsx src/payload.config.ts "src/app/(payload)/admin/importMap.js"
git commit -m "feat: register Eve chat admin view at /admin/eve"
```

---

## Task 11: Env example + README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Append:

```
# --- Eve chat agent ---
AI_PROVIDER=anthropic            # or: openai
ANTHROPIC_API_KEY=               # required when AI_PROVIDER=anthropic
OPENAI_API_KEY=                  # required when AI_PROVIDER=openai
ANTHROPIC_MODEL=claude-sonnet-4-6
OPENAI_MODEL=gpt-4o
MCP_SERVER_URL=http://localhost:3000/api/mcp
MCP_API_KEY=                     # optional in dev; required in production
```

- [ ] **Step 2: Add an "AI Chat Agent (Eve)" section to `README.md`**

Document, in prose: the architecture (admin view → `/api/eve` → MCP client → `/api/mcp` → Posts/Tasks), the env setup, that dev needs no MCP key while production needs one from the `payload-mcp-api-keys` collection, and how to switch providers by setting `AI_PROVIDER`. Include the architecture diagram from the design spec.

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: document the Eve chat agent setup and architecture"
```

---

## Task 12: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + typecheck + unit tests**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test:int`
Expected: all pass.

- [ ] **Step 2: Full manual demo (server running, signed in)**

With `ANTHROPIC_API_KEY` set in `.env`, start `pnpm dev`, open `/admin/eve`, and verify:
1. Send "Create a high-priority task to buy milk due Friday." → Eve calls the tasks create tool (the tool call renders), and a new doc appears in **Tasks**.
2. Send "List my tasks." → Eve calls the tasks find tool and lists the task.
3. Reload `/admin/eve` → the conversation is still there in the sidebar and reopens with its messages.
4. Set `AI_PROVIDER=openai` + `OPENAI_API_KEY`, restart, repeat step 1 → still works.
5. Open `/admin` and a couple of collection list views → admin styling is unchanged.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: verify Eve chat agent end-to-end"
```

---

## Self-Review Notes (for the implementer)

- The two places most likely to need a small correction against the installed packages are: (a) AI SDK v6 `toUIMessageStreamResponse` `onFinish` payload shape (Task 7 Step 2) and (b) the generated AI Elements `Tool`/`Message` component prop names and the tool message-part shape (Task 9 Step 3). Both tasks carry explicit "inspect the generated/installed types and align" instructions — do that rather than guessing.
- The MCP tool names (Task 3 Step 4) are generated by the plugin; the agent receives them automatically via `client.tools()`, so the UI does not hardcode them.
