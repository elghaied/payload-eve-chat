import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.EVE_MODEL || "anthropic/claude-sonnet-4.6",
});
