'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { useEveAgent } from 'eve/react'
import type { EveDynamicToolPart } from 'eve/react'
import { SquareIcon } from 'lucide-react'
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
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import { ToolResultCard } from './ToolResultCard'
import { Reasoning } from '@/components/ai-elements/reasoning'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import { InputRequestCard } from './InputRequestCard'
import { ThinkingIndicator, ErrorNotice } from './ChatStatus'
import { getPendingInput, type InputResponseValue } from './inputRequest'
import { VoiceButton } from './VoiceButton'
import { useVoice } from './useVoice'
import { removeSpeakTags } from './speakable'
import './eve.css'

// ── Voice constants ───────────────────────────────────────────────────────────

/**
 * Ephemeral clientContext injected on every voice turn.
 * Eve should reply naturally for a spoken conversation and wrap the portion to
 * be spoken aloud in <speak>…</speak>, keeping it concise. The rest of the reply
 * (detail, links, code) still streams to the chat window.
 */
const VOICE_REPLY_INSTRUCTION =
  'This is a spoken voice conversation. Use tools (search, create, find, update) when needed — ' +
  'actually call them, do not just say you will. Begin your reply with a one- or two-sentence ' +
  'spoken summary wrapped in <speak>…</speak> (ONLY that is read aloud), then add any extra ' +
  'detail after it. Keep the spoken summary plain — no Markdown, lists, code, or emoji.'

export { type ConversationSummary }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionCursor {
  sessionId?: string
  continuationToken?: string
  streamIndex: number
}

export interface EveChatProps {
  conversations: ConversationSummary[]
  activeId?: string
  initialSession?: SessionCursor
  initialEvents?: unknown[]
  /** True when DEEPGRAM_API_KEY is set server-side (read by EveView RSC). */
  voiceAvailable?: boolean
}

// ── Session persistence helper ────────────────────────────────────────────────

async function persistSession(opts: {
  sessionId: string
  continuationToken?: string
  streamIndex: number
  title?: string
}) {
  try {
    const res = await fetch('/api/eve/session-index', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      // The route's field is `eveSessionId` (not `sessionId`) — map it explicitly.
      body: JSON.stringify({
        eveSessionId: opts.sessionId,
        continuationToken: opts.continuationToken,
        streamIndex: opts.streamIndex,
        title: opts.title,
      }),
    })
    if (!res.ok) {
      console.warn(`[eve] session-index persist failed: ${res.status}`)
    }
  } catch (err) {
    // Best-effort — don't break the chat on network failure, but surface it.
    console.warn('[eve] session-index persist error', err)
  }
}

// ── History replay ────────────────────────────────────────────────────────────
// Eve's replay endpoint streams all past events from startIndex then STAYS OPEN
// waiting for new ones, so we read until we've collected the known event count
// (the stored cursor's streamIndex) or hit a hard time cap, then abort. The
// collected events seed useEveAgent's initialEvents so a reopened thread renders
// its history.
const REPLAY_TIME_CAP_MS = 15_000

async function replaySessionEvents(sessionId: string, targetCount: number): Promise<unknown[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), REPLAY_TIME_CAP_MS)
  const events: unknown[] = []
  try {
    const res = await fetch(
      `/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=0`,
      { credentials: 'same-origin', signal: ac.signal },
    )
    if (!res.ok || !res.body) return events
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    // Read NDJSON lines until we've caught up to the stored event count.
    while (events.length < targetCount) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          events.push(JSON.parse(line))
        } catch {
          // ignore a partial/garbage line
        }
        if (events.length >= targetCount) break
      }
    }
    await reader.cancel().catch(() => {})
  } catch {
    // aborted or network error — return whatever we collected (possibly empty)
  } finally {
    clearTimeout(timer)
  }
  return events
}

// ── Tool part renderer ────────────────────────────────────────────────────────

function renderToolPart(
  part: EveDynamicToolPart,
  key: string,
  opts: {
    onRespondInput?: (response: InputResponseValue) => void
    busy?: boolean
  } = {},
): React.ReactNode {
  // Interactive human-in-the-loop request (Eve's `ask_question` or any `needsApproval`
  // tool): render the InputRequestCard so the user can actually answer, instead of
  // leaving a raw-JSON "Awaiting Approval" card with no controls.
  const pending = getPendingInput(part)
  if (pending) {
    return (
      <InputRequestCard
        key={key}
        request={pending.request}
        answered={pending.answered}
        busy={opts.busy}
        onRespond={(r) => opts.onRespondInput?.(r)}
      />
    )
  }

  // Purpose-built result UI (clickable search links, fetched-URL preview, "Created task →
  // admin link", etc.) for every other tool state — never a raw-JSON dump.
  return <ToolResultCard key={key} part={part} />
}

// ── Loader: replay history (when reopening a thread) before mounting the hook ───

export const EveChat: React.FC<EveChatProps> = (props) => {
  const { activeId, initialSession, initialEvents, voiceAvailable = false } = props

  // A reopened thread needs its history replayed unless events were already provided.
  const needsReplay =
    !initialEvents &&
    !!activeId &&
    !!initialSession?.sessionId &&
    (initialSession?.streamIndex ?? 0) > 0

  const [events, setEvents] = useState<unknown[] | null>(
    initialEvents ?? (needsReplay ? null : []),
  )

  useEffect(() => {
    if (!needsReplay) return
    let cancelled = false
    void replaySessionEvents(initialSession!.sessionId!, initialSession!.streamIndex).then(
      (collected) => {
        if (!cancelled) setEvents(collected)
      },
    )
    return () => {
      cancelled = true
    }
    // Keyed by activeId upstream (EveView), so this runs once per thread mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (events === null) {
    return (
      <div className="eve-scope flex h-[calc(100dvh-var(--app-header-height,48px))] min-h-[600px] items-center justify-center text-muted-foreground text-sm">
        Loading conversation…
      </div>
    )
  }

  return <EveChatInner {...props} voiceAvailable={voiceAvailable} initialEvents={events} />
}

// ── Inner: the live chat (one useEveAgent instance) ────────────────────────────

const EveChatInner: React.FC<EveChatProps & { initialEvents: unknown[]; voiceAvailable: boolean }> = ({
  conversations,
  activeId,
  initialSession,
  initialEvents,
  voiceAvailable,
}) => {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [sidebarConversations, setSidebarConversations] = useState(conversations)

  // Track the title for the current thread (first user message).
  const titleRef = useRef<string | undefined>(undefined)
  // In-flight guard so a rapid double-submit can't start two sends (which could
  // race two new-session creates / duplicate sidebar entries).
  const sendingRef = useRef(false)
  // Latest sessionId from onSessionChange — `agent.session.sessionId` is a stale
  // closure value inside the async submit handler, so we read this ref instead.
  const latestSessionIdRef = useRef<string | undefined>(undefined)

  const onSessionChange = useCallback(
    (session: SessionCursor) => {
      if (!session.sessionId) return
      latestSessionIdRef.current = session.sessionId
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
    initialSession: initialSession as SessionCursor | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialEvents: initialEvents as any,
    // Persistence is driven solely by onSessionChange (fires whenever the session
    // cursor advances, including after a turn completes) — no duplicate onFinish write.
    onSessionChange,
  })

  // ── Voice ─────────────────────────────────────────────────────────────────

  // Derive the latest assistant text and id from the message list.
  const lastAssistantMsg = [...agent.data.messages].reverse().find((m) => m.role === 'assistant')
  const lastAssistantTextPart = lastAssistantMsg?.parts.find((p) => p.type === 'text') as
    | { type: 'text'; text: string }
    | undefined
  const latestAssistantText = lastAssistantTextPart?.text ?? ''
  const latestAssistantId = lastAssistantMsg?.id

  const voice = useVoice({
    voiceAvailable,
    status: agent.status,
    assistantText: latestAssistantText,
    assistantMessageId: latestAssistantId,
    onTranscript: (text) => {
      void agent.send({ message: text, clientContext: VOICE_REPLY_INSTRUCTION })
    },
    onInterrupt: () => {
      // Pressing to talk while a turn is in flight stops it so the new request takes over.
      agent.stop()
    },
  })

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text) return
    if (sendingRef.current) return // ignore re-entrant submits while a send is in flight
    sendingRef.current = true
    setInput('')

    const isNew = !activeId && !agent.session.sessionId
    // Capture the first user message as the title for a new thread.
    if (isNew && !titleRef.current) {
      titleRef.current = text.slice(0, 80)
    }

    try {
      await agent.send({ message: text })
    } finally {
      sendingRef.current = false
    }

    // After send resolves for a brand-new chat, push the new sessionId into the URL
    // so follow-ups persist to the same thread. Read the ref (set by onSessionChange),
    // not agent.session.sessionId, which is stale in this async closure.
    if (isNew) {
      const sid = latestSessionIdRef.current
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

  // Answer a HITL input request (ask_question / approval) by resuming the turn.
  const handleRespondInput = useCallback(
    (response: InputResponseValue) => {
      void agent.send({ inputResponses: [response] })
    },
    [agent],
  )
  const agentBusy = agent.status === 'submitted' || agent.status === 'streaming'

  // Retry after a failed turn by re-sending the most recent user message.
  const handleRetry = useCallback(() => {
    const messages = agent.data.messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'user') continue
      const text = m.parts
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join('')
        .trim()
      if (text) {
        void agent.send({ message: text })
        return
      }
    }
  }, [agent])

  return (
    <TooltipProvider>
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
                          // Strip <speak>…</speak> blocks so the tags/inner text
                          // don't show raw in the chat (TTS speaks them instead).
                          const displayText =
                            m.role === 'assistant' ? removeSpeakTags(part.text) : part.text
                          return (
                            <MessageResponse key={partKey}>{displayText}</MessageResponse>
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
                          return renderToolPart(part, partKey, {
                            onRespondInput: handleRespondInput,
                            busy: agentBusy,
                          })
                        }

                        // step-start: no visible output
                        return null
                      })}
                    </MessageContent>
                  </Message>
                )
              })
            )}
            {agent.status === 'submitted' && <ThinkingIndicator />}
            {agent.status === 'error' && (
              <ErrorNotice message={agent.error?.message} onRetry={handleRetry} />
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
            {voiceAvailable && (
              <PromptInputTools>
                <VoiceButton voice={voice} />
                {voice.state === 'speaking' ? (
                  <button
                    type="button"
                    onClick={() => voice.stopSpeaking()}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
                    aria-label="Stop speaking"
                  >
                    <SquareIcon className="size-3 fill-current" />
                    Speaking… tap to stop
                  </button>
                ) : voice.listening ? (
                  <span className="text-muted-foreground text-xs" role="status">
                    {voice.state === 'thinking' ? 'Thinking…' : 'Listening…'}
                  </span>
                ) : null}
              </PromptInputTools>
            )}
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
    </TooltipProvider>
  )
}
