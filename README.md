# Payload + Vercel AI SDK Chat Agent

A working example of an AI chat agent built inside Payload CMS. The agent ("Eve") lives at `/admin/eve`, reads and writes Payload collections over MCP, and streams responses back to the browser using the Vercel AI SDK. Swap between Claude, GPT, and local Ollama models with a single env-var change.

See the [AI Chat Agent (Eve)](#ai-chat-agent-eve) section below for architecture details and environment setup.

## Requirements

This project targets **Payload v4** (currently pinned to the `canary` release) and requires **Node 24.15+** and **TypeScript 6+**. The previous Payload `3.85.1` version is preserved on the **`v3`** branch — check it out if you need the stable v3 release.

## Quick Start - local setup

To spin up this project locally, follow these steps:

### Clone

Clone this repo and `cd` into it.

### Development

1. First [clone the repo](#clone) if you have not done so already
2. `cd my-project && cp .env.example .env` — fill in `DATABASE_URL`, `PAYLOAD_SECRET`, and the AI provider keys (see [Environment setup](#environment-setup)).

3. `pnpm install && pnpm dev` to install dependencies and start the dev server
4. Open `http://localhost:3000/admin` to log in and create your first admin user, then navigate to **AI Chat Agent (Eve)** in the sidebar (or go to `http://localhost:3000/admin/eve`) to start chatting.

That's it! Changes made in `./src` will be reflected in your app. Follow the on-screen instructions to login and create your first admin user. Then check out [Production](#production) once you're ready to build and serve your app, and [Deployment](#deployment) when you're ready to go live.

#### Docker (Optional)

If you prefer to use Docker for local development instead of a local MongoDB instance, the provided docker-compose.yml file can be used.

To do so, follow these steps:

- Modify the `DATABASE_URL` in your `.env` file to `mongodb://127.0.0.1/<dbname>`
- Modify the `docker-compose.yml` file's `MONGODB_URL` to match the above `<dbname>`
- Run `docker-compose up` to start the database, optionally pass `-d` to run in the background.

## How it works

The Payload config is tailored specifically to the needs of most websites. It is pre-configured in the following ways:

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- #### Users (Authentication)

  Users are auth-enabled collections that have access to the admin panel.

  For additional help, see the official [Auth Example](https://github.com/payloadcms/payload/tree/3.x/examples/auth) or the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.

- #### Media

  This is the uploads enabled collection. It features pre-configured sizes, focal point and manual resizing to help you manage your pictures.

### Docker

Alternatively, you can use [Docker](https://www.docker.com) to spin up this template locally. To do so, follow these steps:

1. Follow [steps 1 and 2 from above](#development), the docker-compose file will automatically use the `.env` file in your project root
1. Next run `docker-compose up`
1. Follow [steps 4 and 5 from above](#development) to login and create your first admin user

That's it! The Docker instance will help you get up and running quickly while also standardizing the development environment across your teams.

## AI Chat Agent (Eve)

> Payload exposes its collections over MCP, and an in-admin chat agent built on the Vercel AI SDK operates the CMS entirely through those MCP tools — provider-swappable between Claude and GPT.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser — Payload admin, custom view /admin/eve (React 19 + AI Elements)   │
│                                                                            │
│  VOICE (optional, hands-free):                                             │
│    mic ─► Silero VAD ─► WAV ─────────────────────► POST /api/eve/transcribe│
│    assistant stream ─► sentence splitter ────────► POST /api/eve/speak     │
│       ◄──── sequential audio playback + barge-in ◄───────┘                 │
│                                                                            │
│  CHAT:  EveView (server) ─► EveChat (useChat) ───► POST /api/eve           │
└───────────────┬────────────────────┬───────────────────────┬──────────────┘
                ▼                    ▼                       ▼
     /api/eve/route.ts     /api/eve/transcribe       /api/eve/speak
     payload.auth()        payload.auth()            payload.auth()   ← all admin-only
     load/create Convo          │                         │
     streamText(model,          └────► src/eve/audio.ts ◄──┘
       tools, system)                  (OpenAI /v1/audio/{transcriptions,speech})
     persist UIMessage[]                     │                  │
        │             │                      ▼                  ▼
 provider.ts ▼        ▼ mcp-client.ts   STT: speaches      TTS: kokoro-fastapi
 (anthropic |    POST /api/mcp           (:8000)            (:8880)
  openai |       (@payloadcms/plugin-mcp)
  ollama :11434)      ▼
                 Payload Local API → Posts / Tasks
```

The agent lives at `/admin/eve`, a custom Payload admin view. The UI is built with Vercel AI Elements and `useChat`, which streams to `POST /api/eve`. The route handler authenticates the admin user via `payload.auth()`, opens an HTTP MCP client pointed at Payload's own `/api/mcp` endpoint (served by `@payloadcms/plugin-mcp`), passes the MCP tools to `streamText`, streams the response back to the browser, and persists the conversation to a `Conversations` collection.

**Voice (optional):** when enabled, the browser captures speech with [Silero VAD](https://github.com/ricky0123/vad), encodes the utterance to WAV, and posts it to `POST /api/eve/transcribe`; the transcript is sent through the same `useChat` flow. As the reply streams, a sentence splitter feeds `POST /api/eve/speak` and plays the audio in a FIFO queue with barge-in. Both routes reuse the same `payload.auth()` gate and forward to STT (`speaches`) and TTS (`kokoro-fastapi`) through `src/eve/audio.ts`, which speaks the **OpenAI audio API** (`/v1/audio/transcriptions`, `/v1/audio/speech`) — so the engines are swappable by env, never exposed to the browser. STT and TTS are each optional (attached only when their base URL is set). See [Voice (hands-free STT + TTS)](#voice-hands-free-stt--tts--optional).

The agent manages two demo collections — `Posts` and `Tasks` — exposed over MCP with find, create, and update operations (no delete). In Payload v4 the MCP plugin exposes **every** collection by default (an opt-out model), so the config explicitly locks down `Users`, `Media`, and `Conversations` — only `Posts` and `Tasks` are reachable over MCP. See `src/payload.config.ts`.

### Environment setup

Copy `.env.example` to `.env` and fill in the required values:

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

### Switching providers

Set `AI_PROVIDER` to `anthropic` (default), `openai`, or `ollama`.

- **`anthropic`** / **`openai`** — supply the matching API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). Default models are `claude-sonnet-4-6` and `gpt-4o`; override with `ANTHROPIC_MODEL` / `OPENAI_MODEL`.
- **`ollama`** — run models locally, no API key needed. Set `OLLAMA_MODEL` (default `qwen2.5`) and optionally `OLLAMA_BASE_URL` (default `http://localhost:11434/api`).

#### Running locally with Ollama

The agent operates Posts and Tasks entirely through MCP **tool calls**, so you must use a model that supports tool calling — e.g. `qwen3:4b`, `qwen2.5`, `llama3.1`, or `mistral-nemo`. Small non-tool models won't work.

Ollama runs as a **Docker service** (GPU, port `11434`) that **auto-pulls `OLLAMA_MODEL` on
first start** — no host install needed. Models persist in `./models/ollama/` (see [Models](#models)):

```bash
docker compose --profile ollama up -d ollama   # or --profile full for the whole stack
```

Then set in `.env`:

```
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3:4b
```

(Prefer an Ollama already running on your host? Skip the service and leave `OLLAMA_BASE_URL`
pointing at `http://localhost:11434/api`.)

Note: local models are generally weaker at multi-step tool use than the hosted Claude/GPT models, so the agent may need clearer prompts and occasionally mis-call a tool.

### MCP authentication: dev vs. production

In **development**, the `/api/mcp` endpoint requires no API key — the config registers a development-only `overrideAuth` that bypasses key checks and runs as the first admin user. The `MCP_API_KEY` variable can be left blank.

In **production**, the MCP endpoint is protected by a Bearer API key. In Payload v4, MCP API keys are managed from the user menu under **Settings → Manage API keys** (they are no longer a standalone auth collection in the main nav). Create a key there, then set it as `MCP_API_KEY` in your production environment. Note: any MCP API key created before the v4 upgrade must be regenerated.

### Post preview (approve before create)

When you ask Eve to create a post, it doesn't write it immediately — it calls a
`proposePost` tool that opens an **editable side panel** (title, status, and the
Markdown body with an Edit/Preview toggle). Nothing is saved until you click
**Add it**, which tells Eve to create the post via the MCP `createDocumentFromMarkdown`
tool using your approved content; **Discard** writes nothing. Tasks are still created
directly. See `docs/superpowers/specs/2026-06-19-eve-post-preview-design.md`.

### Web search (optional, self-hosted SearXNG)

Eve can search the web and read pages when a **SearXNG** instance is attached. With it,
she can summarize a link you paste and research a topic to write an article (returned in
the chat; ask her to save it to run it through the post preview).

Run SearXNG and point Eve at it:

    docker compose --profile web up -d searxng      # or --profile full for the whole stack
    # in .env:
    SEARXNG_URL=http://localhost:8080

Two tools light up only when `SEARXNG_URL` is set: `webSearch` (SearXNG JSON) and `readUrl`
(fetch + Mozilla Readability extraction). `readUrl` is SSRF-guarded — http(s) only, and
loopback/private/link-local hosts are blocked. Sanity-check SearXNG's JSON API:

    curl "http://localhost:8080/search?q=test&format=json"

## Voice (hands-free STT + TTS) — optional

Eve supports an optional hands-free voice loop: speak your request (Silero VAD
detects when you stop), it is transcribed and sent to the chat, and Eve's reply
is spoken back sentence-by-sentence. Speaking while Eve talks (barge-in)
interrupts playback. **Voice is entirely opt-in — without it, Eve is a normal
text chat.**

STT and TTS are independent: each is "attached" only when its base-URL env var is
set. Set neither for chat-only; set one or both to enable that capability. With
nothing attached, the mic button still appears but clicking it just explains that
no speech service is connected.

### Running the services

The backend runs as Docker services (GPU): **STT** (`speaches`, `:8000`), **TTS**
(`kokoro-fastapi`, `:8880`), and the optional **Ollama** LLM (`:11434`). They're
grouped by compose profile so you bring up only what you need:

| Profile | Services |
|---|---|
| _(none)_ | `mongo` — always starts |
| `voice` | `stt` + `tts` |
| `ollama` | `ollama` |
| `full` | `ollama` + `stt` + `tts` (everything for local dev) |
| `app` | `payload` — the app in Docker (advanced; see below) |

The recommended setup runs the **app on your host** and the backend in Docker, so the
`localhost` URLs in `.env` resolve directly:

    docker compose --profile full up -d    # mongo + ollama + stt + tts
    pnpm dev                               # app on the host

A bare `docker compose up` starts only `mongo` — the app is behind the `app` profile
because the recommended workflow runs it on the host. To run the app in Docker too,
enable `--profile app` **and** switch the `.env` hostnames to the compose service names
(`mongo`, `ollama`, `stt`, `tts`), since in-container `localhost` no longer reaches your host.

#### Models

Models live in `./models/<service>/`, bind-mounted into the containers so they're
portable — **copy a folder to another machine and the app skips the download.**

- **STT** → `./models/stt/` (mounted at the speaches HF cache). `speaches` does **not**
  auto-download (unlike Ollama); calling it before the model is present returns a 404.
  Download `Systran/faster-whisper-small` once — it lands in `./models/stt/`:

      curl -X POST "http://localhost:8000/v1/models/Systran/faster-whisper-small"

  Source: <https://huggingface.co/Systran/faster-whisper-small>. To use a different
  model, set `STT_MODEL` in `.env`, pull that id the same way, and restart.
- **TTS** → nothing to download. The Kokoro model is **baked into the
  `kokoro-fastapi` image**, so there's no `./models/tts/` folder.
- **Ollama** → `./models/ollama/`. The `ollama` service **auto-pulls `OLLAMA_MODEL`**
  here on first start (runs as your user, so the files aren't root-owned).

Already have the models from another machine? Drop the folders into `./models/stt/`
and/or `./models/ollama/` before `docker compose --profile full up` — no download needed.

Sanity-check both services:

    curl -s localhost:8000/v1/models   # STT — should list Systran/faster-whisper-small
    curl -s localhost:8880/v1/models   # TTS

**GPU (default):** the compose services use the `*-cuda` / `*-gpu` images and need
an NVIDIA GPU exposed to Docker (nvidia-container-toolkit).

**No GPU?** Switch each service to its CPU image and remove its `deploy:` block in
`docker-compose.yml` (the alternatives are noted inline):

- STT → `ghcr.io/speaches-ai/speaches:latest-cpu`
- TTS → `ghcr.io/remsky/kokoro-fastapi-cpu:latest`

CPU works fine for small models; synthesis/transcription is just slower.

### Enabling voice

Set the base URL(s) in `.env` (see `.env.example`); the mic button's voice loop
then activates for whichever service is attached:

    STT_BASE_URL=http://localhost:8000/v1
    TTS_BASE_URL=http://localhost:8880/v1

The browser voice-activity-detection assets (the Silero ONNX model, audio
worklet, and ONNX Runtime WASM) are **self-hosted, not loaded from a CDN**:
`scripts/copy-vad-assets.mjs` vendors them from `node_modules` into
`public/vad/` on `postinstall` (and before `dev`/`build`). They're git-ignored
and regenerated to match the installed versions — run `pnpm vad:assets` to
refresh manually.

### Changing the TTS voice

Eve's spoken voice is the **`TTS_VOICE`** env var (default `af_sky`). Set it in
`.env` and restart the app (`docker compose restart payload`, or restart `pnpm dev`).

List the voices your Kokoro container provides:

    curl -s localhost:8880/v1/audio/voices

Kokoro ships ~67 voices, named `<lang+gender>_<name>` — e.g. `af_*` US female,
`am_*` US male, `bf_*`/`bm_*` UK female/male, plus Spanish (`ef_/em_`), French
(`ff_`), Hindi (`hf_/hm_`), Italian (`if_/im_`), Japanese (`jf_/jm_`), Portuguese
(`pf_/pm_`), and Chinese (`zf_/zm_`). Popular English picks: `af_heart`, `af_bella`,
`af_nicole`, `am_michael`, `bf_emma`, `bm_george`. The full voice list and samples
live in the Kokoro-FastAPI project and the model card:

- Voices & API: <https://github.com/remsky/Kokoro-FastAPI>
- Model card (voice samples): <https://huggingface.co/hexgrad/Kokoro-82M>

Audition one without restarting (writes an mp3 you can play):

    curl -s localhost:8880/v1/audio/speech \
      -H 'Content-Type: application/json' \
      -d '{"model":"kokoro","input":"Hi, I am Eve.","voice":"af_bella","response_format":"mp3"}' \
      --output sample.mp3

Kokoro also accepts weighted **blends**, e.g. `TTS_VOICE=af_sky+af_bella` or
`af_sarah(2)+af_nicole(1)`.

### Swapping models / providers (agnostic)

STT and TTS are reached only through the OpenAI audio API
(`/v1/audio/transcriptions`, `/v1/audio/speech`). To use a different engine or a
cloud provider, change the base URL + model (and set an API key) — no code change:

    # Example: OpenAI cloud
    STT_BASE_URL=https://api.openai.com/v1   STT_MODEL=whisper-1        STT_API_KEY=sk-...
    TTS_BASE_URL=https://api.openai.com/v1   TTS_MODEL=gpt-4o-mini-tts  TTS_VOICE=alloy  TTS_API_KEY=sk-...

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
