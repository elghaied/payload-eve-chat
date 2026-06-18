# Payload Blank Template

This template comes configured with the bare minimum to get started on anything you need.

## Quick start

This template can be deployed directly from our Cloud hosting and it will setup MongoDB and cloud S3 object storage for media.

## Quick Start - local setup

To spin up this template locally, follow these steps:

### Clone

After you click the `Deploy` button above, you'll want to have standalone copy of this repo on your machine. If you've already cloned this repo, skip to [Development](#development).

### Development

1. First [clone the repo](#clone) if you have not done so already
2. `cd my-project && cp .env.example .env` to copy the example environment variables. You'll need to add the `MONGODB_URL` from your Cloud project to your `.env` if you want to use S3 storage and the MongoDB database that was created for you.

3. `pnpm install && pnpm dev` to install dependencies and start the dev server
4. open `http://localhost:3000` to open the app in your browser

That's it! Changes made in `./src` will be reflected in your app. Follow the on-screen instructions to login and create your first admin user. Then check out [Production](#production) once you're ready to build and serve your app, and [Deployment](#deployment) when you're ready to go live.

#### Docker (Optional)

If you prefer to use Docker for local development instead of a local MongoDB instance, the provided docker-compose.yml file can be used.

To do so, follow these steps:

- Modify the `MONGODB_URL` in your `.env` file to `mongodb://127.0.0.1/<dbname>`
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
                  src/app/(payload)/api/eve/route.ts
                   - payload.auth() (admin-only)
                   - load/create Conversation
                   - streamText({ model, tools, system })
                   - persist UIMessage[] onFinish
                          │              │
              provider.ts ▼              ▼ mcp-client.ts
        (anthropic | openai)      createMCPClient(HTTP)
                                          │
                                          ▼
                            POST /api/mcp  (@payloadcms/plugin-mcp)
                                          │
                                          ▼
                       Payload Local API → Posts / Tasks
```

The agent lives at `/admin/eve`, a custom Payload admin view. The UI is built with Vercel AI Elements and `useChat`, which streams to `POST /api/eve`. The route handler authenticates the admin user via `payload.auth()`, opens an HTTP MCP client pointed at Payload's own `/api/mcp` endpoint (served by `@payloadcms/plugin-mcp`), passes the MCP tools to `streamText`, streams the response back to the browser, and persists the conversation to a `Conversations` collection.

The agent manages two demo collections — `Posts` and `Tasks` — exposed over MCP with find, create, and update operations (no delete).

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

Set `AI_PROVIDER` to `anthropic` (default) or `openai`, then supply the matching API key. The default models are `claude-sonnet-4-6` and `gpt-4o` respectively; override with `ANTHROPIC_MODEL` or `OPENAI_MODEL`.

### MCP authentication: dev vs. production

In **development**, the `/api/mcp` endpoint requires no API key. The `MCP_API_KEY` variable can be left blank.

In **production**, the MCP endpoint is protected. You need to create a Bearer API key in the `payload-mcp-api-keys` collection (managed inside the Payload admin), then set that key as `MCP_API_KEY` in your production environment.

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
