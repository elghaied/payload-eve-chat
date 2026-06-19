'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Reasoning } from '@/components/ai-elements/reasoning'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import { PostPreviewPanel } from './PostPreviewPanel'
import { buildApprovalMessage, type PostDraft } from '@/eve/approval-message'
import { useVoice } from './useVoice'
import { stripSpeak } from './speakable'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MicIcon, PhoneOffIcon } from 'lucide-react'
import './eve.css'

export { type ConversationSummary }

export const EveChat: React.FC<{
  initialMessages: UIMessage[]
  conversations: ConversationSummary[]
  activeId?: string
  sttAvailable?: boolean
  ttsAvailable?: boolean
}> = ({ initialMessages, conversations, activeId, sttAvailable = false, ttsAvailable = false }) => {
  const router = useRouter()
  // The conversation this chat persists to. Starts from the URL; for a brand-new
  // chat it's undefined until the server creates one and we adopt the returned id.
  // It is sent per-message (not used as the useChat id) so adopting it never
  // resets the visible messages.
  const [conversationId, setConversationId] = useState<string | undefined>(activeId)
  const [input, setInput] = useState('')
  // Sidebar list, seeded from the server. A newly created conversation is added
  // here client-side so it appears immediately (a server refresh would reset the
  // live chat). Re-seeds from the prop on remount (i.e. when navigating threads).
  const [sidebarConversations, setSidebarConversations] = useState(conversations)

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    // Stable chat identity for this mount. EveView keys EveChat by activeId, so
    // switching threads remounts the component; this id must NOT change when we
    // adopt a conversation id mid-session (that would clear the messages).
    id: activeId ?? 'new',
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/eve',
      // Forward the conversation id + voice flag supplied per-message via sendMessage's body.
      prepareSendMessagesRequest: ({ messages: msgs, body }) => ({
        body: { messages: msgs, conversationId: body?.conversationId, voice: body?.voice },
      }),
    }),
    onFinish: ({ message, messages: finalMessages }) => {
      // First reply of a new chat: adopt the server-created conversation id so
      // follow-up turns in this session persist to the same thread instead of
      // creating a new conversation each time, and add it to the sidebar.
      const meta = message.metadata as { conversationId?: string } | undefined
      const id = meta?.conversationId
      if (id && !conversationId) {
        setConversationId(id)
        const title =
          finalMessages
            .find((m) => m.role === 'user')
            ?.parts.flatMap((p) => (p.type === 'text' ? [p.text] : []))[0]
            ?.slice(0, 80) || 'New conversation'
        setSidebarConversations((prev) =>
          prev.some((c) => c.id === id) ? prev : [{ id, title }, ...prev],
        )
      }
    },
  })

  // Latest assistant message text (concatenated text parts) + its id drive
  // sentence-streamed TTS. Intentionally re-derived every render so it tracks the
  // live streaming updates — do NOT wrap this in useMemo.
  const { assistantText, assistantMessageId } = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return {
          assistantText: messages[i].parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as { text: string }).text)
            .join(''),
          assistantMessageId: messages[i].id,
        }
      }
    }
    return { assistantText: undefined, assistantMessageId: undefined }
  })()

  // The post draft currently shown in the side panel (from a proposePost tool part).
  const [activeDraft, setActiveDraft] = useState<{ id: string; draft: PostDraft } | null>(null)
  // The proposePost call id we've already surfaced, so re-renders don't reopen it
  // after the user closes the panel.
  const handledProposeIdRef = useRef<string | undefined>(undefined)

  // Open the panel when the agent proposes a post.
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j] as { type: string; toolCallId?: string; input?: unknown; output?: unknown }
        if (p.type !== 'tool-proposePost') continue
        const id = p.toolCallId ?? `${i}-${j}`
        const draft = (p.output ?? p.input) as PostDraft | undefined
        if (draft && id !== handledProposeIdRef.current) {
          handledProposeIdRef.current = id
          setActiveDraft({ id, draft })
        }
        return
      }
    }
  }, [messages])

  const handleApprovePost = (final: PostDraft) => {
    // Re-engage the agent to create the post via MCP, using the approved content.
    sendMessage({ text: buildApprovalMessage(final) }, { body: { conversationId } })
    setActiveDraft(null)
  }

  const voice = useVoice({
    sttAvailable,
    ttsAvailable,
    status,
    assistantText,
    assistantMessageId,
    // Voice-originated turn: flag it so the API asks Eve for a spoken <speak> summary.
    onTranscript: (text) => sendMessage({ text }, { body: { conversationId, voice: true } }),
  })

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim()) return
    // Read conversationId at send time (latest state) and pass it per-message —
    // no stale closure even right after adopting a new id.
    sendMessage({ text: message.text }, { body: { conversationId } })
    setInput('')
  }

  const handleSelectConversation = (id: string) => {
    router.push(`?conversation=${id}`)
  }

  const handleNewChat = () => {
    setConversationId(undefined)
    setMessages([])
    router.push('?')
  }

  return (
    <TooltipProvider>
    <div className="eve-scope flex h-[calc(100dvh-var(--app-header-height,48px))] min-h-[600px]">
      <ConversationSidebar
        conversations={sidebarConversations}
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
      />
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="Chat with Eve"
                description="Ask Eve to create a post or manage your tasks."
              />
            ) : (
              messages.map((message, index) => {
                // Fall back to the index when a message has no id (e.g. a rehydrated
                // record from an older save) so React keys stay unique.
                const messageKey = message.id || `message-${index}`
                return (
                <Message from={message.role} key={messageKey}>
                  <MessageContent>
                    {message.parts.map((part, i) => {
                      if (part.type === 'reasoning') {
                        return (
                          <Reasoning
                            key={`${messageKey}-${i}`}
                            text={part.text}
                            isStreaming={part.state === 'streaming'}
                          />
                        )
                      }
                      if (part.type === 'text') {
                        return (
                          <MessageResponse key={`${messageKey}-${i}`}>
                            {stripSpeak(part.text)}
                          </MessageResponse>
                        )
                      }
                      if (part.type === 'tool-proposePost') {
                        const tp = part as { toolCallId?: string; input?: unknown; output?: unknown }
                        const draft = (tp.output ?? tp.input) as PostDraft | undefined
                        return (
                          <button
                            className="text-left text-muted-foreground text-sm underline-offset-2 hover:text-foreground hover:underline"
                            key={`${messageKey}-${i}`}
                            onClick={() =>
                              draft &&
                              setActiveDraft({ id: tp.toolCallId ?? `${messageKey}-${i}`, draft })
                            }
                            type="button"
                          >
                            📝 Drafted a post{draft?.title ? ` — "${draft.title}"` : ''} — review it →
                          </button>
                        )
                      }
                      if (part.type === 'dynamic-tool') {
                        return (
                          <Tool key={`${messageKey}-${i}`}>
                            <ToolHeader
                              type="dynamic-tool"
                              toolName={part.toolName}
                              state={part.state}
                            />
                            <ToolContent>
                              <ToolInput input={part.input} />
                              {part.state === 'output-available' ? (
                                <ToolOutput output={part.output} errorText={undefined} />
                              ) : part.state === 'output-error' ? (
                                <ToolOutput output={undefined} errorText={part.errorText} />
                              ) : null}
                            </ToolContent>
                          </Tool>
                        )
                      }
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
            <PromptInputTools>
              <PromptInputButton
                onClick={() => (voice.active ? voice.stop() : void voice.start())}
                variant={voice.active ? 'default' : 'ghost'}
                tooltip={voice.active ? `Voice: ${voice.state} (click to stop)` : 'Start voice chat'}
                aria-label={voice.active ? 'Stop voice chat' : 'Start voice chat'}
              >
                {voice.active ? <PhoneOffIcon className="size-4" /> : <MicIcon className="size-4" />}
              </PromptInputButton>
            </PromptInputTools>
            {/* Enabled while generating (acts as Stop); otherwise needs input text. */}
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={status !== 'streaming' && status !== 'submitted' && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
      {activeDraft && (
        <PostPreviewPanel
          key={activeDraft.id}
          draft={activeDraft.draft}
          onApprove={handleApprovePost}
          onClose={() => setActiveDraft(null)}
        />
      )}
    </div>
    </TooltipProvider>
  )
}
