# Payload + Eve Chat Agent

A working example of an AI chat agent built inside Payload CMS. The agent ("Eve") lives at `/admin/eve`, reads and writes Payload collections over MCP, and is built on the **Vercel Eve framework** (`vercel/eve`) with a direct **Groq** model backend.

See the [AI Chat Agent (Eve)](#ai-chat-agent-eve) section below for architecture details and environment setup.

![Eve chat with the Claude.ai-style post preview panel](images/eve-chat-post-preview.png)

## Requirements

This project targets **Payload v4** (currently pinned to the `canary` release) and requires **Node 24.15+** and **TypeScript 6+**. The previous Payload `3.85.1` version is preserved on the **`v3`** branch — check it out if you need the stable v3 release.

## Quick Start - local setup

To spin up this project locally, follow these steps:

### Clone

Clone this repo and `cd` into it.

### Development

1. First [clone the repo](#clone) if you have not done so already
2. `cd my-project && cp .env.example .env.local` — fill in `DATABASE_URL`, `PAYLOAD_SECRET`, and `GROQ_API_KEY` (see [Environment setup](#environment-setup)). Use `.env.local` (gitignored) for secrets; `.env.example` is a safe-to-commit template.

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

> Payload exposes its collections over MCP, and an in-admin chat agent built on the **Vercel Eve framework** reads and writes Posts and Tasks entirely through those MCP tools. The model backend is Groq (`llama-3.3-70b-versatile` by default).

### Architecture

![Eve architecture — in-admin AI agent for Payload](images/eve-payload-architecture-hires.png)

The agent is a filesystem project under `agent/`:

```
agent/
  agent.ts                   # Eve agent definition (instructions, connections, channels)
  instructions.md            # system prompt
  connections/
    payload-mcp.ts           # Eve MCP connection → /api/mcp (Posts + Tasks)
  channels/
    eve.ts                   # HTTP channel; authenticates via Payload admin cookie
```

`withEve` in `next.config.ts` mounts Eve's HTTP channel at `/eve/v1/*`. The admin chat page at `/admin/eve` uses Eve's `useEveAgent` hook to send messages and stream replies through that channel. The channel authenticates via `authenticateAdmin` (Payload admin cookie) — Eve is **admin-only**.

Eve calls tools on the **Payload MCP server** (`@payloadcms/plugin-mcp`, endpoint `/api/mcp`) through the `payload-mcp` connection, which is wired in `agent/connections/payload-mcp.ts`. This is how it reads and writes **Posts** and **Tasks**. The MCP config explicitly locks down `Users`, `Media`, and `Conversations` so only `Posts` and `Tasks` are reachable over MCP.

Sessions are durable — the Eve framework tracks conversation history; no separate `Conversations` collection is needed.

### Environment setup

Copy `.env.example` to `.env.local` (gitignored) and fill in:

```
# --- Eve agent (Vercel Eve framework) ---
EVE_MODEL=llama-3.3-70b-versatile     # Groq model id (tool-calling capable)
GROQ_API_KEY=your-groq-key-here
MCP_SERVER_URL=http://localhost:3000/api/mcp
MCP_API_KEY=                          # optional in dev; required in production
```

Get a free Groq API key at <https://console.groq.com>. `EVE_MODEL` can be any Groq model that supports tool calling (e.g. `llama-3.3-70b-versatile`, `moonshotai/kimi-k2-instruct`).

**Switching to a different AI SDK provider** (OpenAI, Anthropic, etc.) is possible by updating the provider in `agent/agent.ts` — the Eve framework accepts any Vercel AI SDK-compatible provider.

### MCP authentication: dev vs. production

In **development**, the `/api/mcp` endpoint requires no API key — the config registers a development-only `overrideAuth` that bypasses key checks and runs as the first admin user. `MCP_API_KEY` can be left blank.

In **production**, the MCP endpoint is protected by a Bearer API key. In Payload v4, MCP API keys are managed from the user menu under **Settings → Manage API keys**. Create a key there, then set it as `MCP_API_KEY` in your production environment.

### Deployment (local-first for now)

The app runs locally with `pnpm devsafe` + MongoDB (see [Docker](#docker) below for the `docker compose up -d mongo` command). **Cloud deployment is deferred** — the full production story (Vercel AI Gateway for model routing, Vercel Sandbox for code-exec tools) requires Vercel billing. When deployed, the model stays Groq (or any direct provider); only hosting moves.

### Features deferred to the `ai-sdk` branch

The following features exist on the **`ai-sdk` branch** (the previous Vercel AI SDK implementation) and have not yet been ported to the Eve framework:

- **Post preview / approve before create** — editable side panel before Eve saves a post
- **Web search + read-URL** — self-hosted SearXNG integration (`webSearch`, `readUrl` tools)
- **Voice (hands-free STT + TTS)** — Silero VAD, speaches, kokoro-fastapi
- **Provider switching** — `AI_PROVIDER` env var to swap between Claude, GPT, and Ollama

Check out the `ai-sdk` branch to use those features. The Eve-framework port of each is pending.

## Questions

For questions about Payload itself, reach out on the [Payload Discord](https://discord.com/invite/payload). For anything specific to this template — bugs, feature ideas, or setup help — please [open an issue](https://github.com/elghaied/payload-eve-chat/issues) on this repo.
