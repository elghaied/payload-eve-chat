import type { EveDynamicToolPart } from 'eve/react'

// Parse Eve tool-call parts into structured, renderable views — so the chat shows real UI
// (clickable search links, "Created task → admin link", fetched-URL preview) instead of raw
// JSON. Shapes are documented in docs/superpowers/notes/tool-output-shapes.md.

export type WebSearchItem = { url: string; title: string; pageAge: string | null }
export type AdminRecord = { id: string; label: string; href?: string }
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoItem = { content: string; status: TodoStatus; priority?: string }

export type ToolResultView =
  | { kind: 'web_search'; answer?: string; results: WebSearchItem[] }
  | { kind: 'web_fetch'; url: string; truncated: boolean; preview: string }
  | { kind: 'records'; verb: 'Created' | 'Updated' | 'Found'; collection?: string; records: AdminRecord[]; total?: number }
  | { kind: 'discovery'; connection?: string; tools: string[]; count: number }
  | { kind: 'todos'; todos: TodoItem[]; total: number; completed: number }
  | { kind: 'text'; text: string }
  // Last-resort fallback: a clean "✓ <tool>" line — NEVER a raw-JSON dump.
  | { kind: 'done'; tool: string }

type AnyRecord = Record<string, unknown>

const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null

/**
 * Eve qualifies connection (MCP) tools as `connection__<conn>__<tool>` and its built-in
 * discovery tool as `connection__search`. Strip the prefix to the bare tool name so
 * matching + labels read `createDocument` / `search`, not `connection payload mcp create…`.
 */
export function bareToolName(name: string): string {
  const m = name.match(/^connection__(?:.+__)?(.+)$/)
  return m ? m[1]! : name
}

const TODO_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled']
const asTodoStatus = (v: unknown): TodoStatus =>
  typeof v === 'string' && (TODO_STATUSES as string[]).includes(v) ? (v as TodoStatus) : 'pending'

/** A connection_search result item: { connection, description, tool?, ... }. */
const isDiscoveryItem = (v: unknown): v is AnyRecord =>
  isObj(v) && typeof v['connection'] === 'string' && typeof v['description'] === 'string'

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

/** Normalize one search source (URL string, or {url,title,date?}) into a link item. */
function toSearchItem(src: unknown): WebSearchItem | null {
  if (typeof src === 'string') return { url: src, title: hostOf(src), pageAge: null }
  if (isObj(src) && typeof src['url'] === 'string') {
    const url = src['url'] as string
    const title = typeof src['title'] === 'string' && src['title'] ? (src['title'] as string) : hostOf(url)
    const date = src['date'] ?? src['pageAge'] ?? src['published_date']
    return { url, title, pageAge: typeof date === 'string' ? date : null }
  }
  return null
}

/** Anthropic-native web_search output is an array of { url, title, pageAge }. */
function toWebSearchArray(output: unknown): WebSearchItem[] {
  if (!Array.isArray(output)) return []
  return output
    .filter(isObj)
    .filter((r) => typeof r['url'] === 'string')
    .map((r) => ({
      url: r['url'] as string,
      title: (typeof r['title'] === 'string' && r['title']) || hostOf(r['url'] as string),
      pageAge: typeof r['pageAge'] === 'string' ? (r['pageAge'] as string) : null,
    }))
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
  const rawName = part.toolMetadata?.eve?.name ?? part.toolName
  const name = bareToolName(rawName)

  // connection_search — Eve's built-in tool discovery. Output is an array of
  // { connection, description, tool?, inputSchema? }. Show a quiet "found N tools"
  // summary, NEVER the raw schema dump.
  if (
    rawName === 'connection_search' ||
    rawName === 'connection__search' ||
    (Array.isArray(output) && output.length > 0 && output.every(isDiscoveryItem))
  ) {
    const items = Array.isArray(output) ? output.filter(isDiscoveryItem) : []
    const tools = items
      .map((it) => (typeof it['tool'] === 'string' ? (it['tool'] as string) : ''))
      .filter((t) => t.length > 0)
    const connection = items.find((it) => typeof it['connection'] === 'string')?.['connection'] as
      | string
      | undefined
    return { kind: 'discovery', connection, tools, count: items.length }
  }

  // todo — Eve's durable per-session checklist. Output is { counts, todos:[{content,status,priority}] }.
  if (name === 'todo' && isObj(output) && Array.isArray(output['todos'])) {
    const todos: TodoItem[] = (output['todos'] as unknown[]).filter(isObj).map((t) => ({
      content: typeof t['content'] === 'string' ? (t['content'] as string) : '',
      status: asTodoStatus(t['status']),
      priority: typeof t['priority'] === 'string' ? (t['priority'] as string) : undefined,
    }))
    const counts = isObj(output['counts']) ? (output['counts'] as AnyRecord) : {}
    const total = typeof counts['total'] === 'number' ? (counts['total'] as number) : todos.length
    const completed =
      typeof counts['completed'] === 'number'
        ? (counts['completed'] as number)
        : todos.filter((t) => t.status === 'completed').length
    return { kind: 'todos', todos, total, completed }
  }

  // web_search — our gateway tool returns { answer, sources } | { error }.
  // (Also handle the Anthropic-native array shape as a fallback.)
  if (name === 'web_search') {
    if (isObj(output)) {
      if (typeof output['error'] === 'string') return { kind: 'text', text: output['error'] as string }
      if (typeof output['answer'] === 'string') {
        const sources = Array.isArray(output['sources']) ? output['sources'] : []
        return {
          kind: 'web_search',
          answer: output['answer'] as string,
          results: sources.map(toSearchItem).filter((x): x is WebSearchItem => x !== null),
        }
      }
    }
    return { kind: 'web_search', results: toWebSearchArray(output) }
  }
  if (Array.isArray(output) && isObj(output[0]) && output[0]['type'] === 'web_search_result') {
    return { kind: 'web_search', results: toWebSearchArray(output) }
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

  // Fallback: plain string output renders as text; anything else becomes a clean
  // "✓ <tool>" line. We deliberately never dump raw JSON into the chat.
  if (typeof output === 'string') return { kind: 'text', text: output }
  return { kind: 'done', tool: name }
}

/** A short label describing what a running tool is doing (for the in-progress state). */
export function runningLabel(part: EveDynamicToolPart): string {
  const rawName = part.toolMetadata?.eve?.name ?? part.toolName
  const name = bareToolName(rawName)
  const input = part.input
  if (rawName === 'connection_search' || rawName === 'connection__search')
    return 'Finding available tools…'
  if (name === 'todo') return 'Updating the plan…'
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
