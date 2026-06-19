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
┌────────────────────────────────────────────────────────────────┐
│ Payload Admin (Next.js / React 19)                              │
│                                                                 │
│  Custom view  /admin/eve                                        │
│   EveView (server) ──► EveChat (client, AI Elements + useChat)  │
│                              │ POST /api/eve                     │
└──────────────────────────────┼──────────────────────────────────┘
                               ▼
                       src/app/api/eve/route.ts
                   - payload.auth() (admin-only)
                   - load/create Conversation
                   - streamText({ model, tools, system })
                   - persist UIMessage[] onFinish
                          │              │
              provider.ts ▼              ▼ mcp-client.ts
   (anthropic|openai|ollama)      createMCPClient(HTTP)
                                          │
                                          ▼
                            POST /api/mcp  (@payloadcms/plugin-mcp)
                                          │
                                          ▼
                       Payload Local API → Posts / Tasks
```

The agent lives at `/admin/eve`, a custom Payload admin view. The UI is built with Vercel AI Elements and `useChat`, which streams to `POST /api/eve`. The route handler authenticates the admin user via `payload.auth()`, opens an HTTP MCP client pointed at Payload's own `/api/mcp` endpoint (served by `@payloadcms/plugin-mcp`), passes the MCP tools to `streamText`, streams the response back to the browser, and persists the conversation to a `Conversations` collection.

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

The agent operates Posts and Tasks entirely through MCP **tool calls**, so you must use a model that supports tool calling — e.g. `qwen2.5`, `llama3.1`, or `mistral-nemo`. Small non-tool models won't work.

```bash
ollama pull qwen2.5          # a tool-calling-capable model
ollama serve                 # ensure Ollama is running on :11434
```

Then set in `.env`:

```
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5
```

Note: local models are generally weaker at multi-step tool use than the hosted Claude/GPT models, so the agent may need clearer prompts and occasionally mis-call a tool.

### MCP authentication: dev vs. production

In **development**, the `/api/mcp` endpoint requires no API key — the config registers a development-only `overrideAuth` that bypasses key checks and runs as the first admin user. The `MCP_API_KEY` variable can be left blank.

In **production**, the MCP endpoint is protected by a Bearer API key. In Payload v4, MCP API keys are managed from the user menu under **Settings → Manage API keys** (they are no longer a standalone auth collection in the main nav). Create a key there, then set it as `MCP_API_KEY` in your production environment. Note: any MCP API key created before the v4 upgrade must be regenerated.

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

### Running the speech services

Two OpenAI-compatible Docker services back voice, behind a compose `voice`
profile so they only start when asked:

- **STT** — `ghcr.io/speaches-ai/speaches` (faster-whisper) on `:8000`
- **TTS** — `ghcr.io/remsky/kokoro-fastapi` (Kokoro) on `:8880`

The recommended setup runs the **app on your host** (`pnpm dev`) and uses Docker
only for the speech services, so the `localhost` URLs below resolve directly:

    # start only the speech services (and mongo, if you don't run it on the host)
    docker compose --profile voice up -d mongo stt tts
    pnpm dev

Name the services explicitly as shown — a bare `docker compose up` also starts the
`payload` container, which runs the app *inside* Docker where `localhost` no longer
points at your host (Ollama, Mongo, stt/tts). Use the in-container `payload` service
only if you switch the `.env` hostnames to the compose service names (`mongo`,
`stt`, `tts`) and point Ollama at `host.docker.internal`.

The first request is slow: `speaches` downloads its Whisper model and Kokoro loads
its weights into the `hf-cache` volume; both are cached afterward. Sanity-check:

    curl -s localhost:8000/v1/models   # STT
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

### Swapping models / providers (agnostic)

STT and TTS are reached only through the OpenAI audio API
(`/v1/audio/transcriptions`, `/v1/audio/speech`). To use a different engine or a
cloud provider, change the base URL + model (and set an API key) — no code change:

    # Example: OpenAI cloud
    STT_BASE_URL=https://api.openai.com/v1   STT_MODEL=whisper-1        STT_API_KEY=sk-...
    TTS_BASE_URL=https://api.openai.com/v1   TTS_MODEL=gpt-4o-mini-tts  TTS_VOICE=alloy  TTS_API_KEY=sk-...

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
