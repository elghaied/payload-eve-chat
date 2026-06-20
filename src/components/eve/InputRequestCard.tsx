'use client'

import { useState } from 'react'
import { CheckIcon, MessageCircleQuestionIcon, SendIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { EveMessageInputRequest } from 'eve/react'
import type { InputResponseValue } from './inputRequest'

type OptionStyle = 'danger' | 'default' | 'primary'

function variantForStyle(style?: OptionStyle): 'default' | 'destructive' | 'outline' {
  if (style === 'primary') return 'default'
  if (style === 'danger') return 'destructive'
  return 'outline'
}

export type InputRequestCardProps = {
  request: EveMessageInputRequest
  /** Set once answered — renders a compact read-only summary instead of controls. */
  answered?: { optionId?: string; text?: string } | null
  /** Disable controls while a response is in flight. */
  busy?: boolean
  onRespond: (response: InputResponseValue) => void
}

/**
 * Interactive UI for an Eve human-in-the-loop request (the `ask_question` tool or any
 * `needsApproval` confirmation). Renders the prompt, clickable option buttons, and — when
 * `allowFreeform`/`display:"text"` — a free-text answer box. Without this, such requests
 * stall as a raw-JSON "Awaiting Approval" tool card with no way to respond.
 */
export function InputRequestCard({ request, answered, busy, onRespond }: InputRequestCardProps) {
  const [text, setText] = useState('')

  const isConfirmation = request.display === 'confirmation'
  const allowText = Boolean(request.allowFreeform) || request.display === 'text'
  const options = request.options ?? []
  const disabled = Boolean(busy) || Boolean(answered)

  const submitText = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onRespond({ requestId: request.requestId, text: trimmed })
    setText('')
  }

  if (answered) {
    const chosen = answered.optionId
      ? (options.find((o) => o.id === answered.optionId)?.label ?? answered.optionId)
      : answered.text
    return (
      <div className="mb-4 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="mb-1 flex items-center gap-2 text-muted-foreground">
          <CheckIcon className="size-4 shrink-0" />
          <span className="whitespace-pre-wrap">{request.prompt}</span>
        </div>
        {chosen && (
          <div className="pl-6 text-foreground">
            You answered: <strong>{chosen}</strong>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-lg border border-primary/40 bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-sm">
        {isConfirmation ? (
          <ShieldCheckIcon className="size-4 text-primary" />
        ) : (
          <MessageCircleQuestionIcon className="size-4 text-primary" />
        )}
        <span>{isConfirmation ? 'Approval needed' : 'Eve has a question'}</span>
      </div>

      <p className="mb-3 whitespace-pre-wrap text-foreground text-sm">{request.prompt}</p>

      {options.length > 0 && (
        <div className={cn('mb-3 gap-2', isConfirmation ? 'flex flex-wrap' : 'grid')}>
          {options.map((o) => (
            <Button
              key={o.id}
              type="button"
              variant={variantForStyle(o.style)}
              disabled={disabled}
              onClick={() => onRespond({ requestId: request.requestId, optionId: o.id })}
              className={cn(
                'h-auto py-2',
                isConfirmation ? 'justify-center' : 'justify-start text-left',
              )}
            >
              <span className="flex flex-col items-start">
                <span className="font-medium">{o.label}</span>
                {o.description && (
                  <span className="font-normal text-xs opacity-70">{o.description}</span>
                )}
              </span>
            </Button>
          ))}
        </div>
      )}

      {allowText && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitText()
          }}
        >
          <Textarea
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitText()
              }
            }}
            placeholder={options.length ? 'Or type your own answer…' : 'Type your answer…'}
            rows={1}
            className="min-h-9 flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={disabled || !text.trim()}
            aria-label="Send answer"
          >
            <SendIcon className="size-4" />
          </Button>
        </form>
      )}
    </div>
  )
}
