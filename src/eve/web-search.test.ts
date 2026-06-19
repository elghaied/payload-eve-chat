import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webSearch } from './web-search'
import type { EveConfig } from './config'

const config = { searxngUrl: 'http://searxng:8080' } as EveConfig

afterEach(() => vi.unstubAllGlobals())

describe('webSearch', () => {
  it('queries SearXNG JSON and maps results', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ results: [{ title: 'T', url: 'https://e.com', content: 'snip' }] }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await webSearch({ query: 'cats', config })
    expect(out).toEqual([{ title: 'T', url: 'https://e.com', snippet: 'snip' }])
    const url = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('q')).toBe('cats')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('clamps maxResults to at most 10', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://e/${i}`, content: '' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: many }), { status: 200 })))
    expect((await webSearch({ query: 'x', maxResults: 50, config })).length).toBe(10)
  })

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))
    await expect(webSearch({ query: 'x', config })).rejects.toThrow()
  })

  it('throws when SEARXNG_URL is unset', async () => {
    await expect(webSearch({ query: 'x', config: {} as EveConfig })).rejects.toThrow()
  })
})
