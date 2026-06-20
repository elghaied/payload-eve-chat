import { defineTool } from 'eve/tools'
import { z } from 'zod'

// Override Eve's built-in `web_search`. The framework's provider-managed web_search is
// only available for models whose serving provider implements it — gpt-oss-120b via Groq
// does NOT ("provider-defined tool openai.web_search is not supported"), so the built-in is
// a no-op for our default model. This custom tool does a real search by calling the SAME
// Vercel AI Gateway we already use for the model, with a Perplexity Sonar model (live web +
// citations) — no new service or API key. Override `WEB_SEARCH_MODEL` to use a different
// search-capable gateway model. `web_fetch` remains the built-in for reading a known URL.
//
// agent/ files are bundled in isolation: read process.env directly; never import from src/.

const GATEWAY_URL =
  process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, '') ?? 'https://ai-gateway.vercel.sh/v1'

type SearchResult =
  | { answer: string; sources: unknown[] }
  | { error: string }

export default defineTool({
  description:
    'Search the web for current information and get a concise answer with source URLs. ' +
    'Use for recent events, facts that may have changed since training, or anything you are ' +
    'unsure of. To read a specific URL you already have, use web_fetch instead.',
  inputSchema: z.object({
    query: z.string().min(1).describe('The search query.'),
  }),
  async execute({ query }): Promise<SearchResult> {
    const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
    if (!key) {
      return {
        error:
          'Web search is unavailable: no AI Gateway credentials (AI_GATEWAY_API_KEY or ' +
          'VERCEL_OIDC_TOKEN) in the agent environment. Tell the user to configure the gateway.',
      }
    }
    const model = process.env.WEB_SEARCH_MODEL || 'perplexity/sonar'
    try {
      const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a web search engine. Answer the query concisely using current web ' +
                'information, and include the source URLs you used.',
            },
            { role: 'user', content: query },
          ],
        }),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        return {
          error:
            `Web search failed (${res.status}) using model "${model}". ` +
            `If the model is unavailable on this gateway, set WEB_SEARCH_MODEL. ${detail}`.trim(),
        }
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string; annotations?: unknown[] } }[]
        citations?: unknown[]
      }
      const answer = data.choices?.[0]?.message?.content ?? ''
      const sources = data.citations ?? data.choices?.[0]?.message?.annotations ?? []
      if (!answer) return { error: 'Web search returned no answer.' }
      return { answer, sources }
    } catch (err) {
      return { error: `Web search error: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
})
