'use client'

import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** Shown while a turn is in flight and nothing else is visibly progressing. */
export function ThinkingIndicator() {
  return (
    <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm" role="status">
      <Spinner />
      <span>Eve is working…</span>
    </div>
  )
}

type MinimalPart = { type: string; text?: string; state?: string }
type MinimalMessage = { role: string; parts: readonly MinimalPart[] }

/**
 * Whether to show the working indicator. Eve's turn can go silent between visible outputs —
 * e.g. after a tool result while the model generates the next step (no streaming text, no
 * running tool card) — which looks like the chat froze. Show the indicator whenever Eve is
 * busy AND nothing else is already signalling progress:
 *   - a running tool renders its own spinner (skip — avoid a double spinner),
 *   - visible assistant text is itself the progress signal (skip),
 *   - otherwise (waiting for the first output, or a silent between-steps gap) → show it.
 */
export function showWorkingIndicator(args: {
  status: string
  stalled: boolean
  messages: readonly MinimalMessage[]
}): boolean {
  const { status, stalled, messages } = args
  const busy = status === 'submitted' || status === 'streaming'
  if (!busy || stalled) return false

  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return true // just submitted / waiting for the reply

  const toolRunning = last.parts.some(
    (p) => p.type === 'dynamic-tool' && (p.state === 'input-streaming' || p.state === 'input-available'),
  )
  if (toolRunning) return false

  const hasVisibleText = last.parts.some(
    (p) => p.type === 'text' && (p.text ?? '').trim().length > 0,
  )
  return !hasVisibleText
}

/**
 * Shown when a turn ends in a terminal error (`agent.status === "error"`), which previously
 * rendered nothing — the reply just silently stopped (e.g. an expired AI Gateway token).
 */
export function ErrorNotice({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      role="alert"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-destructive">Something went wrong</div>
        <div className="break-words text-muted-foreground">
          {message || 'The request failed. Please try again.'}
        </div>
        {onRetry && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            <RotateCcwIcon className="size-3.5" />
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}
