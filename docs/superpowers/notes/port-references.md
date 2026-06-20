# Port references — re-homing deferred features onto Eve

> Survey of current `main` UI + `ai-sdk` branch reference impls, for A1 (post-preview),
> A2 (web), A3 (voice). Read source via `git show ai-sdk:<path>` for the old branch.

## A. Current Eve chat UI (`main`)

- `src/components/eve/EveView.tsx` — RSC. `listConversations` + `loadConversationBySession`,
  renders `<EveChat key={activeId ?? 'new'} ...>` (remount per thread).
- `src/components/eve/EveChat.tsx` — two parts:
  - `EveChat` (outer, ~143–181): history replay. If `needsReplay`, GET
    `/eve/v1/session/{id}/stream?startIndex=0` (NDJSON) until `events.length >= targetCount`
    or 15s, then mounts `EveChatInner`.
  - `EveChatInner` (~185–339): one `useEveAgent` per mount.
    ```ts
    const agent = useEveAgent({ initialSession, initialEvents, onSessionChange })
    ```
- `src/components/eve/ConversationSidebar.tsx` — "+ New chat" + thread list.

### Message part rendering (~280–315)
`text` → `<MessageResponse>`; `reasoning` → `<Reasoning>`; `dynamic-tool` → `renderToolPart()`
(~122–139) renders `<Tool>/<ToolHeader>/<ToolInput>/<ToolOutput>` only for `output-available`/
`output-error`. **`approval-requested`/`approval-responded` fall through to null** — A1 fixes this.

### Integration points
- **Voice mic button**: absent. Goes in `<PromptInputFooter>` (~326–334), inside a
  `<PromptInputTools>` wrapper alongside `<PromptInputSubmit>`.
- **Post-preview panel**: absent. Becomes a 3rd sibling of `<ConversationSidebar>` + main column
  in the outer `<div className="eve-scope flex ...">` (~264).
- **Persist**: `persistSession()` POSTs `/api/eve/session-index` with
  `{ eveSessionId, continuationToken, streamIndex, title }` on `onSessionChange`.
- **Submit**: `handleSubmit` → `agent.send({ message })`, `sendingRef` guards double-submit,
  new threads push `?conversation={sid}`.

## B. Post-preview (A1) — `ai-sdk` reference
- `src/eve/propose-tool.ts` (both branches, identical): `proposePost` built with `tool()` from
  `'ai'` — no-write, echoes `{ title, status: 'draft'|'published', markdown }`. Orphaned on main.
- `src/eve/approval-message.ts` (main): `PostDraft = { title, status, markdown }` +
  `buildApprovalMessage(draft)`. Imported only by PostPreviewPanel for the type.
- `src/components/eve/PostPreviewPanel.tsx` (both, identical): props
  `{ draft: PostDraft; onApprove: (final: PostDraft) => void; onClose: () => void }`.
  Drag-resize right panel (localStorage `eve:postPreviewWidth`), title Input, status Select,
  edit/preview tabs, "Add it" (disabled when title/markdown empty) → `onApprove`, "Discard".

### Re-home on Eve (chosen approach: native HITL)
- `agent/tools/proposePost.ts` via `defineTool()` with `needsApproval: always()`, input
  `{ title, status, markdown }`, and `execute` that creates the post (call Payload MCP /
  `createDocumentFromMarkdown` semantics, OR — since agent/ can't import src/ — instruct via
  the existing MCP tools). Simpler: tool's `execute` posts to Payload's REST/MCP over HTTP with
  the admin token. Decide in the A1 plan.
- EveChat `renderToolPart`: add `approval-requested` branch → when tool is `proposePost`, parse
  `part.input` as `PostDraft`, render `<PostPreviewPanel>`; `onApprove` →
  `agent.send({ inputResponses: [{ requestId, optionId: 'approve' }] })` (after editing, pass
  edited fields — may need text/freeform or a follow-up message with the edited content);
  `onClose` → `optionId: 'deny'`.

## C. Voice (A3) — `ai-sdk` reference (being REPLACED by Deepgram)
Old flow: Silero VAD (`@ricky0123/vad-web`) → `encodeWav` → POST `/api/eve/transcribe`
(OpenAI-compatible Whisper bridge) → `onTranscript` → `sendMessage` → stream → `extractSpeak`
→ `createSentenceStreamer` → POST `/api/eve/speak` (kokoro) → sequential `Audio` playback.
State machine: `idle→listening→transcribing→thinking→speaking→listening`. Barge-in:
`onSpeechStart` → `clearPlayback()` (abort speak fetch, drop queue).

### KEEP (provider-agnostic)
- `src/components/eve/EqualizerBars.tsx` — CSS bars (`eve-eq` keyframe in eve.css). Keep as-is.
- `src/components/eve/sentenceStreamer.ts` — `createSentenceStreamer()` → `{ push, flush }`.
  Keep (for streaming TTS sentence-by-sentence).
- `src/components/eve/speakable.ts` — `extractSpeak`/`stripSpeak`/`stripForSpeech`. Keep.
- FIFO TTS queue pattern (`pumpSpeak`/`playNext`) and barge-in `clearPlayback` pattern: keep,
  adapt to Deepgram WS.
- Mic button affordance: `<PromptInputTools><PromptInputButton>` toggling voice, showing
  `<EqualizerBars>` (dim when thinking/transcribing) or `<MicIcon>`.

### REPLACE (provider-specific)
- `@ricky0123/vad-web` + `scripts/copy-vad-assets.mjs` + `public/vad/` → Deepgram live STT WS
  (`SpeechStarted`/`is_final`/`speech_final`/`UtteranceEnd` events replace VAD callbacks).
- `/api/eve/transcribe` + `/api/eve/speak` + `src/eve/audio.ts` + `wav.ts` → Deepgram WS
  (STT + Aura TTS) opened from the browser with a short-lived token from a new
  `POST /api/deepgram/token` route (Payload-auth-gated, mints JWT via `/v1/auth/grant`).
- Voice system-prompt injection: ai-sdk appended `VOICE_REPLY_INSTRUCTION` server-side; on Eve
  use `agent.send({ message, clientContext: VOICE_REPLY_INSTRUCTION })` (ephemeral, per-turn).

## D. Retained-but-unwired modules on `main` (delete vs adapt)
| File | Disposition |
|------|-------------|
| `src/eve/web-tools.ts`, `web-search.ts`, `read-url.ts`, `url-safety.ts` (+tests) | **DELETE** (A2 = Eve built-ins). AI-SDK `tool()` based. |
| `src/eve/propose-tool.ts` | **DELETE** after A1 (replaced by `agent/tools/proposePost.ts`). |
| `src/eve/approval-message.ts` | Keep `PostDraft` type (used by panel); `buildApprovalMessage` may be unused with native HITL. |
| `src/eve/audio.ts`, `wav.ts` | **DELETE** with A3 (Deepgram replaces). |
| `src/eve/config.ts` (`getEveConfig`) | Retire once nothing imports it (transcribe/speak routes go away in A3). |
| `src/app/api/eve/{transcribe,speak}/route.ts` | **DELETE** with A3. |
| `useVoice.ts` | **REWRITE** for Deepgram (keep queue/barge-in skeleton). |
| `sentenceStreamer.ts`, `speakable.ts`, `EqualizerBars.tsx` | Keep, wire into new voice. |
| `PostPreviewPanel.tsx` | Keep, wire into EveChat (A1). |

`jsdom` + `@mozilla/readability` deps + their `serverExternalPackages` entries: **DROP** (only
`read-url` used them; `web_fetch` does HTML→markdown internally).
