'use client'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'

export type ReasoningProps = {
  text: string
  isStreaming?: boolean
}

/**
 * Collapsible "thinking" disclosure for a model's reasoning/chain-of-thought.
 * Collapsed by default so reasoning never clutters the conversation; click to
 * expand. Reasoning arrives as `reasoning` UI parts (see extractReasoningMiddleware
 * in src/eve/provider.ts, which lifts <think>…</think> out of the answer text).
 */
export const Reasoning = ({ text, isStreaming }: ReasoningProps) => {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible className="not-prose w-full" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
        <span>{isStreaming ? 'Thinking…' : 'Show reasoning'}</span>
        <ChevronDownIcon className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-muted-foreground text-sm">
        {text}
      </CollapsibleContent>
    </Collapsible>
  )
}
