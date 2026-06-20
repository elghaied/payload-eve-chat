import { defineAgent } from "eve";

// Model via the Vercel AI Gateway. The default is a model whose provider supports Eve's
// *native* built-in tools (web_search, etc.) so this template showcases Eve working the way
// it's meant to, out of the box — no custom workarounds.
//
// Why Claude Haiku 4.5: it has first-class tool calling (this template drives Posts/Tasks
// entirely through MCP tool calls, so a weak tool-caller breaks the core demo) AND native
// web search via the gateway. Cheaper native alternatives you can drop into EVE_MODEL:
//   - google/gemini-2.5-flash   (native grounding/search; ~$0.30/$2.50 per 1M)
//   - openai/gpt-4o-mini        (native web search;        ~$0.15/$0.60 per 1M)
// Note: provider web search bills a per-search fee on top of tokens.
//
// Billing: without BYOK, the gateway relays to the provider using Vercel's own integration
// and bills your Vercel AI Gateway credits. `groq`/`cerebras`-served models (e.g.
// openai/gpt-oss-120b) are cheaper but DON'T support provider-native tools like web_search —
// if you switch to one, set EVE_PROVIDER to pin the serving provider (see below).
const providerPin = process.env.EVE_PROVIDER
  ? { providerOptions: { gateway: { only: [process.env.EVE_PROVIDER] } } }
  : undefined;

export default defineAgent({
  model: process.env.EVE_MODEL || "anthropic/claude-haiku-4.5",
  // Only needed when the model's creator isn't its serving provider (e.g. gpt-oss is served
  // by groq/cerebras). Native models like Claude/GPT/Gemini don't need a pin.
  ...(providerPin ? { modelOptions: providerPin } : {}),
});
