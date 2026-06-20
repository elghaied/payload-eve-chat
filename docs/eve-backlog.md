# Eve — Post-Migration Backlog

Follow-up work after the Vercel Eve framework migration (see
`docs/superpowers/specs/2026-06-20-eve-vercel-eve-migration-design.md`,
`docs/superpowers/plans/2026-06-20-eve-vercel-eve-migration.md`, and Eve API gotchas in
`docs/superpowers/notes/eve-api-findings.md`).

The migration shipped **core chat + Posts/Tasks over MCP** on Eve, model via Vercel AI
Gateway (`openai/gpt-oss-120b` pinned to groq). Everything below was deliberately deferred.

**Process:** each **Feature** item is large enough to warrant its own
brainstorm → spec → plan → implement cycle. **Hardening/cleanup** items are small and can
be batched. The old Vercel-AI-SDK implementations of the deferred features still live on the
**`ai-sdk` branch** — port from there rather than rewriting from scratch.

---

## A. Deferred features to re-home onto Eve

Each is its own project (spec + plan). Listed roughly by value/effort.

- [ ] **A1 — Post preview (approve-before-create).** Re-home the `proposePost` flow: Eve
  proposes a post (title/status/Markdown), the admin edits + approves in a side panel, and
  only then is it created. Reference impl: `src/eve/propose-tool.ts`,
  `src/components/eve/PostPreviewPanel.tsx`, `src/eve/approval-message.ts` (on `ai-sdk`).
  On Eve: an `agent/tools/propose_post.ts` (or a human-in-the-loop input request) + wire the
  panel to `useEveAgent` tool parts. Update `agent/instructions.md` (currently creates posts
  directly). **Medium.**
- [ ] **A2 — Web search + read-URL.** Re-home `webSearch` / `readUrl` as Eve tools
  (`agent/tools/*.ts`). Reference: `src/eve/web-search.ts`, `read-url.ts`, `web-tools.ts`,
  `url-safety.ts` (SSRF guard) on `ai-sdk`. Needs a reachable SearXNG (self-hosted) or a
  hosted search API; `jsdom`/`@mozilla/readability` are already `serverExternalPackages`.
  Restore the search-related instructions in `agent/instructions.md`. **Medium.**
- [ ] **A3 — Voice (hands-free STT + TTS).** Re-home the mic loop: Silero VAD → transcribe →
  feed `useEveAgent` → sentence-stream the reply to TTS with barge-in. Reference:
  `src/components/eve/useVoice.ts`, `sentenceStreamer.ts`, `speakable.ts`, `wav.ts`,
  `EqualizerBars.tsx`, and the kept routes `src/app/api/eve/{transcribe,speak}/route.ts` +
  `src/eve/audio.ts`. Main work: bridge VAD/TTS to Eve's stream events instead of the AI SDK
  `useChat` stream. **Large.**
- [ ] **A4 — Sandbox code-execution tool.** The original motivation. Add an
  `agent/sandbox/sandbox.ts` backend (`docker()`/`microsandbox()`/`just-bash` locally;
  Vercel Sandbox in prod) and a tool that runs code in it. New feature (no `ai-sdk`
  reference). Note: a Vercel-Sandbox prod path needs the cloud deploy (B/C below). **Medium–Large.**

---

## B. Hardening & cleanup (small; batchable)

From the per-task and final whole-branch reviews + integration findings.

- [x] **B1 — Unique `eveSessionId` + race-resilient upsert.** ✅ Done (commit 3931c3d). Make `Conversations.eveSessionId`
  `unique` (and/or wrap the find→create→update in `src/app/api/eve/session-index/route.ts`
  in a transaction) to remove the duplicate-row race under concurrent/double-submit persists.
  Regenerate types. *(Final review — recommended.)*
- [x] **B2 — Visual history replay on thread reopen.** ✅ Done (commit cfa6000). EveChat
  replays `?startIndex=0` events up to the stored `streamIndex` and seeds
  `useEveAgent.initialEvents`. **Also fixed a latent bug:** `persistSession` posted
  `sessionId` while the route expects `eveSessionId` → browser→Conversations persistence had
  been silently 400-ing since Task 6 (sidebar/history never persisted). Verified by e2e
  (reopen replays history). Plus e2e reliability fixes (commit 1ad9933): serial workers +
  API-based assertions; `seedUser` loads dotenv so Playwright workers hit the right DB.
- [x] **B3 — e2e Eve-runtime health guard.** ✅ Done (commit 7e241eb). The Eve runtime is a *second* process
  (`eve dev`) not managed by Playwright's `webServer`; if it's down the app 500s and the e2e
  fails confusingly. Add a `GET /eve/v1/health` precondition (globalSetup or in-test) so the
  failure is legible. *(Task 10.)*
- [x] **B4 — De-dupe session persistence.** ✅ Done (commit dda9696). `EveChat` persists on **both** `onSessionChange`
  and `onFinish` (idempotent but redundant). Pick one. Also: `persistSession` swallows
  non-2xx HTTP responses silently — `console.warn` on `!res.ok`. *(Task 6.)*
- [x] **B5 — Double-submit guard in `EveChat`.** ✅ Done (commit dda9696). No in-flight lock on `handleSubmit`; a rapid
  double-submit can create a duplicate sidebar entry (interacts with B1). Add an
  `isSubmitting` ref / disable during send. *(Task 6.)*
- [x] **B6 — README + assets.** ✅ devsafe + honest screenshot caption done (commit 89ed885); fresh screenshot capture still optional. Quick Start says `pnpm dev`; this repo needs `pnpm devsafe`
  (stale `.next` cache quirk). Replace the hero screenshot `images/eve-chat-post-preview.png`
  (it shows the deferred post-preview panel). *(Task 9.)*
- [x] **B7 — Test assertion gap.** ✅ Done (commit 89ed885). `updateConversationCursor` test doesn't assert
  `overrideAccess: false` on the find-phase lookup (impl is correct; test is thin). *(Task 5.)*
- [x] **B10 — `admin.e2e.spec.ts` "navigate to dashboard" flakiness.** ✅ Done. It asserted
  `span[title="Dashboard"]`, a selector Payload v4 canary dropped (same change the login
  helper worked around); switched to the stable `Dashboard` nav link.
- [x] **B8 — Reconcile `docker-compose.yml` profiles.** ✅ Done. Removed the `ollama` service
  (Eve's model runs via the Vercel AI Gateway, not local Ollama — Ollama stays on `ai-sdk`);
  dropped the stale `OLLAMA_BASE_URL` from the app profile; labelled `stt`/`tts` (voice, A3)
  and `searxng` (web, A2) as backing deferred features. `docker compose config` valid;
  services now: mongo, stt, tts, searxng.
- [x] **B9 — Triage orphaned modules.** ✅ Done (import-graph analysis). Deleted the genuinely
  dead `src/eve/system-prompt.ts` (no importers; superseded by `agent/instructions.md`).
  Confirmed `markdown-tool.ts` is LIVE (imported by `payload.config.ts` — the
  `createDocumentFromMarkdown` MCP tool). The rest are intentionally **retained, unwired,
  with passing tests**, to be folded in as their feature is re-homed:
  - post-preview (A1): `propose-tool.ts`, `approval-message.ts`, `PostPreviewPanel.tsx`
  - web search (A2): `web-tools.ts`, `web-search.ts`, `read-url.ts`, `url-safety.ts`
  - voice (A3): `audio.ts`, `config.ts` (getEveConfig), `useVoice.ts`, `sentenceStreamer.ts`,
    `speakable.ts`, `wav.ts`, `EqualizerBars.tsx`, and the `api/eve/{transcribe,speak}` routes
  When A1–A4 land, fold each cluster in (and retire `config.ts` once nothing uses it).

---

## C. Infra & decisions

- [ ] **C1 — BYOK Groq (use your own Groq credits).** Today the AI Gateway bills Vercel
  credits. To bill your Groq account instead, add Groq under **AI Gateway → Bring Your Own
  Key** in the dashboard (if Groq is offered there) — no code change. Decide whether to.
- [ ] **C2 — Deploy app to Vercel.** Model routing already uses AI Gateway; deploying moves
  Next.js/Payload hosting to Vercel (needs MongoDB Atlas, env vars). Required before a
  Vercel-Sandbox prod path for A4. Currently local-first.
- [ ] **C3 — OIDC token refresh for local dev.** `VERCEL_OIDC_TOKEN` (from `vercel env pull`)
  expires (~12h); re-pull when gateway calls start returning auth errors. Document/automate
  (e.g. a `predev` step, or use `AI_GATEWAY_API_KEY` for a stable local key).
- [ ] **C4 — Re-home admin auth if Users gains roles.** `appAuth` treats any
  `/api/users/me` user as admin (matches today's role-less Users collection). If Users later
  gets role-based admin restrictions, tighten the gate. *(Final review — informational.)*

---

## Push status

As of the migration completion, all work is committed to **`main`** locally and **not yet
pushed** to origin. (`ai-sdk` branch is pushed and holds the previous version.)
