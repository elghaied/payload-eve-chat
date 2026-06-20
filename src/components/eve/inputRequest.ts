import type { EveDynamicToolPart, EveMessageInputRequest } from 'eve/react'

/** A response the user submits to a pending HITL input request. */
export type InputResponseValue = {
  requestId: string
  optionId?: string
  text?: string
}

/** A pending (or answered) human-in-the-loop input request extracted from a tool part. */
export type PendingInput = {
  request: EveMessageInputRequest
  /** Non-null once the user has answered (the part moved to `approval-responded`). */
  answered: { optionId?: string; text?: string } | null
}

/**
 * Extract a HITL input request (Eve's `ask_question` or any `needsApproval` tool) from a
 * dynamic-tool part, or null if the part isn't a pending/answered input request.
 *
 * Pure + framework-typed so it can be unit-tested with fixtures and so EveChat can decide
 * whether to render the interactive {@link InputRequestCard} instead of a raw tool card.
 */
export function getPendingInput(part: EveDynamicToolPart): PendingInput | null {
  const meta = part.toolMetadata?.eve
  const request = meta?.inputRequest
  if (!request) return null
  if (part.state !== 'approval-requested' && part.state !== 'approval-responded') return null

  const response = meta?.inputResponse
  const answered =
    part.state === 'approval-responded' && response
      ? { optionId: response.optionId, text: response.text }
      : null

  return { request, answered }
}

/**
 * Turn a tool slug into a human-readable label for tool-card headers.
 * `ask_question` -> "Ask question", `findDocuments` -> "Find documents",
 * `propose_post` -> "Propose post".
 */
export function humanizeToolName(name: string): string {
  if (!name) return 'Tool'
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return 'Tool'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}
