import type { EveConfig } from './config'

export type SearchResult = { title: string; url: string; snippet: string }

/** Query the self-hosted SearXNG JSON API and return the top results. */
export async function webSearch({
  query,
  maxResults = 5,
  config,
}: {
  query: string
  maxResults?: number
  config: EveConfig
}): Promise<SearchResult[]> {
  if (!config.searxngUrl) throw new Error('Web search is not configured (SEARXNG_URL unset).')
  const limit = Math.max(1, Math.min(10, maxResults))

  const url = new URL('/search', config.searxngUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('safesearch', '1')

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`SearXNG search failed (${res.status})`)

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }))
}
