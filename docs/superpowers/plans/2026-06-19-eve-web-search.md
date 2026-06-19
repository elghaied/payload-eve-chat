# Eve Web Search + Read-URL (SearXNG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Eve two web tools — `webSearch` (self-hosted SearXNG) and `readUrl` (fetch + Readability extract) — so she can summarize a pasted link and research a topic to write an article, returning results in the chat.

**Architecture:** Pure helpers (`url-safety`, `web-search`, `read-url`) wrapped by a `createWebTools(config)` factory; the two native AI SDK tools are merged into `streamText`'s tool set in `route.ts`, but only when `SEARXNG_URL` is configured. SearXNG runs as an opt-in Docker service.

**Tech Stack:** Vercel AI SDK v6 (`tool()`), SearXNG (Docker), `@mozilla/readability` + `jsdom`, vitest.

**Design spec:** `docs/superpowers/specs/2026-06-19-eve-web-search-design.md`

## Global Constraints

- **Self-hosted only:** search goes through SearXNG; no hosted search API.
- **Tools gated on `SEARXNG_URL`:** `createWebTools` is merged into the tool set only when `eveConfig.searxngUrl` is set; otherwise neither web tool exists.
- **`readUrl` is SSRF-safe:** http(s) only; reject `localhost`, `*.local`/`*.internal`/`*.localhost`, and private/loopback/link-local IPs (incl. `169.254.169.254`); DNS-resolve the host and reject if any resolved IP is private; re-validate the final URL after redirects; cap bytes (~2 MB) and timeout (~10 s). Server-side only.
- **Context budget:** `readUrl` text is truncated to 12000 chars (qwen3 runs at 8192 ctx).
- **Article output is a chat reply** — web research never auto-creates a post (saving still routes through the existing `proposePost` preview).
- **Tool `execute` never throws to the model:** it catches, `console.error`s, and returns `{ error }`.
- **Test command:** `pnpm run test:int` (vitest, jsdom; `src/**/*.test.ts`). Typecheck: `pnpm exec tsc --noEmit`. Lint: `pnpm lint`.

---

## File Structure

- `src/eve/config.ts` *(modify)* — `searxngUrl?` on `EveConfig`.
- `src/eve/url-safety.ts` *(new)* — `isPrivateIp`, `parseFetchableUrl`, `assertFetchableUrl`.
- `src/eve/web-search.ts` *(new)* — `webSearch({ query, maxResults, config })`.
- `src/eve/read-url.ts` *(new)* — `extractReadable`, `readUrl`.
- `src/eve/web-tools.ts` *(new)* — `createWebTools(config)` (the only file importing `ai`/`zod` here).
- `src/app/api/eve/route.ts` *(modify)* — merge web tools when `searxngUrl` set.
- `src/eve/system-prompt.ts` *(modify)* — web-tool guidance.
- `docker-compose.yml` + `searxng/settings.yml` *(new/modify)* — SearXNG service.
- `.env.example`, `README.md` *(modify)* — docs.

---

## Task 1: `searxngUrl` config

**Files:** Modify `src/eve/config.ts`; Test `src/eve/config.test.ts`

**Interfaces:**
- Produces: `EveConfig.searxngUrl?: string` (env `SEARXNG_URL`, `undefined` when unset).

- [ ] **Step 1: Write the failing tests** — append to `src/eve/config.test.ts` inside the `describe`:

```ts
  it('leaves searxngUrl undefined by default and reads it from env', () => {
    expect(getEveConfig({ ANTHROPIC_API_KEY: 'k' }).searxngUrl).toBeUndefined()
    expect(getEveConfig({ ANTHROPIC_API_KEY: 'k', SEARXNG_URL: 'http://localhost:8080' }).searxngUrl).toBe(
      'http://localhost:8080',
    )
  })
```

- [ ] **Step 2: Run it RED** — `pnpm run test:int -- src/eve/config.test.ts` → FAIL (`searxngUrl` missing).

- [ ] **Step 3: Implement** — in `src/eve/config.ts`, add to the `EveConfig` type (after `ttsApiKey?: string`):

```ts
  searxngUrl?: string // undefined => web tools disabled
```

and to the `config` object in `getEveConfig` (after `ttsApiKey: env.TTS_API_KEY,`):

```ts
    searxngUrl: env.SEARXNG_URL,
```

- [ ] **Step 4: Run it GREEN** — `pnpm run test:int -- src/eve/config.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eve/config.ts src/eve/config.test.ts
git commit -m "feat(web): add searxngUrl to EveConfig"
```

---

## Task 2: URL safety (SSRF guard)

**Files:** Create `src/eve/url-safety.ts`, `src/eve/url-safety.test.ts`

**Interfaces:**
- Produces:
  - `isPrivateIp(ip: string): boolean`
  - `parseFetchableUrl(raw: string): URL` (throws on non-http(s)/blocked host/private literal IP)
  - `assertFetchableUrl(raw: string): Promise<URL>` (parse + DNS-resolve + reject private resolved IPs)

- [ ] **Step 1: Write the failing tests** — `src/eve/url-safety.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertFetchableUrl, isPrivateIp, parseFetchableUrl } from './url-safety'

describe('isPrivateIp', () => {
  it('flags loopback/private/link-local IPv4', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0'])
      expect(isPrivateIp(ip)).toBe(true)
  })
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) expect(isPrivateIp(ip)).toBe(false)
  })
  it('flags IPv6 loopback/ULA/link-local', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1']) expect(isPrivateIp(ip)).toBe(true)
  })
})

describe('parseFetchableUrl', () => {
  it('accepts a normal https URL', () => {
    expect(parseFetchableUrl('https://example.com/x').hostname).toBe('example.com')
  })
  it('rejects non-http(s) schemes', () => {
    expect(() => parseFetchableUrl('file:///etc/passwd')).toThrow()
    expect(() => parseFetchableUrl('ftp://example.com')).toThrow()
  })
  it('rejects localhost / .local / private literal IPs', () => {
    expect(() => parseFetchableUrl('http://localhost/x')).toThrow()
    expect(() => parseFetchableUrl('http://printer.local')).toThrow()
    expect(() => parseFetchableUrl('http://192.168.0.1')).toThrow()
    expect(() => parseFetchableUrl('http://169.254.169.254/latest/meta-data')).toThrow()
  })
})

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
import { lookup } from 'node:dns/promises'

describe('assertFetchableUrl', () => {
  afterEach(() => vi.clearAllMocks())
  it('rejects when the host resolves to a private IP', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.9', family: 4 }] as never)
    await expect(assertFetchableUrl('https://sneaky.example')).rejects.toThrow()
  })
  it('passes when the host resolves to a public IP', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    await expect(assertFetchableUrl('https://example.com')).resolves.toBeInstanceOf(URL)
  })
})
```

- [ ] **Step 2: Run it RED** — `pnpm run test:int -- src/eve/url-safety.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/eve/url-safety.ts`**

```ts
import { lookup } from 'node:dns/promises'
import net from 'node:net'

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost']

/** IPv4/IPv6 addresses that must never be fetched server-side. */
export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    return (
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (version === 6) {
    const ip6 = ip.toLowerCase()
    if (ip6 === '::1' || ip6 === '::') return true
    const mapped = ip6.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isPrivateIp(mapped[1])
    return ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')
  }
  return false // not a literal IP
}

/** Parse + require http(s) and a non-blocked literal host. Throws on violation. */
export function parseFetchableUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed: ${raw}`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error(`Blocked host: ${host}`)
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error(`Blocked private address: ${host}`)
  }
  return url
}

/** parseFetchableUrl + DNS resolution check (defends against public names → internal IPs). */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  const url = parseFetchableUrl(raw)
  if (net.isIP(url.hostname)) return url // literal already checked
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Blocked: ${url.hostname} resolves to a private address`)
  }
  return url
}
```

- [ ] **Step 4: Run it GREEN** — `pnpm run test:int -- src/eve/url-safety.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eve/url-safety.ts src/eve/url-safety.test.ts
git commit -m "feat(web): SSRF-safe URL guard (isPrivateIp / assertFetchableUrl)"
```

---

## Task 3: Web search via SearXNG

**Files:** Create `src/eve/web-search.ts`, `src/eve/web-search.test.ts`

**Interfaces:**
- Consumes: `EveConfig.searxngUrl` (Task 1).
- Produces: `type SearchResult = { title: string; url: string; snippet: string }`; `webSearch({ query, maxResults?, config }): Promise<SearchResult[]>`.

- [ ] **Step 1: Write the failing tests** — `src/eve/web-search.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it RED** — `pnpm run test:int -- src/eve/web-search.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/eve/web-search.ts`**

```ts
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
```

- [ ] **Step 4: Run it GREEN** — `pnpm run test:int -- src/eve/web-search.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eve/web-search.ts src/eve/web-search.test.ts
git commit -m "feat(web): webSearch via SearXNG JSON"
```

---

## Task 4: Read URL (fetch + Readability)

**Files:** Modify `package.json`; Create `src/eve/read-url.ts`, `src/eve/read-url.test.ts`

**Interfaces:**
- Consumes: `assertFetchableUrl` (Task 2).
- Produces: `extractReadable(html, url): { title, text }`; `readUrl({ url, maxChars? }): Promise<{ title, url, text, truncated }>`.

- [ ] **Step 1: Add dependencies**

Run: `pnpm add @mozilla/readability jsdom`
Expected: `@mozilla/readability` added; `jsdom` promoted from devDependencies to dependencies (it's used at runtime now). Lockfile updates.

- [ ] **Step 2: Write the failing tests** — `src/eve/read-url.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it RED** — `pnpm run test:int -- src/eve/read-url.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `src/eve/read-url.ts`**

```ts
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { assertFetchableUrl } from './url-safety'

const DEFAULT_MAX_CHARS = 12_000
const MAX_BYTES = 2_000_000

/** Extract the main readable title + text from an HTML string (scripts disabled). */
export function extractReadable(html: string, url: string): { title: string; text: string } {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const article = new Readability(doc).parse()
  const title = (article?.title || doc.title || '').trim()
  const raw = article?.textContent || doc.body?.textContent || ''
  return { title, text: raw.replace(/\s+/g, ' ').trim() }
}

/** Safely fetch a page and return its readable text, truncated to a context budget. */
export async function readUrl({
  url,
  maxChars = DEFAULT_MAX_CHARS,
}: {
  url: string
  maxChars?: number
}): Promise<{ title: string; url: string; text: string; truncated: boolean }> {
  const target = await assertFetchableUrl(url)
  const res = await fetch(target, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  // Re-validate the final URL host after any redirects.
  await assertFetchableUrl(res.url)

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('html') && !contentType.includes('xml')) {
    throw new Error(`Not an HTML page (${contentType || 'unknown'})`)
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('Page too large')

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new Error('Page too large')
  const html = new TextDecoder().decode(buffer)

  const { title, text } = extractReadable(html, res.url)
  const truncated = text.length > maxChars
  return { title, url: res.url, text: truncated ? text.slice(0, maxChars) : text, truncated }
}
```

- [ ] **Step 5: Run it GREEN** — `pnpm run test:int -- src/eve/read-url.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/eve/read-url.ts src/eve/read-url.test.ts
git commit -m "feat(web): readUrl with Readability extraction + truncation"
```

---

## Task 5: Web tools + route wiring + prompt

**Files:** Create `src/eve/web-tools.ts`, `src/eve/web-tools.test.ts`; Modify `src/app/api/eve/route.ts`, `src/eve/system-prompt.ts`

**Interfaces:**
- Consumes: `webSearch` (Task 3), `readUrl` (Task 4), `EveConfig` (Task 1).
- Produces: `createWebTools(config: EveConfig)` → `{ webSearch, readUrl }` (AI SDK tools).

- [ ] **Step 1: Write the failing tests** — `src/eve/web-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it RED** — `pnpm run test:int -- src/eve/web-tools.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/eve/web-tools.ts`**

```ts
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
```

- [ ] **Step 4: Run it GREEN** — `pnpm run test:int -- src/eve/web-tools.test.ts` → PASS.

- [ ] **Step 5: Wire into `src/app/api/eve/route.ts`**

Add the import near the other `@/eve` imports:

```ts
import { createWebTools } from '@/eve/web-tools'
```

Replace:

```ts
  const tools = { ...mcpTools, proposePost }
```

with:

```ts
  const tools = {
    ...mcpTools,
    proposePost,
    ...(eveConfig.searxngUrl ? createWebTools(eveConfig) : {}),
  }
```

- [ ] **Step 6: Add prompt guidance in `src/eve/system-prompt.ts`**

Insert a bullet into the Guidelines list (after the tasks/create bullets, before the "After a change…" bullet):

```
- For anything outside the CMS — current events, external facts, or a link the user shares —
  use "webSearch" to find sources and "readUrl" to read a page, then answer in your own
  words and CITE the source URLs as Markdown links. When asked to research and write an
  article, search, read the most relevant few results, then write it as your reply. Never
  fabricate facts or URLs. (These web tools exist only when web search is configured; if a
  request needs the web and they're absent, say web access isn't available.)
```

- [ ] **Step 7: Verify** — `pnpm exec tsc --noEmit && pnpm lint` (no type errors, 0 lint errors) and `pnpm run test:int` (all pass; pre-existing `tests/int/api.int.spec.ts` needs Mongo — ignore if it times out).

- [ ] **Step 8: Commit**

```bash
git add src/eve/web-tools.ts src/eve/web-tools.test.ts src/app/api/eve/route.ts src/eve/system-prompt.ts
git commit -m "feat(web): register webSearch/readUrl tools (gated on SEARXNG_URL) + prompt"
```

---

## Task 6: SearXNG Docker service

**Files:** Modify `docker-compose.yml`, `.env.example`; Create `searxng/settings.yml`

**Interfaces:** Produces SearXNG on `http://localhost:8080` with JSON output enabled.

- [ ] **Step 1: Create `searxng/settings.yml`** (inherits SearXNG defaults; enables JSON):

```yaml
use_default_settings: true
server:
  secret_key: "${SEARXNG_SECRET:-please-change-this-local-secret}"
search:
  formats:
    - html
    - json
```

- [ ] **Step 2: Add the service to `docker-compose.yml`** (sibling of `ollama`, in the `web`/`full` profiles):

```yaml
  searxng:
    image: searxng/searxng:latest
    profiles: ['web', 'full']
    ports:
      - '8080:8080'
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      - SEARXNG_SECRET=${SEARXNG_SECRET:-please-change-this-local-secret}
```

- [ ] **Step 3: Validate** — `docker compose config >/dev/null && echo OK` (or the `python3 -c "import yaml…"` fallback if docker is unavailable).

- [ ] **Step 4: Add env to `.env.example`** (after the voice block):

```bash
# --- Eve web search (optional, self-hosted SearXNG) ---
# Set SEARXNG_URL to enable the webSearch + readUrl tools (run: docker compose --profile web up -d searxng).
# SEARXNG_URL=http://localhost:8080
# SEARXNG_SECRET=please-change-this-local-secret
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml searxng/settings.yml .env.example
git commit -m "feat(web): add self-hosted SearXNG service (voice/full profiles, JSON enabled)"
```

---

## Task 7: Documentation

**Files:** Modify `README.md`

- [ ] **Step 1: Add a "Web search" subsection** under the Eve section (e.g., after "Post preview", before `## Voice`):

```markdown
### Web search (optional, self-hosted SearXNG)

Eve can search the web and read pages when a **SearXNG** instance is attached. With it,
she can summarize a link you paste and research a topic to write an article (returned in
the chat; ask her to save it to run it through the post preview).

Run SearXNG and point Eve at it:

    docker compose --profile web up -d searxng      # or --profile full for the whole stack
    # in .env:
    SEARXNG_URL=http://localhost:8080

Two tools light up only when `SEARXNG_URL` is set: `webSearch` (SearXNG JSON) and `readUrl`
(fetch + Mozilla Readability extraction). `readUrl` is SSRF-guarded — http(s) only, and
loopback/private/link-local hosts are blocked. Sanity-check SearXNG's JSON API:

    curl "http://localhost:8080/search?q=test&format=json"
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Eve web search (SearXNG)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §4.1 SearXNG → Task 6; §4.2 config → Task 1; §4.3 url-safety → Task 2; §4.4 web-search → Task 3; §4.5 read-url → Task 4; §4.6 web-tools → Task 5 (Steps 1–4); §4.7 route wiring → Task 5 Step 5; §4.8 prompt → Task 5 Step 6; §6 error handling → Task 5 (tool `{ error }`) + Task 2/4 (safety throws); §7 testing → Tasks 1–5 unit tests + Task 6 manual curl; §8 files → all covered; §9 out-of-scope respected (chat-reply only, no caching, no headless browser).
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `EveConfig.searxngUrl` (Task 1) is read by `webSearch` (Task 3), `createWebTools` (Task 5), and the route gate (Task 5 Step 5); `assertFetchableUrl` (Task 2) is consumed by `read-url` (Task 4); `SearchResult` shape `{title,url,snippet}` (Task 3) matches the `webSearch` tool result (Task 5); `readUrl` return `{title,url,text,truncated}` (Task 4) matches its tool wrapper (Task 5).
