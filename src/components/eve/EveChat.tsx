'use client'
import React, { useCallback, useRef, useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { useEveAgent } from 'eve/react'
import type { EveDynamicToolPart } from 'eve/react'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Reasoning } from '@/components/ai-elements/reasoning'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import './eve.css'

export { type ConversationSummary }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EveChatProps {
  conversations: ConversationSummary[]
  activeId?: string
  initialSession?: { sessionId?: string; continuationToken?: string; streamIndex: number }
  initialEvents?: unknown[]
}

// ── Session persistence helper ────────────────────────────────────────────────

async function persistSession(opts: {
  sessionId: string
  continuationToken?: string
  streamIndex: number
  title?: string
}) {
  try {
    await fetch('/api/eve/session-index', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    })
  } catch {
    // Best-effort — don't break the chat on network failure.
  }
}

// ── Tool part renderer ────────────────────────────────────────────────────────

function renderToolPart(part: EveDynamicToolPart, key: string): React.ReactNode {
  const output =
    part.state === 'output-available' ? (
      <ToolOutput output={part.output} errorText={undefined} />
    ) : part.state === 'output-error' ? (
      <ToolOutput output={undefined} errorText={part.errorText} />
    ) : null

  return (
    <Tool key={key}>
      <ToolHeader type="dynamic-tool" toolName={part.toolName} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />
        {output}
      </ToolContent>
    </Tool>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export const EveChat: React.FC<EveChatProps> = ({
  conversations,
  activeId,
  initialSession,
  initialEvents,
}) => {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [sidebarConversations, setSidebarConversations] = useState(conversations)

  // Track the title for the current thread (first user message).
  const titleRef = useRef<string | undefined>(undefined)

  const onSessionChange = useCallback(
    (session: { sessionId?: string; continuationToken?: string; streamIndex: number }) => {
      if (!session.sessionId) return
      void persistSession({
        sessionId: session.sessionId,
        continuationToken: session.continuationToken,
        streamIndex: session.streamIndex,
        title: titleRef.current,
      })
    },
    [],
  )

  // Same-origin + cookie auth is automatic. No host/auth needed.
  const agent = useEveAgent({
    initialSession: initialSession as { sessionId?: string; continuationToken?: string; streamIndex: number } | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialEvents: initialEvents as any,
    onSessionChange,
    onFinish: (snapshot) => {
      const sid = snapshot.session.sessionId
      if (!sid) return
      void persistSession({
        sessionId: sid,
        continuationToken: snapshot.session.continuationToken,
        streamIndex: snapshot.session.streamIndex,
        title: titleRef.current,
      })
    },
  })

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text) return
    setInput('')

    const isNew = !activeId && !agent.session.sessionId
    // Capture the first user message as the title for a new thread.
    if (isNew && !titleRef.current) {
      titleRef.current = text.slice(0, 80)
    }

    await agent.send({ message: text })

    // After send resolves for a brand-new chat, push the new sessionId into
    // the URL so follow-ups persist to the same thread.
    if (isNew) {
      const sid = agent.session.sessionId
      if (sid) {
        setSidebarConversations((prev) =>
          prev.some((c) => c.id === sid)
            ? prev
            : [{ id: sid, title: titleRef.current ?? text.slice(0, 80) }, ...prev],
        )
        router.push(`?conversation=${sid}`)
      }
    }
  }

  return (
    <div className="eve-scope flex h-[calc(100dvh-var(--app-header-height,48px))] min-h-[600px]">
      <ConversationSidebar
        conversations={sidebarConversations}
        activeId={activeId}
        onSelect={(id) => router.push(`?conversation=${id}`)}
        onNew={() => router.push('?')}
      />
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <Conversation className="flex-1">
          <ConversationContent>
            {agent.data.messages.length === 0 ? (
              <ConversationEmptyState
                title="Chat with Eve"
                description="Ask Eve to create a post or manage your tasks."
              />
            ) : (
              agent.data.messages.map((m, index) => {
                const messageKey = m.id || `message-${index}`
                return (
                  <Message from={m.role} key={messageKey}>
                    <MessageContent>
                      {m.parts.map((part, i) => {
                        const partKey = `${messageKey}-${i}`

                        if (part.type === 'text') {
                          return (
                            <MessageResponse key={partKey}>{part.text}</MessageResponse>
                          )
                        }

                        if (part.type === 'reasoning') {
                          return (
                            <Reasoning
                              key={partKey}
                              text={part.text}
                              isStreaming={part.state === 'streaming'}
                            />
                          )
                        }

                        if (part.type === 'dynamic-tool') {
                          return renderToolPart(part, partKey)
                        }

                        // step-start: no visible output
                        return null
                      })}
                    </MessageContent>
                  </Message>
                )
              })
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput onSubmit={handleSubmit} className="mt-3">
          <PromptInputTextarea
            value={input}
            placeholder="Message Eve…"
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <PromptInputFooter>
            <PromptInputSubmit
              status={agent.status}
              onStop={agent.stop}
              disabled={
                agent.status !== 'streaming' && agent.status !== 'submitted' && !input.trim()
              }
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
