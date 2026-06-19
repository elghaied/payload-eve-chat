import { tool } from 'ai'
import { z } from 'zod'
import type { EveConfig } from './config'
import { readUrl } from './read-url'
import { webSearch } from './web-search'

/** The web tools, bound to the request's config. Only call when config.searxngUrl is set. */
export function createWebTools(config: EveConfig) {
  return {
    webSearch: tool({
      description:
        'Search the web for current events, external facts, or to find sources. Returns the ' +
        'top results (title, url, snippet). Cite the URLs you actually use.',
      inputSchema: z.object({
        query: z.string().describe('The search query'),
        maxResults: z.number().int().min(1).max(10).optional().describe('How many results (default 5)'),
      }),
      execute: async ({ query, maxResults }) => {
        try {
          return { results: await webSearch({ query, maxResults, config }) }
        } catch (err) {
          console.error('[eve] webSearch failed:', err)
          return { error: 'Web search failed.' }
        }
      },
    }),
    readUrl: tool({
      description:
        'Fetch a web page and return its main readable text, for summarizing or quoting. ' +
        'Use this on a link the user shares or on a search result. Cite the URL.',
      inputSchema: z.object({ url: z.string().describe('The page URL (http or https)') }),
      execute: async ({ url }) => {
        try {
          return await readUrl({ url })
        } catch (err) {
          console.error('[eve] readUrl failed:', err)
          return { error: "That URL can't be fetched." }
        }
      },
    }),
  }
}
