import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ webSearch: vi.fn(), readUrl: vi.fn() }))
vi.mock('./web-search', () => ({ webSearch: m.webSearch }))
vi.mock('./read-url', () => ({ readUrl: m.readUrl }))

import { createWebTools } from './web-tools'
import type { EveConfig } from './config'

const config = { searxngUrl: 'http://searxng:8080' } as EveConfig

describe('createWebTools', () => {
  it('exposes webSearch and readUrl tools', () => {
    const tools = createWebTools(config)
    expect(Object.keys(tools).sort()).toEqual(['readUrl', 'webSearch'])
  })

  it('webSearch execute returns { results } and { error } on failure', async () => {
    const { webSearch } = createWebTools(config)
    m.webSearch.mockResolvedValueOnce([{ title: 'T', url: 'u', snippet: 's' }])
    expect(await webSearch.execute!({ query: 'x' }, {} as never)).toEqual({
      results: [{ title: 'T', url: 'u', snippet: 's' }],
    })
    m.webSearch.mockRejectedValueOnce(new Error('down'))
    expect(await webSearch.execute!({ query: 'x' }, {} as never)).toHaveProperty('error')
  })

  it('readUrl execute returns the page and { error } on failure', async () => {
    const { readUrl } = createWebTools(config)
    m.readUrl.mockResolvedValueOnce({ title: 'T', url: 'u', text: 'body', truncated: false })
    expect(await readUrl.execute!({ url: 'https://e.com' }, {} as never)).toMatchObject({ title: 'T' })
    m.readUrl.mockRejectedValueOnce(new Error('blocked'))
    expect(await readUrl.execute!({ url: 'https://e.com' }, {} as never)).toHaveProperty('error')
  })
})
