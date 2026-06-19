# Eve Voice (hands-free STT + TTS) — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — ready for implementation plan
**Goal:** Add self-hosted, GPU-accelerated speech-to-text (STT) and text-to-speech (TTS) to the Eve admin chat, wired into a hands-free voice conversation loop, behind a model-agnostic OpenAI-compatible contract.

---

## 1. Summary

Eve today is a text chat (Payload v4 admin custom view at `/admin/eve`) driven by the Vercel AI SDK, with a clean LLM-provider abstraction in `src/eve/config.ts` / `src/eve/provider.ts` (anthropic | openai | ollama) and an MCP tool layer. This feature adds **voice** as a layer over the existing text chat:

- Speak to Eve (mic → STT → transcript → existing chat send).
- Hear Eve reply (streamed assistant text → sentence-by-sentence TTS → audio playback).
- Hands-free turn-taking with client-side voice-activity detection (VAD) and barge-in.

The text chat is unchanged and keeps working; voice is additive and toggleable.

## 2. Requirements (decided during brainstorming)

- **Voice UX:** Hands-free conversation — continuous listening, auto-transcribe on utterance end, auto-speak replies, barge-in.
- **Agnostic contract:** Standardize on the **OpenAI audio API** shape (`/v1/audio/transcriptions`, `/v1/audio/speech`). Any compatible server — local Docker or cloud — drops in via base URL + model name, mirroring the existing `provider.ts` pattern.
- **Hardware:** NVIDIA GPU available; Docker services default to GPU. CPU image variants are documented as a drop-in alternative so the project runs without a GPU.
- **TTS responsiveness:** Sentence-streaming — synthesize + play each sentence as it completes, so Eve starts talking ~1 sentence into the reply.
- **Topology:** Two specialized Docker services (Approach A) — `speaches` for STT, `Kokoro-FastAPI` for TTS — each independently swappable, behind a compose `voice` profile so they are opt-in.
- **Optional & independently gated:** STT and TTS are each optional. A service is "attached" when its base-URL env var is set. Nothing set → chat-only, and the app runs normally. The voice button is always present; clicking it with no STT attached shows an admin toast ("No speech-to-text service is attached"). TTS attached without STT, or vice versa, degrades gracefully (see §4.6).

## 3. Architecture

```
Browser (Eve custom view)                Next.js API (server-only)         Docker (GPU)
─────────────────────────                ─────────────────────────         ────────────
mic → Silero VAD (client)  ──utterance──▶ POST /api/eve/transcribe ──────▶ speaches  (STT)
                                              └─ payload.auth() gate
transcript ─▶ existing useChat ──────────▶ POST /api/eve (unchanged LLM stream)
assistant text stream ─▶ sentence splitter
  each sentence ─────────────────────────▶ POST /api/eve/speak ──────────▶ kokoro    (TTS)
  ◀── audio ── play in queue; barge-in stops playback when VAD fires again
```

**Boundaries / responsibilities:**

- **Browser** does mic capture, VAD, sentence splitting, and audio playback only. It never sees the STT/TTS base URLs.
- **Server proxy routes** hold the STT/TTS config, enforce the same `payload.auth()` gate as the chat route, and forward to the Docker services.
- **`src/eve/audio.ts`** is the single place that speaks the OpenAI audio HTTP contract; swapping providers requires no code change there — only env changes (base URL / model / key).
- **Docker services** are stateless inference servers reached over the OpenAI-compatible HTTP API.

## 4. Component design

### 4.1 Docker services (`docker-compose.yml`)

Two opt-in services behind a compose `voice` profile (so a plain `docker compose up` stays chat-only; `docker compose --profile voice up` starts them). Ports are published to host so a host-run `pnpm devsafe` reaches them at `localhost` (same pattern as Ollama at `localhost:11434`). GPU is the default; CPU image variants are commented inline.

```yaml
  stt:
    image: ghcr.io/speaches-ai/speaches:latest-cuda
    # No GPU? Use the CPU image instead and delete the `deploy:` block below:
    #   image: ghcr.io/speaches-ai/speaches:latest-cpu
    profiles: ['voice']
    ports:
      - '8000:8000'
    volumes:
      - hf-cache:/home/ubuntu/.cache/huggingface/hub
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  tts:
    image: ghcr.io/remsky/kokoro-fastapi-gpu:latest
    # No GPU? Use the CPU image instead and delete the `deploy:` block below:
    #   image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
    profiles: ['voice']
    ports:
      - '8880:8880'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

volumes:
  # ... existing: data, node_modules
  hf-cache:
```

- The `voice` profile + **no `depends_on`** means voice is fully opt-in and the services start independently.
- STT model is pulled on first use by `speaches`; default `Systran/faster-whisper-small`.
- TTS (`Kokoro-FastAPI`) serves the `kokoro` model with multiple voices; default voice `af_sky`, default output `mp3`.

### 4.2 Config (`src/eve/config.ts`)

Extend `EveConfig` and `getEveConfig()` with an audio block. **The base URL is the attach signal** — when `STT_BASE_URL` / `TTS_BASE_URL` is unset, that service is not attached and is treated as unavailable. There is no separate master flag. New env keys, all OPTIONAL (commented out in `.env.example`):

```
# STT_BASE_URL=http://localhost:8000/v1   # set to attach speech-to-text
# STT_MODEL=Systran/faster-whisper-small
# STT_API_KEY=
# TTS_BASE_URL=http://localhost:8880/v1   # set to attach text-to-speech
# TTS_MODEL=kokoro
# TTS_VOICE=af_sky
# TTS_FORMAT=mp3
# TTS_API_KEY=
```

Added `EveConfig` fields:

```ts
sttBaseURL?: string   // undefined => STT not attached
sttModel: string      // default; only meaningful when attached
sttApiKey?: string
ttsBaseURL?: string   // undefined => TTS not attached
ttsModel: string
ttsVoice: string
ttsFormat: string     // 'mp3' | 'wav' | 'opus' | ... (passed through to TTS)
ttsApiKey?: string
```

Resolution rules:
- `sttBaseURL` / `ttsBaseURL` = the env var verbatim, or `undefined` (no default — absence means "not attached").
- `sttModel` / `ttsModel` / `ttsVoice` / `ttsFormat` fall back to defaults (`Systran/faster-whisper-small`, `kokoro`, `af_sky`, `mp3`).
- Never throws on missing audio keys/URLs — a chat-only config is valid.
- Availability is derived, not stored: `!!config.sttBaseURL` / `!!config.ttsBaseURL` (routes use this; the server view computes the same from `process.env` to gate the UI without leaking URLs).

### 4.3 Audio client (`src/eve/audio.ts`)

Server-only module. Two functions speaking the OpenAI audio contract with plain `fetch` (no SDK), so any compatible endpoint works by base-URL swap.

```ts
import type { EveConfig } from './config'

/** POST {STT_BASE_URL}/audio/transcriptions (multipart). Returns the transcript text. */
export async function transcribe(args: { audio: Blob; config: EveConfig }): Promise<string>

/** POST {TTS_BASE_URL}/audio/speech (JSON). Returns the audio response (streamable). */
export async function synthesize(args: {
  text: string
  voice?: string
  config: EveConfig
}): Promise<Response>
```

- `transcribe` builds a `FormData` with `file` (the audio Blob, `audio.wav`) and `model` = `config.sttModel`; sets `Authorization: Bearer ${sttApiKey}` only when a key is present; parses `{ text }` from the JSON response.
- `synthesize` POSTs `{ model: config.ttsModel, input: text, voice: voice ?? config.ttsVoice, response_format: config.ttsFormat }`; sets the bearer header only when `ttsApiKey` is present; returns the raw `Response` so the route can stream its body through.
- Each guards its base URL first: if the relevant base URL is unset, throw `AudioServiceError(service, 0, 'not configured')` (self-defending even though routes also check).
- Both throw a typed error on non-2xx with the upstream status + body snippet for logging.

### 4.4 Proxy routes

**`src/app/api/eve/transcribe/route.ts`** — `POST`:
1. `getPayload`, `payload.auth({ headers })`; reject `!user` (401) and `user.collection !== 'users'` (403) — identical gate to `src/app/api/eve/route.ts`.
2. If `!eveConfig.sttBaseURL` → 503 `{ error: 'No speech-to-text service is attached' }`.
3. Read `multipart/form-data`, pull the `file` Blob; if missing → 400.
4. `const text = await transcribe({ audio, config })`; on upstream error log via `payload.logger.error({ msg, err })` and return 503 `{ error }`.
5. Respond `Response.json({ text })`.

**`src/app/api/eve/speak/route.ts`** — `POST`:
1. Same auth gate.
2. If `!eveConfig.ttsBaseURL` → 503 `{ error: 'No text-to-speech service is attached' }`.
3. Parse `{ text, voice? }` from JSON; empty `text` → 400.
4. `const upstream = await synthesize({ text, voice, config })`; on error → 503.
5. Stream the audio back: `new Response(upstream.body, { headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg' } })`.

### 4.5 Sentence streamer (`src/components/eve/sentenceStreamer.ts`)

A pure, framework-free helper (so it is exhaustively unit-testable). Tracks how much of an assistant message's text has already been turned into speech and emits newly-completed sentences.

```ts
export type SentenceStreamer = {
  /** Feed the latest full text of the streaming assistant message.
   *  Returns sentences newly completed since the last push (may be empty). */
  push(fullText: string): string[]
  /** Stream finished: returns any trailing remainder as a final sentence (or []). */
  flush(): string[]
}

export function createSentenceStreamer(): SentenceStreamer
```

- Maintains `consumed` (index into the text already emitted).
- On `push`, scan `fullText.slice(consumed)` for sentence-ending boundaries (`.`, `!`, `?`, newline, and their CJK equivalents `。！？`) followed by whitespace/end; emit each complete sentence, advance `consumed`. Trailing incomplete text stays buffered.
- Avoid splitting on common abbreviations (`e.g.`, `i.e.`, `Mr.`, `Dr.`, `vs.`, decimals like `3.14`) via a small guard list + digit check.
- `flush` emits `fullText.slice(consumed).trim()` if non-empty.
- Whitespace-only emissions are dropped.

### 4.6 Voice loop hook (`src/components/eve/useVoice.ts`)

Encapsulates capture, VAD, transcription, sentence-streamed playback, and barge-in. Consumed by `EveChat.tsx`.

```ts
type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export function useVoice(opts: {
  sttAvailable: boolean                        // STT attached (server told us)
  ttsAvailable: boolean                        // TTS attached (server told us)
  status: string                              // useChat status ('streaming' | 'submitted' | ...)
  assistantText: string | undefined           // latest streaming assistant message text
  onTranscript: (text: string) => void         // -> sendMessage
}): {
  active: boolean                              // call started?
  state: VoiceState
  start: () => Promise<void>                   // request mic, init VAD
  stop: () => void                             // hang up: stop VAD, abort fetches, clear queue
}
```

Notifications use the admin's `toast` (from `@payloadcms/ui`), not inline error state.

Behavior:
- `start()`: **guard first** — if `!sttAvailable`, `toast.error('No speech-to-text service is attached.')` and stay `idle` (a hands-free loop needs speech input). Otherwise `getUserMedia` (mic) + init `@ricky0123/vad-web` (`MicVAD`). On permission denial `toast.error(...)` and stay `idle`. If `sttAvailable && !ttsAvailable`, `toast.info("No text-to-speech attached — Eve's replies won't be spoken.")` once, and skip the TTS path (transcription still works).
- **VAD speech-end** → grab PCM (Float32 @ 16 kHz) → `encodeWav()` → `POST /api/eve/transcribe` → `onTranscript(text)` (which calls `sendMessage`). State `transcribing` → `thinking`.
- **Assistant streaming** (driven by `assistantText` + `status`, only when `ttsAvailable`): feed a `createSentenceStreamer()`; for each emitted sentence `POST /api/eve/speak` and enqueue audio in a **sequential playback queue** (one `Audio` source at a time, FIFO). State `speaking` while the queue is non-empty. On `status` leaving `streaming`, call `streamer.flush()` and enqueue the remainder.
- **Barge-in:** VAD **speech-start** while `speaking` → abort the in-flight `/speak` fetch (`AbortController`), clear the queue, stop current playback, return to `listening`.
- `stop()`: tear down VAD, abort all fetches, clear queue, release mic tracks.
- All async work guards an `unmounted`/aborted flag.

Helper `encodeWav(float32, sampleRate)` (in the same file or `src/components/eve/wav.ts`) builds a 16-bit PCM WAV Blob from VAD output.

### 4.7 `EveChat.tsx` integration

- Add a call-style toggle button (mic / hang-up) to the existing `PromptInputFooter` (next to submit). The button is **always rendered** so voice is discoverable; the not-attached case is handled by the toast guard in `useVoice` (so a chat-only user who clicks it learns why, rather than seeing a missing control).
- Wire `useVoice`:
  - `assistantText` = text of the latest assistant message (derived from `messages`).
  - `onTranscript` = `(t) => sendMessage({ text: t }, { body: { conversationId } })` (same call `handleSubmit` uses).
- Show a compact state indicator (listening / thinking / speaking); notifications come from `toast`.
- `sttAvailable` / `ttsAvailable` are computed server-side in `EveView.tsx` from `process.env.STT_BASE_URL` / `process.env.TTS_BASE_URL` and passed down as booleans — the client never receives base URLs or keys.

## 5. Data flow (one hands-free turn)

1. User speaks → VAD detects end of utterance → WAV → `/api/eve/transcribe` → transcript.
2. Transcript → `sendMessage` → existing `/api/eve` LLM stream (unchanged).
3. Assistant text streams into the latest message; `useVoice` feeds the sentence streamer.
4. Each completed sentence → `/api/eve/speak` → audio enqueued → played FIFO.
5. If the user starts speaking mid-playback → barge-in aborts playback and returns to listening.
6. On stream finish, the streamer flushes the trailing sentence.

## 6. Error handling

- **Mic permission denied:** `useVoice` toasts an error, stays idle; text chat unaffected.
- **STT not attached** (no `STT_BASE_URL`): clicking voice toasts "No speech-to-text service is attached" and does nothing else. **TTS not attached** (no `TTS_BASE_URL`): voice input still works; a one-time toast notes replies won't be spoken; the `/speak` path is skipped. **Neither attached:** chat-only; the app is unaffected.
- **STT/TTS service down or non-2xx:** route returns 503 with a readable message; `useVoice` toasts it (transcription failures) or fails the sentence silently (playback), staying in text mode (no crash, no broken queue).
- **Aborts:** every fetch uses an `AbortController`; `stop()` / unmount aborts in-flight requests and clears the playback queue.
- **Logging:** server routes log upstream failures via `payload.logger.error({ msg, err })` (project logger convention).

## 7. Testing

Unit tests with **vitest**, matching `src/eve/config.test.ts` / `src/eve/provider.test.ts`:

- **config:** `getEveConfig` audio fields — base URLs undefined when unset (not attached), model/voice/format defaults, env overrides, key pass-through.
- **audio client:** `transcribe`/`synthesize` request shaping with a mocked `fetch` — correct URL, multipart vs JSON body, model/voice/format fields, bearer header present only when a key is set, error thrown on non-2xx.
- **sentenceStreamer:** exhaustive — single/multiple sentences across pushes, mid-sentence buffering, abbreviation/decimal guards, `flush` remainder, whitespace-only dropped, CJK punctuation.

Browser-only pieces (mic capture, VAD, audio playback, barge-in) are **verified manually** with documented steps (start services, open `/admin/eve`, toggle voice, speak, confirm transcript + spoken reply + barge-in). Not unit-tested.

## 8. New / changed files

- `docker-compose.yml` — add `stt`, `tts` services (compose `voice` profile, GPU default + CPU comment) + `hf-cache` volume. *(modify)*
- `.env.example` — add the optional (commented-out) voice env block. *(modify)*
- `src/eve/config.ts` — extend `EveConfig` + `getEveConfig`. *(modify)*
- `src/eve/config.test.ts` — audio config cases. *(modify)*
- `src/eve/audio.ts` — OpenAI-compatible `transcribe` / `synthesize`. *(new)*
- `src/eve/audio.test.ts` — request-shaping tests. *(new)*
- `src/app/api/eve/transcribe/route.ts` — STT proxy. *(new)*
- `src/app/api/eve/speak/route.ts` — TTS proxy. *(new)*
- `src/components/eve/sentenceStreamer.ts` — pure sentence splitter. *(new)*
- `src/components/eve/sentenceStreamer.test.ts` — splitter tests. *(new)*
- `src/components/eve/wav.ts` — Float32 → 16-bit PCM WAV. *(new)*
- `src/components/eve/useVoice.ts` — voice loop hook. *(new)*
- `src/components/eve/EveChat.tsx` — voice button + `useVoice` wiring. *(modify)*
- `src/components/eve/EveView.tsx` — compute + pass `sttAvailable` / `ttsAvailable` props from `process.env`. *(modify)*
- `package.json` — add `@ricky0123/vad-web` (and its `onnxruntime-web` peer if required). *(modify)*
- `README.md` — voice setup (Docker services, env, agnostic swap to cloud). *(modify)*

## 9. Dependencies

- `@ricky0123/vad-web` (+ `onnxruntime-web` if a required peer) for client-side Silero VAD.
- Docker images: `ghcr.io/speaches-ai/speaches:latest-cuda`, `ghcr.io/remsky/kokoro-fastapi-gpu:latest`.
- No new server-side npm deps — `audio.ts` uses native `fetch`/`FormData`.

## 10. Out of scope (YAGNI)

- Persisting audio (only transcripts are saved, as normal messages).
- Wake-word / always-on listening outside the chat view.
- Multi-language voice selection UI (voice/format are env-configurable; no UI picker).
- Streaming STT (utterance-at-a-time is sufficient for hands-free turn-taking).
