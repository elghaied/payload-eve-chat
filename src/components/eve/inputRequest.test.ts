import { describe, expect, it } from 'vitest'
import type { EveDynamicToolPart } from 'eve/react'
import { getPendingInput, humanizeToolName } from './inputRequest'

const request = {
  requestId: 'req-1',
  prompt: 'What do you want?',
  display: 'select' as const,
  allowFreeform: true,
  options: [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B', description: 'the second one', style: 'primary' as const },
  ],
}

function part(over: Record<string, unknown>): EveDynamicToolPart {
  return {
    type: 'dynamic-tool',
    toolCallId: 'call-1',
    toolName: 'ask_question',
    ...over,
  } as unknown as EveDynamicToolPart
}

describe('getPendingInput', () => {
  it('returns the request (unanswered) for an approval-requested part', () => {
    const result = getPendingInput(
      part({ state: 'approval-requested', input: {}, toolMetadata: { eve: { kind: 'tool-call', name: 'ask_question', inputRequest: request } } }),
    )
    expect(result).not.toBeNull()
    expect(result?.request.requestId).toBe('req-1')
    expect(result?.answered).toBeNull()
  })

  it('returns the answer for an approval-responded part (optionId)', () => {
    const result = getPendingInput(
      part({
        state: 'approval-responded',
        input: {},
        toolMetadata: {
          eve: {
            kind: 'tool-call',
            name: 'ask_question',
            inputRequest: request,
            inputResponse: { requestId: 'req-1', optionId: 'b' },
          },
        },
      }),
    )
    expect(result?.answered).toEqual({ optionId: 'b', text: undefined })
  })

  it('returns the answer for an approval-responded part (freeform text)', () => {
    const result = getPendingInput(
      part({
        state: 'approval-responded',
        input: {},
        toolMetadata: {
          eve: { kind: 'tool-call', name: 'ask_question', inputRequest: request, inputResponse: { requestId: 'req-1', text: 'hello' } },
        },
      }),
    )
    expect(result?.answered).toEqual({ optionId: undefined, text: 'hello' })
  })

  it('returns null when the part has no inputRequest', () => {
    expect(
      getPendingInput(part({ state: 'output-available', input: {}, output: {}, toolMetadata: { eve: { kind: 'tool-call', name: 'findDocuments' } } })),
    ).toBeNull()
  })

  it('returns null for a non-approval state even if an inputRequest is present', () => {
    expect(
      getPendingInput(part({ state: 'input-available', input: {}, toolMetadata: { eve: { kind: 'tool-call', name: 'ask_question', inputRequest: request } } })),
    ).toBeNull()
  })
})

describe('humanizeToolName', () => {
  it('humanizes snake_case', () => {
    expect(humanizeToolName('ask_question')).toBe('Ask question')
    expect(humanizeToolName('propose_post')).toBe('Propose post')
  })
  it('humanizes camelCase', () => {
    expect(humanizeToolName('findDocuments')).toBe('Find documents')
  })
  it('falls back for empty input', () => {
    expect(humanizeToolName('')).toBe('Tool')
  })
})
