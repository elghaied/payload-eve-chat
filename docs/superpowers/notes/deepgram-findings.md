# Deepgram API Findings: Hands-Free Voice Loop

**Research date:** 2026-06-20  
**Purpose:** Replace self-hosted Silero VAD + speaches Whisper STT + kokoro TTS with Deepgram cloud APIs in payload-eve-chat (Next.js 16 / React 19).  
**Sources:** Context7 Deepgram JS SDK docs, Deepgram API reference (developers.deepgram.com), Deepgram pricing page, npm registry.

---

## 1. JS/TS SDK

### Package and Install

```bash
pnpm add @deepgram/sdk
# Current version: 5.4.0 (as of June 2026)
```

The SDK is `@deepgram/sdk`. v5 is the current stable release; it changed the API substantially from v4 — boolean options must now be passed as **strings** (`"true"` not `true`), and connection methods use a different call pattern (see below).

### Creating a Client

```typescript
import { DeepgramClient } from "@deepgram/sdk";

// Server-side (Node.js route handler) — uses DEEPGRAM_API_KEY env var
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

// Browser-side — use a short-lived token (see §Security below)
const deepgram = new DeepgramClient({ accessToken: shortLivedJWT });
```

`DeepgramClient` auto-detects the runtime (Node.js vs browser). In Node.js it uses the `ws` library and can send custom headers. In the browser it uses the native `WebSocket` API, which cannot send custom headers — the SDK handles this automatically by passing the API key/token via the `Sec-WebSocket-Protocol` subprotocol header (`["token", API_KEY]` for API keys, `["bearer", JWT]` for access tokens).

### Next.js Bundling Caveats

- `@deepgram/sdk` uses Node.js internals (`ws`, `node-fetch`, etc.) on the server side. Add it to `serverExternalPackages` in `next.config.ts` to prevent Next.js from trying to bundle it:

```typescript
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["@deepgram/sdk"],
};
```

- **Do not** import `DeepgramClient` in components that run on the Edge Runtime — it requires Node.js APIs. Keep all server-side Deepgram code in Route Handlers (`app/api/**/route.ts`) running on the Node.js runtime.
- The SDK **can** be imported in the browser (client components) for the WebSocket live-transcription client, as long as you do not import it server-only modules.
- Split imports: use `DeepgramClient` only in files that run exclusively on one side. A shared utility that calls `new DeepgramClient(...)` at module load is safe in a Next.js Route Handler but will fail if accidentally included in a client bundle without a proper API key.

---

## 2. Streaming STT (Live Transcription)

### WebSocket Endpoint

```
wss://api.deepgram.com/v1/listen
```

### Recommended Model

**`nova-3`** — Deepgram's latest and most accurate streaming model (as of 2026). Use `nova-3` for English; it supports multilingual variants too. `nova-2` is still available and supported but nova-3 is preferred for new integrations.

### Key Connection Parameters (v5 SDK — pass as strings)

| Parameter | Recommended value | Purpose |
|---|---|---|
| `model` | `"nova-3"` | STT model |
| `language` | `"en"` | Language code |
| `interim_results` | `"true"` | Receive partial transcripts as the user speaks |
| `endpointing` | `"300"` | ms of silence before `speech_final=true` fires (300ms is a good hands-free default; range: 10–2000ms, or `"false"` to disable) |
| `utterance_end_ms` | `"1000"` | ms after last word before a `UtteranceEnd` event fires (requires `interim_results=true` and `vad_events=true`) |
| `vad_events` | `"true"` | Enables `SpeechStarted` and `UtteranceEnd` server events |
| `smart_format` | `"true"` | Auto-punctuation, number formatting |
| `punctuate` | `"true"` | Sentence-level punctuation |
| `encoding` | `"linear16"` | Raw PCM (use with AudioWorklet); omit if sending browser-default webm/opus from MediaRecorder |
| `sample_rate` | `"16000"` | Required when `encoding` is specified |
| `channels` | `"1"` | Mono mic |

### End-of-Utterance Event Flow

Three overlapping signals work together — use them in combination for reliable hands-free detection:

1. **`is_final: true`** (in a `Results` message) — Deepgram has committed this transcript segment; no more revisions. Fires frequently (roughly every chunk boundary). Does NOT mean the user has finished speaking.

2. **`speech_final: true`** (also in `Results`) — The endpointing algorithm detected a silence gap of ≥ `endpointing` ms after speech. The user has likely paused/finished. **This is the primary trigger for submitting to the chat agent.** It can fire on the same message as `is_final: true` or separately.

3. **`UtteranceEnd`** event (type `"UtteranceEnd"`) — A separate JSON message (not a `Results` message) fired when `utterance_end_ms` ms have elapsed with no new words. Acts as a backstop/failsafe — use it to catch the case where `speech_final` didn't fire (e.g., the user ended on a soft sound the endpointer missed).

**Recommended end-of-turn logic:**
```typescript
connection.on("message", (data) => {
  if (data.type === "Results") {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && data.is_final) {
      accumulatedTranscript += transcript + " ";
    }
    if (data.speech_final) {
      submitToAgent(accumulatedTranscript.trim());
      accumulatedTranscript = "";
    }
  } else if (data.type === "UtteranceEnd") {
    // Backstop: submit if we have accumulated text but speech_final never fired
    if (accumulatedTranscript.trim()) {
      submitToAgent(accumulatedTranscript.trim());
      accumulatedTranscript = "";
    }
  } else if (data.type === "SpeechStarted") {
    // User started speaking — use for barge-in (see §4)
    onSpeechStarted();
  }
});
```

### v5 SDK Connection Pattern

```typescript
const connection = await deepgram.listen.v1.connect({
  model: "nova-3",
  language: "en",
  interim_results: "true",
  endpointing: "300",
  utterance_end_ms: "1000",
  vad_events: "true",
  smart_format: "true",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
});

connection.on("open", () => console.log("STT connected"));
connection.on("message", (data) => { /* handle events above */ });
connection.on("error", (err) => console.error(err));
connection.on("close", () => console.log("STT closed"));

connection.connect();
await connection.waitForOpen();

// Send audio:
connection.sendMedia(audioChunkArrayBuffer);

// Graceful close:
connection.sendFinalize({ type: "Finalize" });
```

### Browser Mic Audio: MediaRecorder vs AudioWorklet

**Option A — MediaRecorder (simpler, recommended for most cases):**

```typescript
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

mediaRecorder.addEventListener("dataavailable", (event) => {
  if (event.data.size > 0 && connection.readyState === WebSocket.OPEN) {
    connection.sendMedia(event.data); // sends the Blob/ArrayBuffer
  }
});

mediaRecorder.start(250); // 250ms chunks
```

- Sends webm/opus container by default in most browsers. Deepgram auto-detects this format — **do not set `encoding` or `sample_rate` params** when using MediaRecorder's default output.
- Simpler but ~250ms latency per chunk, and the first chunk may contain codec header data (Deepgram handles this gracefully).

**Option B — AudioWorklet / Raw PCM (lower latency, more control):**

```typescript
// In AudioWorkletProcessor:
process(inputs) {
  const channelData = inputs[0][0]; // Float32Array
  const pcm16 = float32ToPCM16(channelData); // convert to Int16Array
  this.port.postMessage(pcm16.buffer);
}

// In the main thread:
workletNode.port.onmessage = (e) => {
  connection.sendMedia(e.data); // raw linear16 PCM
};
```

- Requires `encoding: "linear16"`, `sample_rate: "16000"` (or `"48000"` matching `AudioContext.sampleRate`), `channels: "1"`.
- ~10–40ms latency. More complex, but gives true real-time streaming without MediaRecorder's chunk delay.
- **Recommendation for this app:** Start with MediaRecorder for simplicity. Switch to AudioWorklet if latency is perceptibly worse than the old Silero VAD stack.

---

## 3. Security: Keeping the API Key Off the Client

**Never expose `DEEPGRAM_API_KEY` to the browser.** The approaches, best to least secure:

### Recommended: Short-Lived Token via `/v1/auth/grant`

Deepgram provides a token endpoint that issues JWTs with a 30-second TTL (configurable up to 3600s):

```bash
POST https://api.deepgram.com/v1/auth/grant
Authorization: Token YOUR_DEEPGRAM_API_KEY

# Body (optional):
{ "ttl_seconds": 30 }
```

**Response:**
```json
{ "access_token": "eyJ...", "expires_in": 30 }
```

The token is valid for the initial WebSocket handshake; the connection stays open after the token expires. Tokens inherit the permissions of the generating key (`usage::write`), so scope to a read-only or usage-only key in your Deepgram project if you want extra protection. Tokens work with `/listen`, `/speak`, `/agent` endpoints but not Management APIs.

**Implementation in our Next.js app:**

```typescript
// app/api/deepgram/token/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  // Optionally verify the user is authenticated (Payload session) here
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  const { access_token } = await res.json();
  return NextResponse.json({ token: access_token });
}
```

**Client usage:**
```typescript
// In the React component, before opening the WS:
const { token } = await fetch("/api/deepgram/token", { method: "POST" }).then(r => r.json());
const deepgram = new DeepgramClient({ accessToken: token });
const connection = await deepgram.listen.v1.connect({ ... });
```

The client fetches a fresh token each time it needs to open a new STT or TTS WebSocket session. The 30s TTL means a leaked token is useless almost immediately.

### Alternative: Full Server-Side WebSocket Proxy

Open the Deepgram WS on the server (Route Handler or a dedicated WebSocket server), then proxy mic audio from the browser via a separate WS tunnel to the server. More complex, handles all auth entirely server-side. Overkill for a self-hosted app where the only "attackers" are your own users — the token approach is sufficient.

**Recommendation for this open-source self-hosted project:** Use the **short-lived token** approach. It's the pattern Deepgram officially documents, is simple to implement, keeps the master API key strictly server-side, and is appropriate for single-tenant or small-team deployments.

---

## 4. TTS (Aura)

### REST API (simple, good for short responses)

```
POST https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000
Authorization: Token YOUR_API_KEY
Content-Type: application/json

{ "text": "Hello, how can I help you today?" }
```

- Returns a binary audio stream immediately; you can pipe it to `Response` and stream it to the browser.
- Default sample rate: 24000 Hz. Default encoding: `linear16`. MP3 available with `container=mp3`.
- Playback can start on first byte received — no need to wait for the entire file.

### WebSocket TTS API (recommended for streaming agent replies)

```
wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000
```

**Client messages:**
- `{ "type": "Text", "text": "sentence chunk..." }` — send text to synthesize
- `{ "type": "Flush" }` — forces synthesis of all buffered text and emits `Flushed` event when done
- `{ "type": "Clear" }` — discard buffered text (use for barge-in)
- `{ "type": "Close" }` — graceful shutdown

**Server messages:**
- `SpeakV1Audio` — binary audio chunk (base64 encoded in the JS SDK)
- `SpeakV1Metadata` — metadata about the generation
- `SpeakV1Flushed` — all audio for flushed text has been sent
- `SpeakV1Cleared` — buffer cleared acknowledgment
- `SpeakV1Warning` — warning from the service

**SDK connection:**
```typescript
const dgSpeak = await deepgram.speak.v1.connect({
  model: "aura-2-thalia-en",
  encoding: "linear16",
  sample_rate: 24000,
});

dgSpeak.on("open", () => {
  // Send text as agent streams it in:
  dgSpeak.sendText({ type: "Text", text: agentSentence });
  dgSpeak.sendText({ type: "Flush" }); // trigger synthesis immediately
});

dgSpeak.on("message", (data) => {
  if (typeof data === "string") {
    // Audio chunk — data is base64 linear16 PCM
    const pcmBuffer = Buffer.from(data, "base64");
    // queue to AudioContext for playback
  } else if (data.type === "Flushed") {
    // All audio for this flush is done
  }
});
```

### Browser Playback with AudioContext

```typescript
const audioCtx = new AudioContext({ sampleRate: 24000 });
const pcmQueue: Int16Array[] = [];
let isPlaying = false;

function enqueuePcmChunk(base64Data: string) {
  const raw = atob(base64Data);
  const buf = new Int16Array(raw.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (raw.charCodeAt(i * 2)) | (raw.charCodeAt(i * 2 + 1) << 8);
  }
  pcmQueue.push(buf);
  if (!isPlaying) playNext();
}

function playNext() {
  if (pcmQueue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const chunk = pcmQueue.shift()!;
  const audioBuffer = audioCtx.createBuffer(1, chunk.length, 24000);
  const channelData = audioBuffer.getChannelData(0);
  for (let i = 0; i < chunk.length; i++) channelData[i] = chunk[i] / 32768;
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  source.onended = playNext;
  source.start();
  currentTtsSource = source; // keep ref for barge-in stop
}
```

For MP3 output (simpler decode, more compression): use `container=mp3` and decode with `audioCtx.decodeAudioData()`. For lowest-latency onset, prefer `linear16` with the queue approach above.

### Sentence-by-Sentence Streaming for Agent Replies

As the chat agent streams its reply (e.g., from a streaming LLM), split on sentence boundaries and send each sentence + a `Flush` to the TTS WebSocket. The `Flushed` event signals when that sentence's audio is fully emitted — use it to sequence playback or track progress.

```typescript
// Stream agent reply, split on ". " or similar
for await (const sentence of agentSentenceStream()) {
  dgSpeak.sendText({ type: "Text", text: sentence });
  dgSpeak.sendText({ type: "Flush" });
  // Audio starts arriving immediately for each sentence
}
```

### TTS Audio Formats Summary

| Format | `encoding` param | `container` param | Notes |
|---|---|---|---|
| Raw PCM linear16 | `linear16` | (none) | Default; lowest latency; direct AudioContext playback |
| WAV | `linear16` | `wav` | Add WAV header; easier to play via `<audio>` element |
| MP3 | (default/omit) | `mp3` | Compressed; use `decodeAudioData` in browser |
| mulaw | `mulaw` | (none) | Telephony; not needed here |

Default sample rate: **24000 Hz**. Can be set to `48000` for higher quality.

### Available Aura Voices (selection)

**Aura-2 English (42 voices — recommended):**
- `aura-2-thalia-en` (featured)
- `aura-2-andromeda-en`, `aura-2-helena-en`, `aura-2-apollo-en`
- `aura-2-arcas-en`, `aura-2-zeus-en`, `aura-2-aries-en`
- Full accent range: American, British, Australian, Irish, Filipino

**Aura-2 Spanish (17 voices):** `aura-2-celeste-es`, `aura-2-estrella-es` — some voices switch seamlessly between English and Spanish.

**Other languages:** Dutch (9), French (2), German (7), Italian (10), Japanese (5).

**Aura-1 English (legacy, 12 voices):** `aura-asteria-en` (default if no model specified), `aura-luna-en`, `aura-stella-en`, etc. Priced at $0.015/1k chars vs Aura-2's $0.030/1k chars.

**Suggestion for Eve:** `aura-2-thalia-en` or `aura-2-andromeda-en` — natural-sounding, neutral American accent.

---

## 5. Barge-In

Barge-in means: detect that the user has started speaking while TTS audio is playing, then immediately stop audio playback and start processing the new speech.

The same live STT WebSocket (which should stay open the entire session) will emit a **`SpeechStarted`** event (type `"SpeechStarted"`) when the VAD detects the user speaking — even while TTS audio plays (assuming the mic is not muted during TTS playback).

**Barge-in implementation:**

```typescript
connection.on("message", (data) => {
  if (data.type === "SpeechStarted") {
    if (isTtsPlaying) {
      // 1. Stop current AudioContext source
      currentTtsSource?.stop();
      pcmQueue.length = 0;
      isTtsPlaying = false;

      // 2. Clear Deepgram TTS buffer so it stops generating
      dgSpeak.sendText({ type: "Clear" });

      // 3. Optionally abort the LLM streaming call
      agentAbortController?.abort();
    }
  }
});
```

**Echo/feedback concern:** When TTS plays through speakers (not headphones), the mic will pick up the TTS audio and trigger `SpeechStarted` spuriously. Mitigations:
1. Mute/disconnect the STT connection during TTS playback and rely on a button/hotword for barge-in (simplest).
2. Use acoustic echo cancellation: set `echoCancellation: true` in `getUserMedia` constraints — the browser's AEC should suppress the TTS signal from the mic. This works well for headphone and most speaker setups.
3. Keep the STT open but add a debounce: only treat `SpeechStarted` as real barge-in if speech continues for >200ms (prevents spurious triggers from TTS audio).

**Recommended approach:** Enable `echoCancellation: true` in `getUserMedia` and keep the STT WebSocket open throughout, relying on `SpeechStarted` for barge-in.

---

## 6. Pricing and Free Credit

| Item | Pay-as-you-go rate |
|---|---|
| **Free credit for new users** | **$200** (no card required, no expiry, no minimum) |
| Nova-3 STT (streaming, monolingual) | **$0.0048/min** |
| Nova-3 STT (streaming, multilingual) | **$0.0058/min** |
| Nova-3 STT (pre-recorded) | $0.0077/hr |
| Aura-2 TTS | **$0.030 per 1,000 characters** |
| Aura-1 TTS | $0.015 per 1,000 characters |

**Cost estimate for typical use:** A 5-minute conversation with ~500 words of user speech and ~1,000 characters of TTS output costs roughly $0.024 (STT) + $0.030 (TTS) = **~$0.054 total**. The $200 free credit covers ~3,700 such conversations.

**README note:** "Deepgram gives new accounts $200 of free credit — enough to get started without entering a credit card."

---

## 7. Recommended Architecture for payload-eve-chat

### Guiding Principles

- `DEEPGRAM_API_KEY` stays on the server at all times.
- The browser opens Deepgram WebSockets directly (for low latency), but authenticates with a short-lived token fetched from our server.
- STT and TTS WebSockets are opened client-side; the chat agent call (LLM) happens server-side.
- The live STT WS stays open for the entire session (not per-utterance).

### Architecture Diagram

```
Browser                                    Next.js Server              Deepgram Cloud
──────────────────────────────────────────────────────────────────────────────────────
Mic → AudioWorklet / MediaRecorder
         │
         │ (1) fetch /api/deepgram/token ──────────────────────────────▶ /v1/auth/grant
         │          (POST, verifies Payload session)                           │
         │ ◀────────────────── { access_token, expires_in: 30 } ──────────────┘
         │
         │ (2) Open WSS directly to Deepgram STT  ─────────────────────▶ wss://api.deepgram.com/v1/listen
         │     using accessToken from step 1
         │ ──── audio chunks ──────────────────────────────────────────▶
         │ ◀─── Results / SpeechStarted / UtteranceEnd ────────────────
         │
         │ (3) On speech_final / UtteranceEnd:
         │     POST /api/chat  ───────────────────────────────────────▶ LLM / Eve agent
         │     (streaming SSE/ReadableStream)                                  │
         │ ◀────────────── streamed agent reply chunks ────────────────────────┘
         │
         │ (4) As agent text streams in: split into sentences
         │     fetch /api/deepgram/token again (if needed)
         │     Open WSS directly to Deepgram TTS ────────────────────▶ wss://api.deepgram.com/v1/speak
         │ ──── { type: "Text", text: sentence } ─────────────────────▶
         │ ──── { type: "Flush" } ─────────────────────────────────────▶
         │ ◀─── binary audio chunks (linear16 PCM) ────────────────────
         │     → enqueue to AudioContext → play
         │
         │ (5) On SpeechStarted while TTS playing:
         │     stop AudioContext source
         │     send { type: "Clear" } to TTS WS
         │     abort agent streaming call
         │     → accumulate new transcript → repeat from step 3
```

### Minimal Endpoints Needed

| Endpoint | Method | Purpose |
|---|---|---|
| `app/api/deepgram/token/route.ts` | POST | Issue 30s JWT to authenticated clients |
| `app/api/chat/route.ts` | POST | Existing chat endpoint — receives final transcript, streams LLM reply |

### Minimal Client Components

| Component | Responsibility |
|---|---|
| `useDeepgramSTT` hook | Manages mic, AudioWorklet/MediaRecorder, STT WebSocket, transcript accumulation, end-of-turn detection |
| `useDeepgramTTS` hook | Manages TTS WebSocket, sentence queuing, AudioContext playback, Flush/Clear |
| `useVoiceLoop` hook | Orchestrates the full loop: STT → agent call → TTS → barge-in |
| `VoiceButton` component | UI: mic on/off, mute, status indicator |

### Next.js Config Addition

```typescript
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["@deepgram/sdk"],
  // ... existing config
};
```

The SDK should only be imported in Route Handlers. For the browser-side STT/TTS WebSocket connections, either:
- (a) Import `DeepgramClient` from `@deepgram/sdk` in a client component (it works in browsers; Next.js will only bundle the browser-compatible parts if imported in a `"use client"` file), OR
- (b) Construct the WebSocket URL manually (`wss://api.deepgram.com/v1/listen?model=nova-3&...`) and use the native WebSocket API with `Sec-WebSocket-Protocol: ["token", JWT]` — no SDK dependency on the client at all, keeps the client bundle smaller.

**Option (b) is recommended** for production: smaller bundle, no Node.js polyfills, full control. Use the SDK only in server-side Route Handlers.

### Summary of What Runs Where

| Piece | Runs on |
|---|---|
| Token generation (`/v1/auth/grant`) | Server (Route Handler) |
| Mic capture + audio encoding | Browser |
| STT WebSocket to `wss://api.deepgram.com/v1/listen` | Browser (using short-lived token) |
| End-of-turn detection (speech_final / UtteranceEnd) | Browser |
| Chat agent / LLM call | Server (Route Handler, streaming) |
| TTS WebSocket to `wss://api.deepgram.com/v1/speak` | Browser (using short-lived token) |
| AudioContext playback + barge-in | Browser |

---

## Appendix: Quick Reference Cheatsheet

```typescript
// STT params for hands-free loop
{
  model: "nova-3",
  language: "en",
  interim_results: "true",
  endpointing: "300",       // 300ms silence → speech_final
  utterance_end_ms: "1000", // 1s no-new-words → UtteranceEnd
  vad_events: "true",       // enables SpeechStarted + UtteranceEnd events
  smart_format: "true",
  encoding: "linear16",     // omit if using MediaRecorder
  sample_rate: "16000",     // omit if using MediaRecorder
  channels: "1",
}

// TTS params
{
  model: "aura-2-thalia-en", // or any aura-2-*-en voice
  encoding: "linear16",
  sample_rate: 24000,
}

// Token endpoint
POST https://api.deepgram.com/v1/auth/grant
Authorization: Token {DEEPGRAM_API_KEY}
Body: { ttl_seconds: 30 }
→ Response: { access_token: "eyJ...", expires_in: 30 }

// STT WS auth (browser native WebSocket)
new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3&...", ["token", JWT]);

// TTS WS auth (browser native WebSocket)
new WebSocket("wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000", ["bearer", JWT]);
```

---

*Sources: [Deepgram JS SDK (Context7)](https://github.com/deepgram/deepgram-js-sdk), [Deepgram API Reference](https://developers.deepgram.com), [Deepgram Pricing](https://deepgram.com/pricing), [Token Auth Guide](https://developers.deepgram.com/guides/fundamentals/token-based-authentication), [TTS Models](https://developers.deepgram.com/docs/tts-models), npm registry.*

---

## CORRECTION (from live use, 2026-06-21): grant tokens are ASR-only → TTS needs a server proxy

The §3 recommendation (browser opens BOTH STT and TTS WS with a short-lived `/v1/auth/grant`
token) is **wrong for TTS**. Verified against a live account:

- `/v1/auth/grant` issues tokens scoped **`["asr:write"]`** only (decoded the JWT). They authorize
  live STT (`/v1/listen`) but **Aura TTS (`/v1/speak`) rejects them** — the WS opens, returns a
  `Metadata` message, then closes with code **1008 (policy violation)** and zero audio. Tested both
  `aura-2-thalia-en` and `aura-asteria-en` — same result, so it's a scope issue, not a model issue.
- The **raw API key works for TTS**: `POST https://api.deepgram.com/v1/speak?model=…&encoding=
  linear16&sample_rate=24000` with `Authorization: Token <key>` → HTTP 200 + audio bytes.

**Implemented architecture (this repo):**
- STT: browser WS to `/v1/listen` with the grant token (`['bearer', token]`) — unchanged, works.
- TTS: **server proxy** `POST /api/deepgram/speak` (Payload-auth-gated) → Deepgram REST `/v1/speak`
  with the raw key → streams linear16 PCM back → browser decodes + plays via AudioContext. The key
  never reaches the browser.

**Also:** an API key whose SCOPE is restricted to ASR makes even the raw-key TTS fail — use a
Member key with default (full) scopes. Trim the key server-side (a trailing space → 400 "Invalid
credentials"). Don't depend on the model emitting `<speak>` tags — speak the reply prose directly.
