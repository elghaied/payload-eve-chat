'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
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
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { ConversationSidebar, type ConversationSummary } from './ConversationSidebar'
import './eve.css'

export { type ConversationSummary }

export const EveChat: React.FC<{
  initialMessages: UIMessage[]
  conversations: ConversationSummary[]
  activeId?: string
}> = ({ initialMessages, conversations, activeId }) => {
  const router = useRouter()
  const [conversationId, setConversationId] = useState<string | undefined>(activeId)
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, setMessages } = useChat({
    id: conversationId ?? 'new',
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/eve',
      prepareSendMessagesRequest: ({ messages: msgs }) => ({
        body: { messages: msgs, conversationId },
      }),
    }),
  })

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim()) return
    sendMessage({ text: message.text })
    setInput('')
  }

  const handleSelectConversation = (id: string) => {
    setConversationId(id)
    router.push(`?conversation=${id}`)
  }

  const handleNewChat = () => {
    setConversationId(undefined)
    setMessages([])
    router.push('?')
  }

  return (
    <div className="eve-scope flex h-[calc(100vh-var(--app-header-height,0px))] min-h-[600px]">
      <ConversationSidebar
        conversations={conversations}
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
                      if (part.type === 'text') {
                        return (
                          <MessageResponse key={`${messageKey}-${i}`}>
                            {part.text}
                          </MessageResponse>
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
          <PromptInputSubmit status={status} disabled={!input.trim()} />
        </PromptInput>
      </div>
    </div>
  )
}
