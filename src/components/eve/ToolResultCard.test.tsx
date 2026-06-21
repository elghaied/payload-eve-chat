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

  it('renders a media_image card with inline image and admin link', () => {
    const { container } = render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: { prompt: 'hero', alt: 'A hero image', aspectRatio: '16:9' },
          output: {
            content: [{ type: 'text', text: 'Generated image saved to Media (id: img-42). Embed in Markdown as: ![media:img-42]()' }],
            structuredContent: { id: 'img-42', url: '/media/hero.png', alt: 'A hero image' },
          },
        })}
      />,
    )
    // Inline image
    const img = container.querySelector('img') as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/media/hero.png')
    expect(img.getAttribute('alt')).toBe('A hero image')
    // Admin link
    const link = screen.getByRole('link', { name: /View in admin/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/admin/collections/media/img-42')
    // No JSON dump
    expect(container.textContent).not.toContain('structuredContent')
    expect(container.querySelector('pre')).toBeNull()
  })

  it('shows generating label while generateImage runs', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'input-available',
          toolName: 'connection__payload-mcp__generateImage',
          toolMetadata: { eve: { kind: 'tool-call', name: 'connection__payload-mcp__generateImage' } },
          input: { prompt: 'hero', alt: 'A hero', aspectRatio: '16:9' },
        })}
      />,
    )
    expect(screen.getByText('Generating image…')).toBeTruthy()
  })
})

describe('ToolResultCard — photo_search', () => {
  it('renders a thumbnail grid with photographer attribution links', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'searchPhotos',
          input: { query: 'cats', perPage: 6 },
          output: {
            content: [{ type: 'text', text: 'Found 2 photos.' }],
            structuredContent: {
              photos: [
                { photoId: 'abc', description: 'fluffy cat', thumbUrl: 'https://images.unsplash.com/thumb1', photographer: 'Jane Doe', photographerUrl: 'https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/abc' },
                { photoId: 'def', description: 'orange tabby', thumbUrl: 'https://images.unsplash.com/thumb2', photographer: 'Bob Smith', photographerUrl: 'https://unsplash.com/@bob?utm_source=payload-eve-chat&utm_medium=referral', unsplashUrl: 'https://unsplash.com/photos/def' },
              ],
            },
          },
        })}
      />,
    )
    // Thumbnails rendered as images
    const imgs = document.querySelectorAll('img')
    const thumbSrcs = Array.from(imgs).map((img) => img.getAttribute('src'))
    expect(thumbSrcs).toContain('https://images.unsplash.com/thumb1')
    expect(thumbSrcs).toContain('https://images.unsplash.com/thumb2')
    // Photographer attribution links
    const janeLink = screen.getByRole('link', { name: /Jane Doe/ }) as HTMLAnchorElement
    expect(janeLink.href).toContain('utm_source=payload-eve-chat')
    expect(janeLink.getAttribute('target')).toBe('_blank')
    // No raw JSON
    expect(document.body.textContent).not.toContain('photoId')
  })

  it('shows "No photos found" when results are empty', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'searchPhotos',
          input: { query: 'nothing', perPage: 6 },
          output: {
            content: [{ type: 'text', text: 'Found 0.' }],
            structuredContent: { photos: [] },
          },
        })}
      />,
    )
    expect(screen.getByText(/No photos found/i)).toBeTruthy()
  })

  it('shows "Searching Unsplash…" while running', () => {
    render(<ToolResultCard part={part({ state: 'input-available', toolName: 'searchPhotos', input: { query: 'cats' } })} />)
    expect(screen.getByText('Searching Unsplash…')).toBeTruthy()
  })
})

describe('ToolResultCard — media_image with credit', () => {
  it('renders the credit line when credit is present', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'addPhotoToMedia',
          input: { photoId: 'abc', alt: 'mountain lake' },
          output: {
            content: [{ type: 'text', text: 'Saved.' }],
            structuredContent: { id: 'media-1', url: '/media/unsplash-abc.jpg', alt: 'mountain lake', credit: 'Jane Doe', creditUrl: 'https://unsplash.com/@jane?utm_source=payload-eve-chat&utm_medium=referral' },
          },
        })}
      />,
    )
    const creditLink = screen.getByRole('link', { name: /Jane Doe/ }) as HTMLAnchorElement
    expect(creditLink.href).toContain('utm_source=payload-eve-chat')
    expect(creditLink.getAttribute('target')).toBe('_blank')
    expect(screen.getByText(/Unsplash/)).toBeTruthy()
  })

  it('renders media_image WITHOUT credit when generateImage (backward-compat)', () => {
    render(
      <ToolResultCard
        part={part({
          state: 'output-available',
          toolName: 'generateImage',
          input: { prompt: 'hero', alt: 'hero image' },
          output: {
            content: [{ type: 'text', text: 'done' }],
            structuredContent: { id: 'img-1', url: '/media/hero.png', alt: 'hero image' },
          },
        })}
      />,
    )
    // Should not have an Unsplash credit line
    expect(document.body.textContent).not.toContain('Unsplash')
  })
})
