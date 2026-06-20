import { defineAgent } from "eve";
import { createGroq } from "@ai-sdk/groq";

// Direct Groq provider (bypasses Vercel AI Gateway → no Vercel billing/card).
// Reads GROQ_API_KEY from the environment (.env.local). Model is overridable
// via EVE_MODEL; default is a tool-calling-capable Groq model since the agent
// drives Posts/Tasks through MCP tool calls.
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

export default defineAgent({
  model: groq(process.env.EVE_MODEL || "llama-3.3-70b-versatile"),
});
