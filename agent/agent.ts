import { defineAgent } from "eve";

// Vercel AI Gateway: `model` is a gateway model slug (provider/model). Requests route
// through the gateway, authenticated by VERCEL_OIDC_TOKEN locally (run `vercel env pull`)
// and by OIDC on Vercel — no provider key in code.
//
// Billing: by default the gateway uses Vercel AI Gateway credits (no markup). To bill a
// provider you already pay (e.g. use your own Groq/Anthropic credits), add that provider
// under AI Gateway → Bring Your Own Key (BYOK) in the Vercel dashboard. To pin requests to
// a specific provider, set modelOptions.providerOptions.gateway.only (e.g. ['groq']).
//
// EVE_MODEL overrides the slug. gpt-oss-120b does native tool calling correctly (the agent
// drives Posts/Tasks through MCP tool calls); avoid models weak at tool calls.
export default defineAgent({
  model: process.env.EVE_MODEL || "openai/gpt-oss-120b",
  // gpt-oss-120b's creator is "openai" but OpenAI doesn't *serve* it on the gateway;
  // it's served by groq/cerebras/fireworks/etc. Pin the serving provider to groq so the
  // gateway doesn't (incorrectly) filter to the openai provider. Override via EVE_PROVIDER.
  modelOptions: {
    providerOptions: {
      gateway: { only: [process.env.EVE_PROVIDER || "groq"] },
    },
  },
});

