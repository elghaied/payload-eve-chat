'use client'

import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** Shown while a turn is in flight before the first token/tool event arrives. */
export function ThinkingIndicator() {
  return (
    <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm" role="status">
      <Spinner />
      <span>Eve is thinking…</span>
    </div>
  )
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
