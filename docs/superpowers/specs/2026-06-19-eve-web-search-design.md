# Eve Web Search + Read-URL (self-hosted SearXNG) — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — ready for implementation plan
**Goal:** Give Eve two web tools — search the internet (via a self-hosted SearXNG) and read a URL's main content — so she can summarize a link the user pastes and research a topic to write an article, returning results in the chat.

---

## 1. Summary

Eve currently only reaches Payload data over MCP (plus `proposePost`). This adds an
**opt-in web capability** backed by a self-hosted **SearXNG** metasearch container:

- **`webSearch`** — query SearXNG's JSON API, return the top results (title, URL, snippet).
- **`readUrl`** — fetch a page and extract its main readable text (Mozilla Readability),
  for summarizing.

Both are native Vercel AI SDK tools added to the `streamText` tool set (like
`proposePost`), enabled only when `SEARXNG_URL` is configured (attach-by-env, matching
STT/TTS/Ollama). Results flow through the normal chat stream — **no UI changes**.

Use cases:
- "Summarize this link: …" → `readUrl` → summary.
- "Search the web for X and write an article" → `webSearch` → `readUrl` on the top few →
  synthesize → **chat reply** with cited source URLs. (Saving it as a post is separate:
  the user asks, which routes through the existing `proposePost` preview.)

## 2. Requirements (decided during brainstorming)

- **Self-hosted SearXNG** in Docker (not a hosted search API), consistent with the local-first stack.
- **Two tools:** `webSearch` and `readUrl`.
- **Article output = chat reply** (decoupled from post creation; the post-preview gate is unchanged).
- **Reading = Readability extraction** (`@mozilla/readability` + `jsdom`, scripts disabled), truncated to a context-safe budget — not a raw HTML strip, not a separate reader container.
- **Enabled only when `SEARXNG_URL` is set** (both tools gated together as the "web" capability).
- **SSRF-safe `readUrl`:** http(s) only; block loopback/private/link-local hosts (incl. `169.254.169.254`); resolve DNS and re-check the resolved IP; cap response size; timeout. Server-side only.
- Always cite source URLs; never fabricate.

## 3. Architecture

```
"summarize https://…"            "search X and write an article"
        │                                  │
        ▼                                  ▼
   readUrl(url)                       webSearch(query) ──► SearXNG (:8080, JSON)
        │                                  │   top results (title,url,snippet)
        │                                  ▼
        └────────────► readUrl(url) on the top few ◄──────┘
                              │
   src/eve/read-url.ts  ◄─────┘   (assertFetchableUrl → fetch → Readability → truncate)
                              ▼
                    { title, text }  ─►  model synthesizes  ─►  chat reply (cites URLs)
```

All tool execution is server-side inside `/api/eve` (the authenticated route). The browser
never calls SearXNG or fetches pages.

**Boundaries:**
- **`src/eve/url-safety.ts`** — pure URL/IP checks (`isPrivateIp`, scheme/host validation) + `assertFetchableUrl(url)` (adds DNS resolution). One job: decide if a URL is safe to fetch.
- **`src/eve/web-search.ts`** — `webSearch({ query, maxResults, config })`: call SearXNG JSON, parse results. Knows nothing about tools.
- **`src/eve/read-url.ts`** — `readUrl({ url })`: safety → fetch → `extractReadable(html, url)` → truncate.
- **`src/eve/web-tools.ts`** — `createWebTools(config)`: wraps the two as AI SDK tools; the only file that imports `ai`/`zod` for these.
- **`src/app/api/eve/route.ts`** — merges the web tools into the tool set when `config.searxngUrl` is set.

## 4. Component design

### 4.1 SearXNG service (`docker-compose.yml` + `searxng/settings.yml`)

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

`searxng/settings.yml` (checked in) inherits SearXNG's defaults and only enables JSON
output (SearXNG ships HTML-only by default, so `format=json` 403s without this):

```yaml
use_default_settings: true
server:
  secret_key: "${SEARXNG_SECRET:-please-change-this-local-secret}"
search:
  formats:
    - html
    - json
```

Added to the `full` profile so `docker compose --profile full up` (and the
`COMPOSE_PROFILES=full` default) brings it up alongside ollama/stt/tts.

### 4.2 Config (`src/eve/config.ts`)

Add to `EveConfig`:

```ts
searxngUrl?: string // undefined => web tools disabled
```

Resolution: `searxngUrl: env.SEARXNG_URL` (no default; absence disables the web tools).
Never throws.

### 4.3 URL safety (`src/eve/url-safety.ts`, new)

```ts
/** True for IPv4/IPv6 addresses that must never be fetched server-side. */
export function isPrivateIp(ip: string): boolean
/** Parse + require http(s) and a non-blocked literal host; throws on violation. Returns URL. */
export function parseFetchableUrl(raw: string): URL
/** parseFetchableUrl + DNS-resolve the host and reject if any resolved address is private. */
export async function assertFetchableUrl(raw: string): Promise<URL>
```

- `isPrivateIp` blocks: `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
  (link-local incl. cloud metadata `169.254.169.254`), `0.0.0.0`, and IPv6 `::1`, `fc00::/7`
  (ULA), `fe80::/10` (link-local).
- `parseFetchableUrl` rejects non-`http`/`https` schemes and hosts that are `localhost`,
  end in `.local`/`.internal`/`.localhost`, or are private literal IPs.
- `assertFetchableUrl` additionally `dns.lookup(host, { all: true })` and rejects if any
  resolved address `isPrivateIp` (defends against a public name pointing at an internal IP).

### 4.4 Web search (`src/eve/web-search.ts`, new)

```ts
export type SearchResult = { title: string; url: string; snippet: string }
export async function webSearch(args: {
  query: string
  maxResults?: number // clamped to 1..10, default 5
  config: EveConfig
}): Promise<SearchResult[]>
```

- GET `${config.searxngUrl}/search` with `q`, `format=json`, `safesearch=1`; abort/timeout (~10s).
- Map SearXNG's `results[]` to `{ title, url, snippet }` (snippet from `content`), sliced to `maxResults`.
- Throws a typed error on non-2xx / bad JSON (logged by the tool).

### 4.5 Read URL (`src/eve/read-url.ts`, new)

```ts
export function extractReadable(html: string, url: string): { title: string; text: string }
export async function readUrl(args: { url: string; maxChars?: number }): Promise<{
  title: string
  url: string
  text: string
  truncated: boolean
}>
```

- `readUrl`: `await assertFetchableUrl(url)` → `fetch` with timeout, an `Accept: text/html`
  header, a cap on bytes read (~2 MB), and `redirect: 'follow'` **but** re-validate the final
  URL host (re-run the IP check on `res.url`). Reject non-HTML content types.
- `extractReadable`: build a `JSDOM` (scripts disabled — jsdom default) and run
  `@mozilla/readability` `Readability(doc).parse()`; fall back to `document.body.textContent`
  if Readability returns nothing. Collapse whitespace.
- Truncate `text` to `maxChars` (default 12000) so it fits the model context (qwen3 is 8192);
  set `truncated` when cut.

### 4.6 Web tools (`src/eve/web-tools.ts`, new)

```ts
export function createWebTools(config: EveConfig): {
  webSearch: Tool
  readUrl: Tool
}
```

- `webSearch` tool: input `{ query: string, maxResults?: number }`; `execute` calls
  `webSearch({ ...input, config })`, returns `{ results }`; on error returns
  `{ error: string }` (so the model can recover) and logs.
- `readUrl` tool: input `{ url: string }`; `execute` calls `readUrl({ url })`, returns
  `{ title, url, text, truncated }`; on a safety rejection returns `{ error: 'That URL
  can't be fetched.' }`.
- Tool descriptions instruct: use `webSearch` to find sources, `readUrl` to read a specific
  page, always cite URLs.

### 4.7 Route wiring (`src/app/api/eve/route.ts`)

```ts
const tools = {
  ...mcpTools,
  proposePost,
  ...(eveConfig.searxngUrl ? createWebTools(eveConfig) : {}),
}
```

No other route change.

### 4.8 System prompt (`src/eve/system-prompt.ts`)

Add guidance (only meaningful when the tools are present): "For anything outside the CMS —
current events, external facts, or a link the user shares — use `webSearch` to find sources
and `readUrl` to read a page, then answer. When asked to write an article from web research,
search, read the most relevant few results, synthesize in your own words, and **cite the
source URLs** as Markdown links. Never fabricate facts or URLs; if the web tools aren't
available, say so."

## 5. Data flow

1. **Summarize a link:** user pastes URL → model calls `readUrl(url)` → safety + fetch +
   extract → `{ title, text }` → model summarizes in the chat.
2. **Research + article:** model calls `webSearch(query)` → picks results → `readUrl` on the
   top 2–4 → synthesizes an article as a chat reply citing the URLs. (User may then ask to
   save it → existing `proposePost` preview.)

## 6. Error handling

- **Web disabled** (`SEARXNG_URL` unset): tools aren't registered; the prompt tells Eve to
  say web access isn't available.
- **SearXNG down / non-2xx / bad JSON:** the underlying `webSearch()` throws; the tool's
  `execute` catches it, logs via `console.error`, and returns `{ error }` so the model can
  report it gracefully (the tool result also streams to the chat tool UI).
- **Unsafe/unfetchable URL:** `assertFetchableUrl` throws → `readUrl` tool returns `{ error }`;
  nothing is fetched.
- **Huge/binary/non-HTML page:** byte cap + content-type check → error result.
- **Timeouts:** both fetches use an `AbortController` (~10s).

## 7. Testing

Unit tests (vitest):
- **`url-safety`** — `isPrivateIp` across IPv4/IPv6 private/loopback/link-local vs public;
  `parseFetchableUrl` rejects non-http(s), `localhost`, `.local`, and private literal IPs,
  accepts a normal `https://example.com`.
- **`web-search`** — mocked `fetch` returning SearXNG JSON → correct `{title,url,snippet}`
  mapping, `maxResults` clamp, error thrown on non-2xx.
- **`read-url`** — `extractReadable` on a sample HTML article string → returns the title and
  the article text without nav/boilerplate; truncation sets `truncated`.
- **tools** — `createWebTools(config)` returns both tools; their `execute` returns the
  expected shapes (with `fetch`/`dns` mocked) and an `{ error }` object on failure.

SearXNG itself is verified manually: `curl "localhost:8080/search?q=test&format=json"` returns JSON.

## 8. New / changed files

- `docker-compose.yml` — add `searxng` service (profiles `web`/`full`). *(modify)*
- `searxng/settings.yml` — enable JSON output. *(new)*
- `.env.example` — `SEARXNG_URL`, `SEARXNG_SECRET` (commented/optional). *(modify)*
- `src/eve/config.ts` — `searxngUrl`. *(modify)*
- `src/eve/config.test.ts` — searxngUrl cases. *(modify)*
- `src/eve/url-safety.ts` + `src/eve/url-safety.test.ts`. *(new)*
- `src/eve/web-search.ts` + `src/eve/web-search.test.ts`. *(new)*
- `src/eve/read-url.ts` + `src/eve/read-url.test.ts`. *(new)*
- `src/eve/web-tools.ts` + `src/eve/web-tools.test.ts`. *(new)*
- `src/app/api/eve/route.ts` — merge web tools when `searxngUrl` set. *(modify)*
- `src/eve/system-prompt.ts` — web-tool guidance. *(modify)*
- `package.json` — add `@mozilla/readability`, `jsdom` (promote jsdom to a dependency). *(modify)*
- `README.md` — web search setup. *(modify)*

## 9. Out of scope (YAGNI)

- Auto-saving researched articles (stays a chat reply; saving routes through `proposePost`).
- Crawling multiple pages / pagination beyond the top results the model chooses to read.
- A search results UI / citations panel (Markdown links in the reply suffice).
- Caching fetched pages or search results.
- JS-rendered page scraping (headless browser) — Readability on fetched HTML only.
