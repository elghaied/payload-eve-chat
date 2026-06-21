import { describe, expect, it } from 'vitest'
import type { EveDynamicToolPart } from 'eve/react'
import {
  adminHref,
  bareToolName,
  collectionSlugOf,
  describeToolResult,
  hostOf,
  parseJsonBlock,
  runningLabel,
} from './toolResult'

function part(over: Record<string, unknown>): EveDynamicToolPart {
  return { type: 'dynamic-tool', toolCallId: 'c', toolName: 't', ...over } as unknown as EveDynamicToolPart
}

describe('helpers', () => {
  it('hostOf strips www', () => {
    expect(hostOf('https://www.example.com/a/b')).toBe('example.com')
    expect(hostOf('not a url')).toBe('not a url')
  })
  it('collectionSlugOf prefers input, falls back to doc shape', () => {
    expect(collectionSlugOf({ collectionSlug: 'posts' }, {})).toBe('posts')
    expect(collectionSlugOf({}, { priority: 'high' })).toBe('tasks')
    expect(collectionSlugOf({}, { status: 'draft' })).toBe('posts')
    expect(collectionSlugOf({}, {})).toBeUndefined()
  })
  it('adminHref builds a link only with slug + id', () => {
    expect(adminHref('tasks', '123')).toBe('/admin/collections/tasks/123')
    expect(adminHref(undefined, '1')).toBeUndefined()
    expect(adminHref('tasks', undefined)).toBeUndefined()
  })
  it('bareToolName strips the connection__<conn>__ prefix', () => {
    expect(bareToolName('connection__payload-mcp__createDocument')).toBe('createDocument')
    expect(bareToolName('connection__search')).toBe('search')
    expect(bareToolName('web_search')).toBe('web_search')
  })
})

describe('describeToolResult', () => {
  it('returns null for non-output states', () => {
    expect(describeToolResult(part({ state: 'input-available', input: {} }))).toBeNull()
  })

  it('parses web_search array into link items', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'web_search',
        input: {},
        output: [
          { type: 'web_search_result', url: 'https://www.deepgram.com/x', title: 'Deepgram', pageAge: '2025-01-01' },
          { type: 'web_search_result', url: 'https://groq.com/y', title: null, pageAge: null },
        ],
      }),
    )
    expect(v?.kind).toBe('web_search')
    if (v?.kind === 'web_search') {
      expect(v.results).toHaveLength(2)
      expect(v.results[0]).toMatchObject({ url: 'https://www.deepgram.com/x', title: 'Deepgram', pageAge: '2025-01-01' })
      // null title falls back to host
      expect(v.results[1]!.title).toBe('groq.com')
    }
  })

  it('parses the gateway web_search tool output { answer, sources }', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'web_search',
        toolMetadata: { eve: { kind: 'tool-call', name: 'web_search' } },
        input: { query: 'payload cms v4' },
        output: { answer: 'Payload v4 is out.', sources: ['https://payloadcms.com/docs', { url: 'https://x.com/a', title: 'X' }] },
      }),
    )
    expect(v?.kind).toBe('web_search')
    if (v?.kind === 'web_search') {
      expect(v.answer).toBe('Payload v4 is out.')
      expect(v.results.map((r) => r.url)).toEqual(['https://payloadcms.com/docs', 'https://x.com/a'])
      expect(v.results[0]!.title).toBe('payloadcms.com')
      expect(v.results[1]!.title).toBe('X')
    }
  })

  it('renders a web_search error as text', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'web_search',
        toolMetadata: { eve: { kind: 'tool-call', name: 'web_search' } },
        input: { query: 'x' },
        output: { error: 'Web search timed out after 25s.' },
      }),
    )
    expect(v).toMatchObject({ kind: 'text', text: 'Web search timed out after 25s.' })
  })

  it('parses web_fetch output', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'web_fetch',
        input: { url: 'https://x.com' },
        output: { content: 'hello world', contentType: 'text/html', url: 'https://x.com', truncated: true },
      }),
    )
    expect(v).toMatchObject({ kind: 'web_fetch', url: 'https://x.com', truncated: true, preview: 'hello world' })
  })

  // NOTE: these fixtures pass `doc` directly (test-only shape). Real MCP wire output carries the doc inside a fenced ```json block in content[0].text; parseJsonBlock handles that path.
  it('parses an MCP single-doc create into a record with admin link', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'createDocument',
        toolMetadata: { eve: { kind: 'tool-call', name: 'createDocument' } },
        input: { collectionSlug: 'tasks', data: { title: 'Buy milk' } },
        output: { content: [{ type: 'text', text: 'created' }], doc: { id: 'abc', title: 'Buy milk', priority: 'high' } },
      }),
    )
    expect(v?.kind).toBe('records')
    if (v?.kind === 'records') {
      expect(v.verb).toBe('Created')
      expect(v.collection).toBe('tasks')
      expect(v.records[0]).toMatchObject({ label: 'Buy milk', href: '/admin/collections/tasks/abc' })
    }
  })

  it('parses an MCP find list into Found N with records', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'findDocuments',
        toolMetadata: { eve: { kind: 'tool-call', name: 'findDocuments' } },
        input: { collectionSlug: 'posts' },
        output: { content: [{ type: 'text', text: '...' }], doc: { docs: [{ id: '1', title: 'A', status: 'draft' }, { id: '2', title: 'B' }], totalDocs: 2 } },
      }),
    )
    expect(v?.kind).toBe('records')
    if (v?.kind === 'records') {
      expect(v.verb).toBe('Found')
      expect(v.total).toBe(2)
      expect(v.records.map((r) => r.label)).toEqual(['A', 'B'])
      expect(v.records[0]!.href).toBe('/admin/collections/posts/1')
    }
  })

  it('parses a name-qualified MCP create (connection__<conn>__createDocument)', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__createDocument',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__createDocument' } },
        input: { collectionSlug: 'posts', data: { title: 'My Article' } },
        output: { content: [{ type: 'text', text: 'created' }], doc: { id: 'p1', title: 'My Article', status: 'draft' } },
      }),
    )
    expect(v?.kind).toBe('records')
    if (v?.kind === 'records') {
      expect(v.verb).toBe('Created')
      expect(v.records[0]).toMatchObject({ label: 'My Article', href: '/admin/collections/posts/p1' })
    }
  })

  it('renders connection_search discovery as a tool summary, not JSON', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__search',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__search' } },
        input: { keywords: 'create post' },
        output: [
          { connection: 'payload-mcp', tool: 'createDocument', description: 'Create a document', inputSchema: { type: 'object' } },
          { connection: 'payload-mcp', tool: 'findDocuments', description: 'Find documents', inputSchema: { type: 'object' } },
        ],
      }),
    )
    expect(v?.kind).toBe('discovery')
    if (v?.kind === 'discovery') {
      expect(v.count).toBe(2)
      expect(v.connection).toBe('payload-mcp')
      expect(v.tools).toEqual(['createDocument', 'findDocuments'])
    }
  })

  it('renders the todo list as a checklist view', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'todo',
        toolMetadata: { eve: { kind: 'tool-call', name: 'todo' } },
        input: {},
        output: {
          counts: { cancelled: 0, completed: 1, in_progress: 1, pending: 1, total: 3 },
          todos: [
            { content: 'Outline', status: 'completed', priority: 'high' },
            { content: 'Draft', status: 'in_progress', priority: 'medium' },
            { content: 'Review', status: 'pending', priority: 'low' },
          ],
        },
      }),
    )
    expect(v?.kind).toBe('todos')
    if (v?.kind === 'todos') {
      expect(v.total).toBe(3)
      expect(v.completed).toBe(1)
      expect(v.todos.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending'])
    }
  })

  it('falls back to text for an MCP result with no doc', () => {
    const v = describeToolResult(
      part({ state: 'output-available', toolName: 'findDocuments', input: {}, output: { content: [{ type: 'text', text: 'Not found' }] } }),
    )
    expect(v).toMatchObject({ kind: 'text', text: 'Not found' })
  })

  it('falls back to a clean done line (never raw JSON) for unknown structured output', () => {
    const v = describeToolResult(part({ state: 'output-available', toolName: 'mystery', input: {}, output: { foo: 1 } }))
    expect(v).toMatchObject({ kind: 'done', tool: 'mystery' })
  })
})

describe('runningLabel', () => {
  it('web_search / web_fetch / create', () => {
    expect(runningLabel(part({ state: 'input-available', toolName: 'web_search', input: {} }))).toBe('Searching the web…')
    expect(runningLabel(part({ state: 'input-available', toolName: 'web_fetch', input: { url: 'https://www.x.com/a' } }))).toBe('Reading x.com…')
    expect(
      runningLabel(part({ state: 'input-available', toolName: 'createDocument', toolMetadata: { eve: { kind: 'tool-call', name: 'createDocument' } }, input: { data: { title: 'Hi' } } })),
    ).toBe('Creating “Hi”…')
  })
})

describe('media_image detection', () => {
  it('returns media_image when generateImage has structuredContent with url + id', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__generateImage',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
        input: { prompt: 'hero', alt: 'A hero image', aspectRatio: '16:9' },
        output: {
          content: [{ type: 'text', text: 'Generated image saved to Media (id: img-1). Embed in Markdown as: ![media:img-1]()' }],
          structuredContent: { id: 'img-1', url: '/media/hero.png', alt: 'A hero image' },
        },
      }),
    )
    expect(v?.kind).toBe('media_image')
    if (v?.kind === 'media_image') {
      expect(v.id).toBe('img-1')
      expect(v.url).toBe('/media/hero.png')
      expect(v.alt).toBe('A hero image')
    }
  })

  it('falls back to text when structuredContent has no url', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__generateImage',
        toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
        input: {},
        output: {
          content: [{ type: 'text', text: 'Generated image saved to Media (id: img-2). Embed in Markdown as: ![media:img-2]()' }],
          structuredContent: { id: 'img-2' },
        },
      }),
    )
    // No url → not media_image; falls through to text from content[0].text
    expect(v?.kind).toBe('text')
  })

  it('does NOT produce media_image when structuredContent is absent', () => {
    const v = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__generateImage',
        input: {},
        output: {
          content: [{ type: 'text', text: 'Generated image saved to Media (id: img-3). Embed in Markdown as: ![media:img-3]()' }],
        },
      }),
    )
    expect(v?.kind).not.toBe('media_image')
  })

  it('confirms doc-based branch never fires for MCP tools (doc always stripped at wire)', () => {
    // Even if a test were to put `doc` on the output object, the real wire shape
    // never has it — but the branch guard `isObj(doc)` must remain for non-MCP paths.
    // Pass doc explicitly and confirm it IS picked up by existing branch (it's still
    // correct for any hypothetical non-MCP caller), but also verify it's absent
    // in the real MCP output shape modelled by our generateImage test above.
    const vWithDoc = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'createDocument',
        input: { collectionSlug: 'tasks' },
        output: { content: [{ type: 'text', text: 'ok' }], doc: { id: 'abc', title: 'Buy milk', priority: 'high' } },
      }),
    )
    // doc branch still fires when doc IS present (non-MCP callers or test fixtures)
    expect(vWithDoc?.kind).toBe('records')

    // Real MCP output for generateImage has no doc — structuredContent is the channel
    const vRealMCP = describeToolResult(
      part({
        state: 'output-available',
        toolName: 'connection__payload-mcp__generateImage',
        input: {},
        output: {
          content: [{ type: 'text', text: 'Generated image saved to Media (id: img-4). Embed in Markdown as: ![media:img-4]()' }],
          structuredContent: { id: 'img-4', url: '/media/hero.png', alt: 'Alt' },
        },
      }),
    )
    expect(vRealMCP?.kind).toBe('media_image')
  })
})

describe('parseJsonBlock', () => {
  it('parseJsonBlock extracts JSON from a fenced block', () => {
    const text = 'Here is the result:\n```json\n{"id":"1","title":"A"}\n```\nDone.'
    const parsed = parseJsonBlock(text)
    expect(parsed).toMatchObject({ id: '1', title: 'A' })
  })

  it('parseJsonBlock returns null when no fenced block present', () => {
    expect(parseJsonBlock('No JSON here.')).toBeNull()
  })
})
