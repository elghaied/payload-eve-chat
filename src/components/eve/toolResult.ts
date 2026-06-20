import type { EveDynamicToolPart } from 'eve/react'

// Parse Eve tool-call parts into structured, renderable views — so the chat shows real UI
// (clickable search links, "Created task → admin link", fetched-URL preview) instead of raw
// JSON. Shapes are documented in docs/superpowers/notes/tool-output-shapes.md.

export type WebSearchItem = { url: string; title: string; pageAge: string | null }
export type AdminRecord = { id: string; label: string; href?: string }

export type ToolResultView =
  | { kind: 'web_search'; results: WebSearchItem[] }
  | { kind: 'web_fetch'; url: string; truncated: boolean; preview: string }
  | { kind: 'records'; verb: 'Created' | 'Updated' | 'Found'; collection?: string; records: AdminRecord[]; total?: number }
  | { kind: 'text'; text: string }
  | { kind: 'json'; text?: string; json: string }

type AnyRecord = Record<string, unknown>

const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null

/** Best-effort hostname for display. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Infer the Payload collection slug from the tool input, or the doc's field shape. */
export function collectionSlugOf(input: unknown, doc: unknown): string | undefined {
  if (isObj(input) && typeof input['collectionSlug'] === 'string') return input['collectionSlug']
  if (isObj(doc)) {
    if ('priority' in doc || 'done' in doc) return 'tasks'
    if ('status' in doc || 'content' in doc) return 'posts'
  }
  return undefined
}

export function adminHref(slug: string | undefined, id: unknown): string | undefined {
  if (!slug || (typeof id !== 'string' && typeof id !== 'number')) return undefined
  return `/admin/collections/${slug}/${id}`
}

function labelOf(doc: AnyRecord): string {
  for (const k of ['title', 'name', 'label']) {
    if (typeof doc[k] === 'string' && doc[k]) return doc[k] as string
  }
  return typeof doc['id'] === 'string' || typeof doc['id'] === 'number' ? `#${doc['id']}` : 'record'
}

function verbFor(toolName: string): 'Created' | 'Updated' | 'Found' {
  const n = toolName.toLowerCase()
  if (n.includes('update')) return 'Updated'
  if (n.includes('find') || n.includes('get') || n.includes('list')) return 'Found'
  return 'Created'
}

function toRecord(doc: AnyRecord, slug: string | undefined): AdminRecord {
  return { id: String(doc['id'] ?? ''), label: labelOf(doc), href: adminHref(slug, doc['id']) }
}

function mcpText(output: AnyRecord): string | undefined {
  const content = output['content']
  if (Array.isArray(content)) {
    const first = content.find((c) => isObj(c) && c['type'] === 'text') as AnyRecord | undefined
    if (first && typeof first['text'] === 'string') return first['text']
  }
  return undefined
}

/**
 * Describe a completed tool part for rendering. Returns null if the part isn't a finished
 * tool result (caller handles running/error/denied/HITL states separately).
 */
export function describeToolResult(part: EveDynamicToolPart): ToolResultView | null {
  if (part.state !== 'output-available') return null
  const output = part.output
  const name = part.toolMetadata?.eve?.name ?? part.toolName

  // web_search — Anthropic native output is an array of web_search_result objects.
  if (name === 'web_search' || (Array.isArray(output) && isObj(output[0]) && output[0]['type'] === 'web_search_result')) {
    const arr = Array.isArray(output) ? output : []
    const results: WebSearchItem[] = arr
      .filter(isObj)
      .filter((r) => typeof r['url'] === 'string')
      .map((r) => ({
        url: r['url'] as string,
        title: (typeof r['title'] === 'string' && r['title']) || hostOf(r['url'] as string),
        pageAge: typeof r['pageAge'] === 'string' ? (r['pageAge'] as string) : null,
      }))
    return { kind: 'web_search', results }
  }

  // web_fetch — { content, contentType, url, truncated }
  if ((name === 'web_fetch' || (isObj(output) && 'content' in output && 'url' in output && 'contentType' in output)) && isObj(output)) {
    const content = typeof output['content'] === 'string' ? (output['content'] as string) : ''
    return {
      kind: 'web_fetch',
      url: typeof output['url'] === 'string' ? (output['url'] as string) : '',
      truncated: output['truncated'] === true,
      preview: content.slice(0, 600),
    }
  }

  // MCP tools — { content:[{text}], doc?, isError? }
  if (isObj(output)) {
    const doc = output['doc']
    const text = mcpText(output)
    if (isObj(doc)) {
      // List result (PaginatedDocs) → Found N
      const docs = doc['docs']
      if (Array.isArray(docs)) {
        const slug = collectionSlugOf(part.input, docs.find(isObj))
        return {
          kind: 'records',
          verb: 'Found',
          collection: slug,
          total: typeof doc['totalDocs'] === 'number' ? (doc['totalDocs'] as number) : docs.length,
          records: docs.filter(isObj).slice(0, 10).map((d) => toRecord(d, slug)),
        }
      }
      // Single document
      const slug = collectionSlugOf(part.input, doc)
      return { kind: 'records', verb: verbFor(name), collection: slug, records: [toRecord(doc, slug)] }
    }
    if (text) return { kind: 'text', text }
  }

  // Fallback: plain string output, or unknown structured output → readable + raw behind a toggle.
  if (typeof output === 'string') return { kind: 'text', text: output }
  return { kind: 'json', json: safeJson(output) }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** A short label describing what a running tool is doing (for the in-progress state). */
export function runningLabel(part: EveDynamicToolPart): string {
  const name = part.toolMetadata?.eve?.name ?? part.toolName
  const input = part.input
  if (name === 'web_search') return 'Searching the web…'
  if (name === 'web_fetch') {
    const url = isObj(input) && typeof input['url'] === 'string' ? hostOf(input['url']) : ''
    return url ? `Reading ${url}…` : 'Reading page…'
  }
  const titleish =
    isObj(input) && isObj(input['data']) && typeof (input['data'] as AnyRecord)['title'] === 'string'
      ? ` “${(input['data'] as AnyRecord)['title'] as string}”`
      : ''
  const gerund = { Created: 'Creating', Updated: 'Updating', Found: 'Looking up' }[verbFor(name)]
  return `${gerund}${titleish}…`
}
