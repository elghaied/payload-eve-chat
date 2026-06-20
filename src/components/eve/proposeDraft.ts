import type { EveMessage } from 'eve/react'
import type { PostDraft } from '@/eve/approval-message'

/**
 * Scans the last assistant message in `messages` for an `output-available`
 * `propose_post` dynamic-tool part and returns `{ id, draft }` when found,
 * or `null` when none is present.
 *
 * Kept as a pure function (no React state) so it can be unit-tested without
 * a live agent — EveChat calls it inside a `useEffect` to open the preview panel.
 */
export function findOpenableDraft(
  messages: readonly EveMessage[],
): { id: string; draft: PostDraft } | null {
  // Walk messages in reverse to find the latest assistant message.
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi]
    if (msg.role !== 'assistant') continue

    for (const part of msg.parts) {
      if (part.type !== 'dynamic-tool') continue
      if (part.toolName !== 'propose_post') continue
      if (part.state !== 'output-available') continue

      // part.output is `unknown` — validate it has the expected shape.
      const raw = part.output as Record<string, unknown> | null | undefined
      if (!raw || typeof raw !== 'object') continue

      const title = raw['title']
      const status = raw['status']
      const markdown = raw['markdown']

      if (
        typeof title !== 'string' ||
        title.trim() === '' ||
        (status !== 'draft' && status !== 'published') ||
        typeof markdown !== 'string' ||
        markdown.trim() === ''
      ) {
        continue
      }

      return {
        id: part.toolCallId,
        draft: { title, status, markdown },
      }
    }

    // Only inspect the latest assistant message.
    break
  }

  return null
}
