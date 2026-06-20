import { describe, expect, it } from 'vitest'
import type { EveDynamicToolPart } from 'eve/react'
import {
  adminHref,
  collectionSlugOf,
  describeToolResult,
  hostOf,
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

  it('falls back to text for an MCP result with no doc', () => {
    const v = describeToolResult(
      part({ state: 'output-available', toolName: 'findDocuments', input: {}, output: { content: [{ type: 'text', text: 'Not found' }] } }),
    )
    expect(v).toMatchObject({ kind: 'text', text: 'Not found' })
  })

  it('falls back to json for unknown structured output', () => {
    const v = describeToolResult(part({ state: 'output-available', toolName: 'mystery', input: {}, output: { foo: 1 } }))
    expect(v?.kind).toBe('json')
    if (v?.kind === 'json') expect(v.json).toContain('"foo": 1')
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
