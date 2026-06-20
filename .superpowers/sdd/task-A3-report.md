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

---

## A3 Code-Review Fix Pass — `fix(eve): harden Deepgram voice WS error handling (A3 review)`

Applied findings from the A3 code review. All changes are in
`src/components/eve/useVoice.ts` and `src/app/api/deepgram/token/route.test.ts`.

### Finding 1 — [Critical] Dead TTS `onerror` after handshake

**Problem:** The persistent `ws.onerror` toast handler set before the open-wait Promise was
clobbered by the rejecting `onerror` assigned _inside_ the Promise, leaving mid-session TTS
errors silent.

**Fix:** Removed the pre-await `ws.onerror` assignment. Changed the open-wait to use
`ws.addEventListener('error', …, { once: true })` so it fires exactly once for handshake
rejection without overwriting the handler property. After `await` resolves, assigned a
persistent `ws.onerror` handler that toasts the mid-session error.

### Finding 2 — [Important] Stale `active` in `sttWs.onclose`

**Problem:** `onclose` captured the `active` state variable at the time `start()` was defined
(always `false` before `setActive(true)` ran), so the unexpected-disconnect toast never fired.

**Fix:** Added `const activeRef = useRef(false)` and a `useEffect(() => { activeRef.current =
active })` (no deps — runs after every render) to mirror live state into the ref. `onclose`
now reads `activeRef.current`.

### Finding 3 — [Important] `active` in `start` dependency array

**Problem:** `active` in the `useCallback` deps caused `start` (and therefore `toggle`) to
get a new identity each time voice was activated, breaking stable-reference assumptions and
adding a re-render on every state change.

**Fix:** Removed `active` from the deps array. All internal reads of `active` inside `start`
already used `activeRef.current` after Finding 2. Added an `eslint-disable-next-line
react-hooks/exhaustive-deps` comment with explanation.

### Finding 4 — [Important] Misleading test comment

**Problem:** The comment at `route.test.ts` line 81 said "Key must NOT appear … (just check it
uses Bearer form)" — contradicting the assertion which does verify the key IS present in the
server-to-Deepgram request.

**Fix:** Rewrote the comment to: "Verify the server's outgoing request to Deepgram
(server-to-Deepgram, never sent to the client) uses the API key in a Token Authorization
header — not a Bearer/JWT."

### Finding 5 — [Minor] STT open-wait hangs forever on error/close

**Problem:** The STT open-wait `Promise` had no rejection path — if the WS errored or closed
before `open`, the Promise would hang indefinitely.

**Fix:** Replaced the bare `addEventListener('open', resolve)` with a full resolve/reject pair:
`open` → `resolve`, `error` → `reject`, `close` → `reject`. Wrapped the await in `try/catch`
that toasts the error and returns early (cleaning up the mic stream).

### Finding 6 — [Minor] AudioContext leak on `openTtsWs` failure

**Problem:** `AudioContext` was created immediately before `openTtsWs`. If TTS handshake
failed, the `catch` block continued to STT setup without closing the newly created
`AudioContext`, leaking it for the duration of the STT-only session.

**Fix:** Added `void audioCtxRef.current?.close().catch(() => {})` + `audioCtxRef.current =
null` inside the `openTtsWs` catch block. The comment "Continue: STT still works" is retained
because STT does still start; the AudioContext is re-created later only if TTS opens.
(Note: TTS-only continuation without AudioContext is intentional — the hook already guards
`if (!ctx) return` in `playNext`.)

### Verification

```
pnpm exec tsc --noEmit
→ Exit 0, 0 errors

pnpm run test:int
→ Test Files  11 passed (11)
→ Tests       70 passed (70)
→ Duration 1.66s

node_modules/.bin/eve info
→ Diagnostics   0 errors, 0 warnings
```
