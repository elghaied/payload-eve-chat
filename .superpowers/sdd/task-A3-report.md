# Task A3 Report — Hands-free voice via Deepgram

**Status:** DONE

---

## Commits

| SHA | Message |
|-----|---------|
| `1ffd3fe` | feat(voice): remove old self-hosted voice stack (Silero VAD + Whisper + kokoro) |
| `b517684` | feat(voice): add POST /api/deepgram/token — Payload-auth-gated short-lived token |
| `0812cdb` | feat(voice): rewrite useVoice for Deepgram STT + Aura TTS (native WebSocket) |
| `8dacb80` | feat(voice): wire Deepgram voice into EveChat + EveView; add mic button |

---

## Verification Outputs

### pnpm install
```
- @ricky0123/vad-web 0.0.30
Done in 3.1s
```
(Pre-existing peer warnings for vite/typescript version mismatches — unrelated.)

### pnpm exec tsc --noEmit
Exit code 0. Zero errors. (Required clearing `.next/` cache which had stale references to deleted routes.)

### pnpm run test:int
```
Test Files  11 passed (11)
Tests       70 passed (70)
```
Deleted test files gone; new token route tests (6) and decodeLinear16 tests (5) all pass.

### node_modules/.bin/eve info
```
Diagnostics   0 errors, 0 warnings
```
Unchanged — agent/ untouched.

---

## Files Changed / Deleted

### New
- `src/app/api/deepgram/token/route.ts` — POST endpoint; Payload auth gate; 401/503/502/200
- `src/app/api/deepgram/token/route.test.ts` — 6 tests: 401/401/503/200/502(DG)/502(network)

### Rewritten
- `src/components/eve/useVoice.ts` — Full Deepgram voice loop (see below)
- `src/components/eve/useVoice.test.ts` — NEW: 5 unit tests for `decodeLinear16` pure helper

### Modified
- `src/components/eve/EveChat.tsx` — voice wiring, mic button, stripSpeak display, VOICE_REPLY_INSTRUCTION
- `src/components/eve/EveView.tsx` — passes `voiceAvailable={!!process.env.DEEPGRAM_API_KEY}`
- `package.json` — removed `@ricky0123/vad-web`, removed `postinstall`/`vad:assets` scripts, stripped VAD prefix from `build`/`dev`/`devsafe`

### Deleted
- `src/app/api/eve/speak/route.ts` + `route.test.ts`
- `src/app/api/eve/transcribe/route.ts` + `route.test.ts`
- `src/eve/audio.ts` + `audio.test.ts`
- `src/components/eve/wav.ts` + `wav.test.ts`
- `src/eve/config.ts` + `config.test.ts` — deleted because no remaining importers after routes gone
- `scripts/copy-vad-assets.mjs`
- `public/vad/` (5 files: ONNX models, WASM, worklet bundle)

---

## Design Decisions

### Barge-in wiring
The brief offered two choices: `onBargeIn` callback vs. EveChat reacting to state.

**Chosen:** `onBargeIn` callback. `useVoice` accepts an optional `onBargeIn: () => void`. EveChat passes `() => agent.stop()`. This keeps the hook self-contained and means the caller decides the exact abort action. The hook transitions state to `listening` after clearing playback; EveChat reacts via the visual state already (the mic button shows EqualizerBars/MicIcon based on `voice.active`).

### WebSocket subprotocol for access tokens
Used `['bearer', token]` (NOT `['token', token]`). The findings doc had one inconsistency (cheatsheet footer showed `['token', JWT]` for access tokens but text + brief clarification specified `['bearer', token]`). The brief explicitly locked this to `['bearer', token]` for short-lived access tokens, which matches the SDK source and Deepgram token-auth docs. Both STT and TTS WebSockets use this subprotocol.

### No @deepgram/sdk
Implemented entirely with native `WebSocket`, native `fetch`, and `AudioContext`. The STT WebSocket sends raw `MediaRecorder` Blobs (webm/opus, 250 ms chunks) — no `encoding`/`sample_rate` params. The TTS WebSocket receives binary `ArrayBuffer` frames (linear16 PCM) decoded with `decodeLinear16()`.

### voiceAvailable flow
`EveView` (RSC) reads `!!process.env.DEEPGRAM_API_KEY` at render time and passes it as a prop to `<EveChat voiceAvailable={...}>`. `EveChat` threads it through to `EveChatInner`. The mic button only renders when `voiceAvailable` is true. The token route also independently returns 503 if the key is absent (defense in depth).

### config.ts deletion
`src/eve/config.ts` was only imported by the two deleted routes and `src/eve/audio.ts`. After deleting those, `config.ts` had zero importers in `src/` (confirmed with `grep -rn "getEveConfig\|eve/config"`). Deleted along with its test.

### stripSpeak for display
All assistant message text parts are passed through `stripSpeak()` before rendering in `MessageResponse`. This ensures `<speak>…</speak>` tags (and their inner content) don't appear raw in the chat — the TTS speaks that block, the rest of the reply renders normally.

---

## Behaviors Requiring Manual Verification (mic/live Deepgram)

The following cannot be tested without a real mic and a set `DEEPGRAM_API_KEY`:

1. **Mic capture and STT WebSocket connection** — does `getUserMedia` succeed in the browser; does the STT WebSocket open with the `['bearer', token]` subprotocol and authenticate successfully?

2. **MediaRecorder webm/opus Blobs** — are the 250 ms chunks accepted by Deepgram nova-3 without encoding params? (Should be per docs; Deepgram auto-detects webm/opus.)

3. **is_final accumulation + speech_final dispatch** — does the transcript accumulate correctly across chunks; does `speech_final` fire reliably on utterance end (not too eager, not missing); does `UtteranceEnd` backstop work when `speech_final` doesn't fire?

4. **TTS WebSocket linear16 playback** — do the binary ArrayBuffer frames arrive and decode into coherent audio via AudioContext at 24 kHz? Any gap/stutter between FIFO queue entries?

5. **Sentence streaming fidelity** — does `extractSpeak` + `createSentenceStreamer` + `sendSentenceToTts` produce natural speech onset (low latency to first audio after Eve starts replying)?

6. **Barge-in detection** — does `SpeechStarted` fire when the user speaks over TTS playback? Does AEC (`echoCancellation: true`) prevent TTS audio from triggering spurious barge-in on speakers (vs. headphones)?

7. **VOICE_REPLY_INSTRUCTION effectiveness** — does Eve reliably wrap its response in `<speak>…</speak>` when clientContext is set? Is the spoken portion concise?

8. **Mic button UX** — does `EqualizerBars` appear and animate while active? Does dimming at `opacity-50` work visually during `thinking`/`speaking` states?

9. **Token TTL race** — the STT WS is opened with a 30 s token; the WS stays open after expiry (expected per Deepgram docs). Does a long voice session (> 30 s continuous) stay connected? (It should — the token is only used for the handshake.)

10. **TTS WS opening concurrency** — both tokens are fetched with `Promise.all` before opening; does this cause any timing issue on slow connections?

11. **echo/feedback at high speaker volume** — verify that `echoCancellation: true` is sufficient to suppress TTS playback from mic on speaker (not headphone) setups.

---

## Notes

- The `MediaRecorder` mime type `'audio/webm;codecs=opus'` is standard in Chrome/Edge/Firefox on desktop. Safari may require a fallback. This is an acceptable known limitation for the admin-facing voice feature (Payload admin UI is primarily a desktop Chrome/Firefox surface).
- `AudioContext` is suspended in Chrome until a user gesture — the mic button click counts as a user gesture, so the `new AudioContext()` call inside `start()` should be fine.
- The TTS WebSocket error handler falls back to a toast and continues (STT still works without TTS). This degrades gracefully.
