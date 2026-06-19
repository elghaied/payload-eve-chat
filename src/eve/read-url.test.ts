import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractReadable, readUrl } from './read-url'

describe('extractReadable', () => {
  it('pulls the article title and body, dropping nav/boilerplate', () => {
    const html = `<!doctype html><html><head><title>My Title</title></head><body>
      <nav>Home About Contact</nav>
      <article><h1>My Title</h1><p>First paragraph of the real article body here.</p>
      <p>Second paragraph with more substance to satisfy readability.</p></article>
      <footer>copyright</footer></body></html>`
    const { title, text } = extractReadable(html, 'https://example.com/post')
    expect(title).toContain('My Title')
    expect(text).toContain('First paragraph of the real article body')
    expect(text).not.toContain('Home About Contact')
  })
})

vi.mock('./url-safety', () => ({ assertFetchableUrl: vi.fn(async (u: string) => new URL(u)) }))

describe('readUrl', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('fetches, extracts, and truncates', async () => {
    const body = '<html><head><title>T</title></head><body><article><p>' + 'word '.repeat(50) + '</p></article></body></html>'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })),
    )
    const out = await readUrl({ url: 'https://example.com', maxChars: 40 })
    expect(out.title).toBe('T')
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBe(40)
  })

  it('rejects a non-HTML content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
    )
    await expect(readUrl({ url: 'https://example.com/data.json' })).rejects.toThrow()
  })
})
