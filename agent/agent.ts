import { defineAgent } from "eve";
import { createGroq } from "@ai-sdk/groq";

// Direct Groq provider (bypasses Vercel AI Gateway → no Vercel billing/card).
// Reads GROQ_API_KEY from the environment (.env.local). Model is overridable
// via EVE_MODEL; default is a tool-calling-capable Groq model since the agent
// drives Posts/Tasks through MCP tool calls.
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// Direct-provider models aren't in Eve's AI Gateway metadata registry, so Eve can't
// auto-derive the context window for its compaction feature — declare it explicitly.
const CONTEXT_WINDOW_TOKENS = Number(process.env.EVE_CONTEXT_WINDOW_TOKENS) || 131072;

export default defineAgent({
  // gpt-oss-120b does native Groq tool calling correctly; llama-3.3-70b emits malformed
  // tool calls (jams JSON args into the tool name) and fails. Override via EVE_MODEL.
  model: groq(process.env.EVE_MODEL || "openai/gpt-oss-120b"),
  modelContextWindowTokens: CONTEXT_WINDOW_TOKENS,
});
