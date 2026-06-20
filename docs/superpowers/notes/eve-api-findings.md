# Eve API Findings

> Derived from `node_modules/eve` v0.11.7 TypeScript types (`.d.ts` files) and
> live curl against the running dev server. Do NOT update these findings from web
> docs — read the installed types directly.

---

## 1. Installed version

```
eve@0.11.7
```

Pinned exactly in `package.json` (no `^`/`latest`).

### Peer-dependency note (important for later tasks)

Eve's required peer is `ai@7.0.0-beta.178` (exact, not a range). The project was
on `ai@6.0.208`. Upgrading to `ai@7.0.0-beta.178` was required for the Eve dev
worker to start. Eve's compiled modules import `convertDataContentToBase64String`
directly from `"ai"`, and that symbol was absent in `ai@6`.

`ai@7.0.0-beta.178` still exports all the symbols the existing AI-SDK chat stack
uses (`UIMessage`, `DefaultChatTransport`, `convertToModelMessages`, `stepCountIs`,
`ChatStatus`, `streamText`, `generateText`, `tool`, etc.), so the upgrade is
backward-compatible for the existing code. The `@ai-sdk/*@3.x` packages are no
longer a transitive dependency of `ai@7` itself, but they remain in
`node_modules` and should continue to resolve correctly for the existing routes.

---

## 2. Next.js mount mechanism

**Mechanism:** `withEve` wrapper in `next.config.ts` (from `eve/next`).

`eve init` did NOT auto-modify `next.config.ts`; the wrapper was added manually
per the brief.

### Import path

```ts
import { withEve } from 'eve/next'
```

### How it composes with `withPayload`

```ts
export default withEve(withPayload(nextConfig, { devBundleServerPackages: false }))
```

`withEve` is the outermost wrapper. It returns an `EveNextConfigFunction` that
adds Next.js rewrites so that `/eve/v1/*` routes proxy to the Eve dev server
(started automatically by `withEve` as a child process). In production it
rewrites to the private Vercel service at `/_eve_internal/eve`.

### What `withEve` does internally

- In dev: starts `eve dev --no-ui --port 0`, captures the ephemeral port, adds
  rewrites for `/eve/v1/**` → `http://127.0.0.1:<port>/**`.
- In Vercel prod: rewrites `/eve/v1/**` → `/_eve_internal/eve/**` (private
  service-to-service).
- Outside Vercel prod: uses `EVE_NEXT_PRODUCTION_ORIGIN` env var to locate the
  Eve service.

### WithEveOptions (all optional)

```ts
interface WithEveOptions {
  devServerTimeoutMs?: number  // default 180000ms
  eveRoot?: string             // default: Next.js app root
  eveBuildCommand?: string     // default: "eve build"
  servicePrefix?: string       // default: "/_eve_internal/eve"
}
```

---

## 3. Eve HTTP API routes

All routes are served at the prefix `/eve/v1` (rewritten from Next.js).

| Route | Method | Purpose |
|-------|--------|---------|
| `/eve/v1/health` | GET | Health check → `{ ok: true, status: "ready", workflowId }` |
| `/eve/v1/info` | GET | Agent introspection JSON (auth-gated: localDev or vercelOidc) |
| `/eve/v1/session` | POST | **Create session** — body: `{ message, clientContext?, outputSchema? }` → `{ ok: true, sessionId, continuationToken }` + header `x-eve-session-id` |
| `/eve/v1/session/:sessionId` | POST | **Continue session** — body: `{ continuationToken, message?, inputResponses?, clientContext?, outputSchema? }` |
| `/eve/v1/session/:sessionId/stream` | GET | **Stream events** — returns NDJSON stream of `HandleMessageStreamEvent` objects |
| `/eve/v1/connections/:name/callback/:token` | POST/GET | OAuth callback (unauthenticated by design) |
| `/eve/v1/callback/:token` | any | Terminal session callback |
| `/eve/v1/dev/schedules/:scheduleId` | POST | **Dev-only** — dispatch a schedule once |
| `/eve/v1/dev/runtime-artifacts` | GET | **Dev-only** — current runtime artifact revision |
| `/eve/v1/dev/runtime-artifacts/rebuild` | GET | **Dev-only** — flush queued rebuilds |

**There is NO session-list endpoint** in the Eve protocol. Eve does not provide
a `GET /eve/v1/sessions` or equivalent. Each session is identified by its
`sessionId`/`continuationToken` pair; if you want to list a user's past
sessions, that index must live in your own database (Payload). Task 7's
persistence approach must store session IDs in Payload's `Conversations`
collection and look them up there — Eve's HTTP API cannot enumerate sessions.

**Replay**: Eve CAN replay events for an existing session:
- `GET /eve/v1/session/:sessionId/stream?startIndex=N` streams from event index
  N. Passing `startIndex=0` replays all events from the beginning.
- The `ClientSession.stream({ startIndex })` client-side method wraps this.
- `useEveAgent` accepts `initialEvents` + `initialSession` options to rehydrate
  a prior conversation's state on mount without re-fetching. This is the
  recommended pattern for resuming sessions (pass stored events + session cursor
  from Payload).

---

## 4. `defineAgent` — `eve` (main export)

```ts
import { defineAgent } from 'eve'

// Signature (condensed):
function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent

// AgentDefinition:
type AgentDefinition = {
  readonly description?: string
  readonly build?: AgentBuildDefinition
  readonly compaction?: PublicAgentCompactionDefinition
  readonly experimental?: AgentExperimentalDefinition  // { codeMode?: boolean }
  readonly model: LanguageModel | string               // AI SDK LanguageModel or AI Gateway model id string
  readonly modelContextWindowTokens?: number
  readonly modelOptions?: { providerOptions?: Record<string, JsonObject> }
  readonly outputSchema?: StandardJSONSchemaV1 | JsonObject
}
```

Model can be an AI Gateway model id string (e.g. `"anthropic/claude-sonnet-4.6"`)
or a direct AI SDK provider instance (bypasses gateway). `env.EVE_MODEL` overrides
the authored default at runtime in the scaffold.

---

## 5. `defineMcpClientConnection` — `eve/connections`

```ts
import { defineMcpClientConnection } from 'eve/connections'

// McpClientConnectionDefinition:
interface McpClientConnectionDefinition {
  readonly url: string           // MCP server HTTP endpoint (Streamable HTTP or SSE)
  readonly description: string   // summary used in system prompt
  auth?: ConnectionAuthDefinition
  approval?: (ctx: NeedsApprovalContext) => boolean
  headers?: HeadersDefinition
  tools?: ToolFilterDefinition   // { allow: string[] } | { block: string[] }
}

// ConnectionAuthDefinition: either getToken-only or interactive OAuth
// (getToken alone = static key / pre-provisioned JWT)
// (startAuthorization + completeAuthorization = interactive OAuth — both or neither)

function defineMcpClientConnection(
  definition: McpClientConnectionDefinition
): McpClientConnectionDefinition
```

Connection files live at `agent/connections/<name>.ts`. The runtime derives the
connection name from the filename slug (e.g. `agent/connections/payload.ts` →
`"payload"`). The connection's `url` is resolved at runtime (can read
`process.env`).

---

## 6. `eveChannel` — `eve/channels/eve`

```ts
import { eveChannel } from 'eve/channels/eve'

interface EveChannelInput {
  auth: AuthFn<Request> | readonly AuthFn<Request>[]
  uploadPolicy?: UploadPolicyInput | "disabled"
  onMessage?: (ctx: EveMessageContext, message: string | UserContent) => EveMessageResult | Promise<EveMessageResult>
  events?: EveChannelEvents
}

// EveMessageResult: { auth: SessionAuthContext | null; context?: readonly string[] } | null
// onMessage is a pre-dispatch hook; return null to accept without dispatching

function eveChannel(input: EveChannelInput): EveChannel
```

Channel file: `agent/channels/eve.ts`. Default-exported.

---

## 7. Auth helpers — `eve/channels/auth`

```ts
import { localDev, vercelOidc, placeholderAuth, none, httpBasic, jwtHmac, jwtEcdsa, oidc,
         routeAuth, extractBearerToken,
         verifyHttpBasic, verifyJwtHmac, verifyJwtEcdsa, verifyVercelOidc, verifyOidc,
         createIpAllowList, isIpAllowed, createUnauthorizedResponse,
         UnauthenticatedError, ForbiddenError, vercelSubject } from 'eve/channels/auth'

type AuthFn<TEvent = Request> = (
  event: TEvent
) => SessionAuthContext | null | undefined | Promise<SessionAuthContext | null | undefined>

// Strategy helpers (return AuthFn):
localDev()          // accepts requests from localhost/127.x/::1; returns null otherwise
vercelOidc(opts?)   // Vercel OIDC token (always accepts current project + optional extra subjects)
placeholderAuth()   // returns 401 in production, null in dev — replace before going live
none()              // accepts all requests anonymously (principalType: "anonymous")
httpBasic(creds)    // verifies HTTP Basic credentials
jwtHmac(config)     // verifies HMAC-signed bearer JWT
jwtEcdsa(config)    // verifies ECDSA-signed bearer JWT
oidc(config)        // generic OIDC bearer token verifier
```

**Walk semantics**: `routeAuth` walks the array left-to-right. First entry
returning a `SessionAuthContext` wins. `null`/`undefined` skips to next. Empty
array or all-null → 401. Include `none()` last for anonymous access.

**For Task 4 (Payload admin auth)**: implement a custom `AuthFn<Request>` that
reads the Payload auth cookie/token from the request and validates it against
the Payload API. Return a `SessionAuthContext` on success, `null` to skip.
The `SessionAuthContext` shape (from `#channel/types.js`) is an internal type;
construct it via `verifyHttpBasic` / `verifyJwtHmac` return values, or by
returning `{ principalType, subject, issuer, attributes? }` if that shape is
accepted. (To be confirmed: the exact `SessionAuthContext` constructor — check
`node_modules/eve/dist/src/channel/types.d.ts`.)

---

## 8. `useEveAgent` — `eve/react` (React hook)

### Import

```ts
import { useEveAgent } from 'eve/react'
// also exports: defaultMessageReducer, EveMessageData, EveMessage, EveMessagePart,
// EveDynamicToolPart, EveMessageInputRequest, EveMessageMetadata, EveMessageToolMetadata,
// EveAgentReducer, PrepareSend, UseEveAgentHelpers, UseEveAgentOptions,
// UseEveAgentSnapshot, UseEveAgentStatus
```

### Overloads

```ts
// Default reducer → EveMessageData
function useEveAgent(options?: UseEveAgentOptions<EveMessageData>): UseEveAgentHelpers<EveMessageData>

// Custom reducer
function useEveAgent<TData>(
  options: UseEveAgentOptions<TData> & { readonly reducer: EveAgentReducer<TData> }
): UseEveAgentHelpers<TData>
```

### `UseEveAgentHelpers<TData>` return shape

```ts
interface UseEveAgentHelpers<TData> extends UseEveAgentSnapshot<TData> {
  // From UseEveAgentSnapshot:
  data: TData                                 // reducer projection (EveMessageData by default)
  error: Error | undefined                    // last transport-level error
  events: readonly HandleMessageStreamEvent[] // raw server events (authoritative)
  session: SessionState                       // { sessionId?, continuationToken?, streamIndex }
  status: UseEveAgentStatus                   // "ready" | "submitted" | "streaming" | "error"

  // Commands:
  reset: () => void           // abort in-flight, create new session, clear events + data
  send: <TOutput = unknown>(input: SendTurnPayload<TOutput>) => Promise<void>
  stop: () => void            // abort the in-flight turn's stream
}
```

### `UseEveAgentStatus` values

```ts
type UseEveAgentStatus = "error" | "ready" | "streaming" | "submitted"
// ready     → idle, accepting a new turn
// submitted → request sent, awaiting first stream event
// streaming → events arriving
// error     → last turn ended in terminal failure (read snapshot.error)
```

### `send` — `SendTurnPayload<TOutput>` shape

```ts
interface SendTurnPayload<TOutput = unknown> {
  message?: string | UserContent    // plain text or multipart content
  inputResponses?: readonly InputResponse[]  // HITL responses
  clientContext?: string | readonly string[] | JsonObject  // one-turn context (not persisted)
  outputSchema?: StandardJSONSchemaV1<unknown, TOutput> | JsonObject
  signal?: AbortSignal
  headers?: Readonly<Record<string, string>>
}
```

**Shorthand**: `send({ message: "hello" })` — not `send("hello")`; the hook
takes `SendTurnPayload`, not a raw string.

### `UseEveAgentOptions<TData>` (all optional except `reducer` in custom overload)

```ts
interface UseEveAgentOptions<TData> {
  auth?: ClientAuth               // { bearer: TokenValue } | { basic: { username, password } }
  headers?: HeadersValue
  host?: string                   // base URL; default "" → same-origin /eve/v1/*
  initialEvents?: readonly HandleMessageStreamEvent[]   // seed for resume
  initialSession?: SessionState   // seed for resume: { sessionId, continuationToken, streamIndex }
  maxReconnectAttempts?: number   // default 3
  optimistic?: boolean            // default true — project user msg before server confirms
  reducer?: EveAgentReducer<TData>
  session?: ClientSession         // externally owned session (for advanced use)
  // Lifecycle callbacks:
  onError?: (error: Error) => void
  onEvent?: (event: HandleMessageStreamEvent) => void
  onFinish?: (snapshot: UseEveAgentSnapshot<TData>) => void
  onSessionChange?: (session: SessionState) => void
  prepareSend?: PrepareSend       // (input: SendTurnPayload) => SendTurnPayload | Promise<SendTurnPayload>
}
```

### No session-id field on the hook return

There is no separate `sessionId` property. The session id is in
`session.sessionId` (`SessionState.sessionId?: string`).

---

## 9. `EveMessageData` — default reducer projection

```ts
interface EveMessageData {
  readonly messages: readonly EveMessage[]
}

interface EveMessage {
  readonly id: string
  readonly metadata?: EveMessageMetadata
  readonly parts: readonly EveMessagePart[]
  readonly role: "assistant" | "user"
}

interface EveMessageMetadata {
  readonly optimistic?: true
  readonly result?: unknown
  readonly status?: "complete" | "failed" | "streaming" | "submitted"
  readonly turnId?: string
}

type EveMessagePart =
  | { type: "text"; text: string; state?: "done" | "streaming"; stepIndex?: number; providerMetadata?: Record<string, unknown> }
  | { type: "reasoning"; text: string; state?: "done" | "streaming"; stepIndex?: number; providerMetadata?: Record<string, unknown> }
  | { type: "step-start" }
  | EveDynamicToolPart
```

---

## 10. Session persistence and resume

### Persisting a session

`session.session` (i.e. `UseEveAgentHelpers.session`) is a `SessionState`:

```ts
interface SessionState {
  readonly continuationToken?: string  // opaque token for the next POST
  readonly sessionId?: string          // stable session id (also in x-eve-session-id header)
  readonly streamIndex: number         // how many events have been consumed
}
```

Serialize `session` (e.g. store `sessionId`, `continuationToken`, `streamIndex`
in Payload's `Conversations` collection) and optionally serialize `events`.

### Resuming on mount

Pass previously stored state back via `useEveAgent` options:

```ts
useEveAgent({
  initialSession: { sessionId, continuationToken, streamIndex },
  initialEvents: storedEvents,   // optional: avoids re-fetching history
})
```

`initialEvents` seeds the reducer projection locally. Without it the hook starts
with empty `data.messages` but can still send to the existing session.

To replay events from the server: `GET /eve/v1/session/:sessionId/stream?startIndex=0`
returns all events as NDJSON. The `ClientSession.stream({ startIndex: 0 })` method
wraps this. This can be used to rebuild `initialEvents` server-side.

### Session listing

**Eve provides no session-listing endpoint.** There is no `GET /eve/v1/sessions`
or similar. The full set of stable framework routes is:

- `POST /eve/v1/session` — create
- `POST /eve/v1/session/:sessionId` — continue
- `GET  /eve/v1/session/:sessionId/stream` — replay/stream events
- `GET  /eve/v1/health`, `GET /eve/v1/info`
- Dev-only: `/eve/v1/dev/*`

**Consequence for Task 7 (EveView — session index)**: the session list MUST be
owned by the app. Store session metadata (sessionId, continuationToken,
streamIndex, title/preview) in Payload's `Conversations` collection on each
`onSessionChange` / `onFinish` callback. EveView reads from Payload, not from
Eve. This is a confirmed architectural requirement.

---

## 11. Live curl result (Task 1 verification)

```
POST http://localhost:3000/eve/v1/session
Request:  { "message": "say hello" }
Response: HTTP 202 Accepted
Headers:  x-eve-session-id: wrun_01KVJHGPGG344CY7AJMMRF40F6
Body:     { "continuationToken": "eve:9cb4a926-ce78-4687-a257-60a3707f6a00", "ok": true, "sessionId": "wrun_01KVJHGPGG344CY7AJMMRF40F6" }
```

The 202 (not 200) is expected: Eve accepts the message asynchronously (the
workflow starts; the model response arrives via the event stream). The session id
appears in both the response header (`x-eve-session-id`) and the body
(`sessionId`). The `continuationToken` (prefixed `"eve:"`) is the opaque cursor
for the next `POST /eve/v1/session/:sessionId` call.

Auth note: the response was 202 (not 401) because `localDev()` in the default
channel accepts localhost requests. `placeholderAuth()` in the channel array
would return 401 in production until replaced by a real auth provider (Task 4).

---

## 12. Model: Groq direct provider (AMENDED — supersedes AI Gateway)

The project uses a **direct Groq provider**, NOT an AI Gateway model string
(AI Gateway requires a Vercel credit card the user does not have). `agent/agent.ts`:

```ts
import { createGroq } from '@ai-sdk/groq'
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY })
export default defineAgent({ model: groq(process.env.EVE_MODEL || 'llama-3.3-70b-versatile') })
```

- Package: `@ai-sdk/groq@4.0.0-beta.54` — its `@ai-sdk/provider` is `4.0.0-beta.19`, the
  EXACT version `ai@7.0.0-beta.178` uses, so the model instance is interface-compatible.
- `GROQ_API_KEY` lives in `.env.local` (gitignored). `EVE_MODEL` overrides the Groq **model
  name** only (default `llama-3.3-70b-versatile`, a tool-calling-capable model) — it can no
  longer carry a fully-qualified gateway string like `anthropic/...`.
- Verified end-to-end: a session streamed a real reply (`PONG`, finishReason `stop`,
  modelId `meta/llama-3.3-70b`).

---

## 13. Files changed in Task 1

| File | Change |
|------|--------|
| `agent/agent.ts` | Created by `eve init`, updated to use `EVE_MODEL` env var |
| `agent/instructions.md` | Created by `eve init`, updated to project-specific instructions |
| `agent/channels/eve.ts` | Created by `eve init` (unchanged — has `localDev`, `vercelOidc`, `placeholderAuth`) |
| `next.config.ts` | Added `import { withEve } from 'eve/next'`; wrapped export with `withEve(...)` |
| `package.json` | Added `eve@0.11.7` (pinned exact), `@vercel/connect@0.2.2`; upgraded `ai` to `7.0.0-beta.178` |
| `.env` | Added `EVE_MODEL=anthropic/claude-sonnet-4.6` |
