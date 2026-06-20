import { describe, expect, it } from 'vitest'
import type { EveMessage } from 'eve/react'
import { findOpenableDraft } from './proposeDraft'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProposePart(
  state: string,
  output: unknown = { title: 'My Post', status: 'draft', markdown: '# Hi' },
) {
  return {
    type: 'dynamic-tool' as const,
    toolName: 'propose_post',
    toolCallId: 'tc-1',
    state,
    input: { title: 'My Post', status: 'draft', markdown: '# Hi' },
    ...(state === 'output-available' ? { output } : {}),
  }
}

function assistantMessage(parts: EveMessage['parts']): EveMessage {
  return { id: 'msg-1', role: 'assistant', parts }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('findOpenableDraft', () => {
  it('returns null for empty messages', () => {
    expect(findOpenableDraft([])).toBeNull()
  })

  it('returns null when the last message is a user message', () => {
    const messages: EveMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'write a post' }] },
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when no dynamic-tool part is present', () => {
    const messages: EveMessage[] = [
      assistantMessage([{ type: 'text', text: 'Here is the post…' }]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when the part is a different tool name', () => {
    const messages: EveMessage[] = [
      assistantMessage([
        {
          type: 'dynamic-tool',
          toolName: 'web_search',
          toolCallId: 'tc-x',
          state: 'output-available',
          input: {},
          output: { results: [] },
        } as unknown as EveMessage['parts'][number],
      ]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when propose_post state is input-streaming (not yet complete)', () => {
    const messages: EveMessage[] = [
      assistantMessage([makeProposePart('input-streaming') as unknown as EveMessage['parts'][number]]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when propose_post state is input-available (not yet executed)', () => {
    const messages: EveMessage[] = [
      assistantMessage([makeProposePart('input-available') as unknown as EveMessage['parts'][number]]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns { id, draft } when state is output-available with valid output', () => {
    const messages: EveMessage[] = [
      assistantMessage([makeProposePart('output-available') as unknown as EveMessage['parts'][number]]),
    ]
    const result = findOpenableDraft(messages)
    expect(result).toEqual({
      id: 'tc-1',
      draft: { title: 'My Post', status: 'draft', markdown: '# Hi' },
    })
  })

  it('returns null when output is missing required fields', () => {
    const messages: EveMessage[] = [
      assistantMessage([
        makeProposePart('output-available', { title: '', status: 'draft', markdown: '# Hi' }) as unknown as EveMessage['parts'][number],
      ]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when markdown is empty', () => {
    const messages: EveMessage[] = [
      assistantMessage([
        makeProposePart('output-available', { title: 'T', status: 'draft', markdown: '' }) as unknown as EveMessage['parts'][number],
      ]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('returns null when status is invalid', () => {
    const messages: EveMessage[] = [
      assistantMessage([
        makeProposePart('output-available', { title: 'T', status: 'pending', markdown: '# B' }) as unknown as EveMessage['parts'][number],
      ]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('only inspects the latest assistant message', () => {
    // Earlier message has a valid propose_post; latest assistant has no such part.
    const messages: EveMessage[] = [
      assistantMessage([makeProposePart('output-available') as unknown as EveMessage['parts'][number]]),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'looks good' }] },
      assistantMessage([{ type: 'text', text: 'Great!' }]),
    ]
    expect(findOpenableDraft(messages)).toBeNull()
  })

  it('finds the propose_post in the latest assistant message even with prior messages', () => {
    const messages: EveMessage[] = [
      assistantMessage([{ type: 'text', text: 'Old message' }]),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'write a post' }] },
      assistantMessage([makeProposePart('output-available') as unknown as EveMessage['parts'][number]]),
    ]
    const result = findOpenableDraft(messages)
    expect(result?.id).toBe('tc-1')
    expect(result?.draft.title).toBe('My Post')
  })
})
