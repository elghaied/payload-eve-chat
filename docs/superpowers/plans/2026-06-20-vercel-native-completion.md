# Vercel-native Eve completion — implementation plan

> **For agentic workers:** executed via superpowers:subagent-driven-development (fresh
> implementer per task + review). Steps tracked with `- [ ]`.

**Goal:** Finish the Eve migration as a **fully Vercel-native** app: disable code-exec tools,
remove all non-Vercel-native services (SearXNG, local STT/TTS, Docker), web via Eve built-ins,
voice via Deepgram, post-preview via Eve HITL, deploy-ready + documented.

**Architecture:** Eve filesystem-first agent mounted in Next.js via `withEve`; model via Vercel
AI Gateway (`openai/gpt-oss-120b` pinned to groq); Payload CMS admin + MCP (Posts/Tasks);
MongoDB Atlas in prod. Voice = Deepgram cloud (browser WS + short-lived token from a
Payload-auth-gated Next route). Web = Eve `web_search` (gateway perplexity) + `web_fetch`.

**Tech stack:** Eve 0.11.7, ai@7.0.0-beta.178, Next 16, React 19, Payload canary,
@deepgram/sdk, zod@4, Vitest, Playwright.

## Global constraints (every task)
- Files under `agent/` are bundled in isolation: **NO imports from `src/`**, no `getPayload`,
  no `@payload-config`. Read `process.env` or call the app over HTTP. (Crashes are invisible to
  tsc/vitest — verify with `eve info`.)
- **No `*.test.ts` under `agent/`** — Eve discovery treats every file there as a component.
- **Protect credits:** verify with `pnpm test:int` (Vitest), `tsc --noEmit`, and
  `node_modules/.bin/eve info` (compiles graph, 0 LLM calls). Assert agent-graph changes against
  `.eve/compile/compiled-agent-manifest.json` (`disabledFrameworkTools`, `tools`, `dynamicTools`).
  **DO NOT run the live-agent e2e** (`tests/e2e/eve-chat.e2e.spec.ts`) — it bills the gateway.
  The non-LLM `admin.e2e.spec.ts` is fine. The single live e2e runs once, by the controller, in
  the final task.
- Eve API facts: `docs/superpowers/notes/eve-api-findings.md` + `eve-tools-findings.md`.
  Port references: `port-references.md`. Deepgram: `deepgram-findings.md`.
- Keep `key={activeId ?? 'new'}` on EveChat. Commit per task with a clear message.

---

## Task A4 — Disable code-exec tools  (task #23)
**Files (create):** `agent/tools/bash.ts`, `read_file.ts`, `write_file.ts`, `glob.ts`, `grep.ts`
Each: `import { disableTool } from "eve/tools"; export default disableTool();`
**Keep:** web_fetch, web_search, todo, ask_question, agent, connection_search.
**Verify:** `eve info` exit 0, 0 diagnostics; manifest `disabledFrameworkTools` ===
`["bash","glob","grep","read_file","write_file"]` (any order). No test file needed (no logic);
a tiny vitest asserting the manifest contents is acceptable but optional.

## Task INFRA — Vercel-native infra  (task #24)
**Delete:** `docker-compose.yml`, `searxng/` dir (if present), `models/` STT instructions if any.
**Edit `package.json`:** `description` → Eve + Vercel-native wording (drop "Vercel AI SDK / Docker
stack"). Leave scripts (copy-vad-assets stays until A3 removes voice-old).
**Edit `.env.example`:** authoritative env for Vercel-native — see Task DOCS for final copy; at
minimum: `DATABASE_URL` (note Atlas `mongodb+srv://` for prod), `PAYLOAD_SECRET`, `EVE_MODEL`,
`EVE_PROVIDER`, AI Gateway auth (`VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`), `MCP_API_KEY`,
`MCP_SERVER_URL`, `DEEPGRAM_API_KEY`. Remove `COMPOSE_PROFILES`, `OLLAMA_*`, `STT_*`, `TTS_*`,
`SEARXNG_*`, `AI_PROVIDER`.
**Verify:** `tsc --noEmit`, `pnpm test:int`, app still boots (`eve info` ok). Grep shows no
remaining references to deleted compose services in committed code (docs handled in Task DOCS).

## Task A2 — Web via Eve built-ins  (task #25)
**Delete:** `src/eve/web-tools.ts`, `web-search.ts`, `read-url.ts`, `url-safety.ts` and their
tests (`*.test.ts`). **Edit `next.config.ts`:** remove `serverExternalPackages: ['jsdom',
'@mozilla/readability']` line (and the comment). **Edit `package.json`:** remove `jsdom`,
`@mozilla/readability`, `@types/jsdom` deps. **Edit `agent/instructions.md`:** add a short
section telling Eve it can `web_search` for current info and `web_fetch` to read a URL, and when
to use them (cite sources, prefer fetch for a specific URL). **Verify:** `pnpm install` clean,
`tsc --noEmit`, `pnpm test:int` (deleted tests gone), `eve info` shows web_fetch/web_search NOT
in `disabledFrameworkTools`. Note in report: live web_search depends on gateway perplexity
support for gpt-oss/groq — controller verifies in final e2e; web_fetch always works.

## Task A1 — Post preview via Eve HITL  (task #26)
**Create `agent/tools/proposePost.ts`** with `defineTool` + `needsApproval: always()` from
`eve/tools/approval`. Input zod `{ title: string, status: 'draft'|'published' (default draft),
markdown: string }`. `execute` runs only after approval → create the post. Since agent/ can't
import src/, `execute` creates via Payload MCP/REST over HTTP: POST to `${process.env
.PAYLOAD_INTERNAL_URL ?? 'http://localhost:3000'}/api/mcp` createDocumentFromMarkdown, OR call
the Posts REST endpoint with the MCP/admin token. Decide and document; mirror the auth pattern in
`agent/channels/eve.ts`/`agent/connections/payload-mcp.ts`. Return the created doc id/title.
**Edit `agent/instructions.md`:** when the user asks to create/draft a post, call `proposePost`
(NOT createDocumentFromMarkdown directly) so the human can review.
**Edit `src/components/eve/EveChat.tsx`:** in `renderToolPart`, add an `approval-requested` branch
for tool `proposePost` → render `<PostPreviewPanel>` (3rd sibling) seeded from `part.input`;
`onApprove(final)` → `agent.send({ inputResponses: [{ requestId, optionId: 'approve' }] })`
(carry edited fields — if Eve approval can't carry edits, send edited content as a follow-up
message per `port-references.md` option 2; pick the working path and document it); `onClose` →
`optionId: 'deny'`. Wire `requestId` from `part.toolMetadata.eve.inputRequest`.
**Delete:** `src/eve/propose-tool.ts` (AI-SDK orphan).
**Tests:** unit test for proposePost input schema + the panel-open detection logic
(`src/components/eve/*.test.tsx` or `src/eve/*.test.ts`). **Verify:** `eve info` shows
proposePost in `tools`/`dynamicTools`; tsc; vitest. No live e2e.

## Task A3 — Voice via Deepgram  (task #27)
**Create `src/app/api/deepgram/token/route.ts`:** Payload-auth-gated (mirror session-index
route). Mints a short-lived token via Deepgram `/v1/auth/grant` (ttl ~30s) using
`DEEPGRAM_API_KEY`; returns `{ access_token, expires_in }`. Never expose the raw key.
**Rewrite `src/components/eve/useVoice.ts`** for Deepgram: open STT WS
(`wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&endpointing=300&
utterance_end_ms=1000&vad_events=true&smart_format=true`) with the token via
`Sec-WebSocket-Protocol: ['bearer', token]`; feed mic via MediaRecorder (250ms) or AudioWorklet
PCM (pick the reliable one, document); on `speech_final`/`UtteranceEnd` submit the accumulated
final transcript via `onTranscript`. TTS: Aura-2 WS (`wss://api.deepgram.com/v1/speak?
model=aura-2-thalia-en&encoding=linear16&sample_rate=...`); push sentences from
`sentenceStreamer` + `extractSpeak`, play linear16 via AudioContext. Barge-in: on STT
`SpeechStarted` stop playback + `{type:'Clear'}` to TTS WS + `agent.stop()`. Keep
`EqualizerBars`, `sentenceStreamer`, `speakable`. Use `echoCancellation: true`.
**Edit `EveChat.tsx`:** add mic button in `<PromptInputFooter>` via `<PromptInputTools>`; call
`useVoice`; feed transcript with `agent.send({ message, clientContext: VOICE_REPLY_INSTRUCTION })`
where VOICE_REPLY_INSTRUCTION asks Eve to wrap spoken text in `<speak>…</speak>`.
**Delete:** `src/app/api/eve/transcribe/route.ts`, `speak/route.ts`, `src/eve/audio.ts`,
`src/components/eve/wav.ts`, `scripts/copy-vad-assets.mjs`, `public/vad/` if present. Remove
`@ricky0123/vad-web` dep and the `copy-vad-assets`/`vad:assets`/`postinstall` script refs +
`build`/`dev`/`devsafe` prefixes that call it. **Add** `@deepgram/sdk` dep;
`serverExternalPackages: ['@deepgram/sdk']` in next.config.ts. Retire `src/eve/config.ts` if no
importers remain after route deletion.
**Tests:** unit tests for the token route (auth gate, shape) with Deepgram fetch mocked, and for
any pure helpers. Do NOT run live audio. **Verify:** tsc, vitest, `eve info` ok, dev build
compiles. Note: end-to-end voice is manually verifiable only (mic); document the manual steps.

## Task DOCS — README + env + testing guide  (task #28)
Rewrite `README.md` for Eve + Vercel-native: architecture, features (chat, Posts/Tasks MCP, web
search, post-preview, Deepgram voice, code-exec disabled), Quick Start (`pnpm devsafe`, local
mongo OR Atlas), env table, **Vercel deploy guide** (link project, Atlas `DATABASE_URL`, set env,
`eve build`/`vercel deploy`), **"How to test this project"** section, and a note that **Deepgram
gives new users $200 free credit** (sign up at deepgram.com, create a key, set `DEEPGRAM_API_KEY`).
Finalize `.env.example`. Fix `eve-api-findings.md` §12 (replace stale "Groq direct" with the AI
Gateway config actually in `agent/agent.ts`). Update `docs/eve-backlog.md` (mark A1–A4 done,
supersede B8). Update memory file. **Verify:** markdown sane; no references to deleted services.

## Task FINAL — Review + single live e2e + commit  (task #29)
Controller: dispatch final whole-branch review (base 30634f1). Run `pnpm test:int`, `tsc`,
`eve info`. Run the **single** live e2e `eve-chat.e2e.spec.ts` ONCE (boot `pnpm devsafe`, ensure
`/eve/v1/health`), confirm task-creation + (if cheap) one web_search/proposePost smoke. Commit
all on `main`. Report. Do NOT trigger a paid `vercel deploy` while the user is AFK — leave it
turnkey + documented.
