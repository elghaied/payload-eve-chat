import { describe, expect, it } from 'vitest'
import { proposePost } from './propose-tool'

describe('proposePost', () => {
  it('echoes the draft, performing no side effects', async () => {
    const draft = { title: 'Hello World', status: 'draft' as const, markdown: '# Hi\n\nBody.' }
    // AI SDK passes (input, { toolCallId, messages, abortSignal }); a stub is fine here.
    const out = await proposePost.execute!(draft, { toolCallId: 't1', messages: [] } as never)
    expect(out).toEqual(draft)
  })

  it('defaults status to draft', async () => {
    const parsed = (proposePost.inputSchema as any).parse({ title: 'T', markdown: 'B' })
    expect(parsed.status).toBe('draft')
  })
})
