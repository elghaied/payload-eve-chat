import { defineTool } from 'eve/tools'
import { z } from 'zod'

// Override Eve's built-in web_search. We do NOT use the provider-native web_search:
//  - gpt-oss via Groq → "provider-defined tool not supported".
//  - Anthropic via the Vercel AI Gateway → the server-side search HANGS (turn never completes).
// Server-side provider tools aren't reliably proxied by the gateway. So we run search
// ourselves through the SAME gateway using a Perplexity Sonar model (live web + citations) —
// still fully Vercel-native (no new service/key) and, crucially, with a hard TIMEOUT so a slow
// search fails fast instead of hanging the turn. Override the model with WEB_SEARCH_MODEL.
//
// agent/ files are bundled in isolation: read process.env directly; never import from src/.

const GATEWAY_URL =
  process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, '') ?? 'https://ai-gateway.vercel.sh/v1'
const TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS || 25_000)

type SearchResult = { answer: string; sources: unknown[] } | { error: string }

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
          'VERCEL_OIDC_TOKEN) in the agent environment.',
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
        // Hard timeout so a slow/stuck search never hangs the agent turn.
        signal: AbortSignal.timeout(TIMEOUT_MS),
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
      const msg =
        err instanceof Error && err.name === 'TimeoutError'
          ? `Web search timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`
          : `Web search error: ${err instanceof Error ? err.message : String(err)}`
      return { error: msg }
    }
  },
})
