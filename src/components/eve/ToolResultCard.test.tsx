import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { EveDynamicToolPart } from 'eve/react'
import { ToolResultCard } from './ToolResultCard'

afterEach(cleanup)

function part(over: Record<string, unknown>): EveDynamicToolPart {
  return { type: 'dynamic-tool', toolCallId: 'c', toolName: 't', ...over } as unknown as EveDynamicToolPart
}

describe('ToolResultCard', () => {
  it('renders web_search results as clickable links', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'web_search',
          output: [{ type: 'web_search_result', url: 'https://deepgram.com/pricing', title: 'Deepgram Pricing', pageAge: null }],
        })}
      />,
    )
    const link = screen.getByRole('link', { name: /Deepgram Pricing/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://deepgram.com/pricing')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('renders a created MCP record with an admin link', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'createDocument',
          toolMetadata: { eve: { kind: 'tool-call', name: 'createDocument' } },
          input: { collectionSlug: 'tasks' },
          output: { content: [{ type: 'text', text: 'ok' }], doc: { id: 'xyz', title: 'Ship it', done: false } },
        })}
      />,
    )
    expect(screen.getByText(/Created/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Ship it' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/admin/collections/tasks/xyz')
  })

  it('shows a running label while the tool executes (no raw JSON)', () => {
    render(<ToolResultCard part={part({ state: 'input-available', toolName: 'web_search', input: {} })} />)
    expect(screen.getByText('Searching the web…')).toBeTruthy()
  })

  it('shows an error state', () => {
    render(
      <ToolResultCard
        part={part({ state: 'output-error', toolName: 'web_fetch', input: { url: 'x' }, errorText: 'boom' })}
      />,
    )
    expect(screen.getByText(/failed/)).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('renders unknown structured output as a clean done line — never raw JSON', () => {
    const { container } = render(
      <ToolResultCard part={part({ state: 'output-available', toolName: 'mystery', output: { a: 1 } })} />,
    )
    // No JSON dump anywhere.
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toContain('{')
    expect(screen.getByText(/completed/)).toBeTruthy()
  })

  it('renders connection_search discovery as a summary, not a schema dump', () => {
    const { container } = render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'connection__search',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__search' } },
          output: [
            { connection: 'payload-mcp', tool: 'createDocument', description: 'Create a document' },
          ],
        })}
      />,
    )
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toContain('inputSchema')
    expect(screen.getByText(/Found 1 tool/)).toBeTruthy()
  })

  it('renders the todo list as a checklist, not raw JSON', () => {
    const { container } = render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'todo',
          toolMetadata: { eve: { kind: 'tool-call', name: 'todo' } },
          output: {
            counts: { cancelled: 0, completed: 1, in_progress: 0, pending: 1, total: 2 },
            todos: [
              { content: 'Outline the article', status: 'completed', priority: 'high' },
              { content: 'Write the draft', status: 'pending', priority: 'medium' },
            ],
          },
        })}
      />,
    )
    expect(container.querySelector('pre')).toBeNull()
    expect(screen.getByText('Outline the article')).toBeTruthy()
    expect(screen.getByText('Write the draft')).toBeTruthy()
  })
})
