# Eve 0.11.7 — Tools, Sandbox, Deploy, HITL findings

> Derived by reading the INSTALLED package (`node_modules/eve@0.11.7`) `.d.ts`/JS
> directly, NOT web docs. Eve is a days-old beta — verify against the installed
> types before relying on anything here. Companion to `eve-api-findings.md`.

---

## 1. Authoring a custom tool — `agent/tools/<slug>.ts`

The filename (minus `.ts`) is the model-visible tool name (the "slug").

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),   // zod | Standard Schema | JSON Schema
  outputSchema: /* optional */ undefined,
  async execute({ city }, ctx) {                          // ctx: ToolContext
    return { city, condition: "Sunny", temperatureF: 72 };
  },
  // optional:
  // needsApproval: always(),         // from "eve/tools/approval"
  // toModelOutput: (out) => ({ type: "json", value: out }),
  // auth: /* ToolAuthDefinition */,
});
```

`ToolContext = SessionContext & { getToken?, requireAuth? }`. `SessionContext` carries
`ctx.session` (`{ id, auth, turn, parent? }`), `ctx.getSandbox()` (async),
`ctx.getSkill(id)`.

**CRITICAL (same constraint as channels/connections):** files under `agent/` are bundled
in isolation. A tool **cannot import from `src/`** or use `getPayload`/`@payload-config`.
Read `process.env` directly or talk to the app over HTTP (e.g. `/api/...`). A bad import is
a runtime crash invisible to tsc/vitest.

### Approval helpers — `eve/tools/approval`
```ts
import { always, once, never } from "eve/tools/approval";
// always() → approval before every call; once() → first call per session; never() → default
```

---

## 2. Disabling a built-in tool — `disableTool()`

```ts
// agent/tools/bash.ts
import { disableTool } from "eve/tools";
export default disableTool();
```

- File name MUST equal the exact framework slug.
- **Errors on an unknown slug at `eve build` time** ("resolution fails instead of silently
  doing nothing") — so a typo surfaces at build, not runtime. This is our cheap A4 verifier.

### Framework tool slugs
| Slug | Default on? | Runs in |
|------|-----------|---------|
| `bash` | yes | sandbox |
| `read_file` | yes | sandbox FS |
| `write_file` | yes | sandbox FS |
| `glob` | yes | sandbox FS |
| `grep` | yes | sandbox FS |
| `web_fetch` | yes | app runtime (native fetch) |
| `web_search` | yes | provider-managed (no local executor) |
| `todo` | yes | app runtime |
| `ask_question` | yes | app runtime (client-side HITL) |
| `agent` | yes | app runtime (spawn sub-agent) |
| `load_skill` | conditional (only if agent declares skills) | app runtime |
| `connection_search` | conditional (only if agent has connections) | app runtime |
| `workflow` | opt-in only | — |

Opt-in workflow tool: `export { ExperimentalWorkflow as default } from "eve/tools"` in
`agent/tools/workflow.ts`.

**A4 decision:** disable `bash`, `read_file`, `write_file`, `glob`, `grep`. Keep the rest.

---

## 3. Built-in `web_search` / `web_fetch` (basis for A2 — NO SearXNG)

**`web_fetch`** — `dist/src/execution/web-fetch/tool.js`: native `fetch()`, no key, no service.
Converts HTML→markdown/text internally (turndown). Input `{ url, format?, timeout? }`,
output `{ content, contentType, url, truncated }`. 5 MB resp limit, 50 KB/2000-line output cap.
**Means we can DROP `jsdom` + `@mozilla/readability` and their `serverExternalPackages` entries.**

**`web_search`** — `dist/src/runtime/framework-tools/web-search.js`: **no local `execute`**; it's
provider-managed, injected per-step by the AI SDK based on the model provider:
- Anthropic → native `webSearch_20250305`
- OpenAI → native web search
- Google → `googleSearch` grounding
- **Vercel AI Gateway → gateway `perplexitySearch`**

No SearXNG, no extra env vars beyond the model's own auth (we already have AI Gateway via
`VERCEL_OIDC_TOKEN`/`AI_GATEWAY_API_KEY`). **Risk to verify:** gpt-oss-120b-via-groq through
the gateway may or may not actually serve `perplexitySearch`. `web_fetch` ALWAYS works as a
fallback. To override, author `agent/tools/web_search.ts` with `defineTool()`.

---

## 4. Sandbox config (NOT needed for A4; reference only)

`agent/sandbox.ts` or `agent/sandbox/sandbox.ts`:
```ts
import { defineSandbox, defaultBackend } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";     // also: docker, microsandbox, just-bash
```
`defaultBackend()` picks: Vercel (when `process.env.VERCEL`) → Docker → microsandbox → just-bash.
All of bash/read_file/write_file/glob/grep run inside the sandbox at `/workspace`. We're
disabling those tools, so no sandbox file is needed. Future code-exec → add `vercel()` backend.

---

## 5. Deploying Eve + Next.js to Vercel

`next.config.ts`: `export default withEve(nextConfig, opts?)` (import from `eve/next`).
- **Local dev:** boots `eve dev --no-ui --port 0`, rewrites `/eve/v1/**` to it.
- **Vercel prod:** Eve deploys as a private service under `/_eve_internal/eve`; Next rewrites
  to it (same-origin, no CORS). `eve build` (bin `eve`) writes Vercel Build Output under
  `.vercel/output` when `VERCEL` is set.
- **Non-Vercel prod:** run `eve build` then `next build && next start`; Eve serves on port 4274
  (override `EVE_NEXT_PRODUCTION_PORT`) or a separate origin via `EVE_NEXT_PRODUCTION_ORIGIN`.
- **Required env on Vercel:** `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` (gateway models);
  `PAYLOAD_SECRET`; `DATABASE_URL` (MongoDB Atlas `mongodb+srv://...`); `MCP_API_KEY`;
  `DEEPGRAM_API_KEY` (voice). `VERCEL`/`VERCEL_DEPLOYMENT_ID` are set by Vercel's build env.

---

## 6. HITL / approvals (basis for A1 post-preview)

Native flow via `needsApproval: always()` on a custom tool, OR the `ask_question` tool.
On approval the runtime pauses (`session.waiting`), emits an `input.requested` event, and the
pending request rides on a dynamic-tool part:

```ts
// part.type === "dynamic-tool" && part.state === "approval-requested"
// part.toolMetadata?.eve?.inputRequest : EveMessageInputRequest
interface EveMessageInputRequest {
  requestId: string;
  prompt: string;
  display?: "confirmation" | "select" | "text";
  options?: { id: string; label: string; description?: string; style?: "danger"|"default"|"primary" }[];
  allowFreeform?: boolean;
}
```

Answer it:
```ts
await agent.send({ inputResponses: [{ requestId, optionId: "approve" /* or text */ }] });
// InputResponse = { requestId: string; optionId?: string; text?: string }
```

With `needsApproval: always()` Eve auto-generates a `display: "confirmation"` request with
`approve`/`deny` options; the tool's `execute()` runs only after `approve`. The current
`renderToolPart` in EveChat returns null for `approval-requested` — A1 must add that branch.

---

## Import path cheat-sheet
```ts
import { defineTool, disableTool, ExperimentalWorkflow } from "eve/tools";
import { always, once, never } from "eve/tools/approval";
import { defineSandbox, defaultBackend } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel"; // docker | microsandbox | just-bash
import { withEve } from "eve/next";
import { useEveAgent } from "eve/react";
import type { EveMessageInputRequest, EveMessage, EveDynamicToolPart } from "eve/react";
```
