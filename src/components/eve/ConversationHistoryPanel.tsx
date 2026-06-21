'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'

export type ConversationSummary = { id: string; title: string }

export type ConversationCreatedDetail = { id: string; title: string }

/** Admin route that hosts the full-space chat. The sidebar tab navigates here. */
const EVE_VIEW_PATH = '/admin/eve'

/**
 * Window event used to keep the history panel live. The panel and the chat view
 * (EveChat) live in separate React trees — the panel inside Payload's Nav, the
 * chat inside the routed page — so they communicate via a window CustomEvent
 * rather than shared React state.
 */
export const CONVERSATION_CREATED_EVENT = 'eve:conversation-created'

/** Announce that a brand-new conversation was created (called by EveChat). */
export function dispatchConversationCreated(detail: ConversationCreatedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONVERSATION_CREATED_EVENT, { detail }))
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--base, 4px)',
  padding: 'calc(var(--base, 20px) / 2)',
}
const newBtnStyle: React.CSSProperties = {
  textAlign: 'left',
  cursor: 'pointer',
  fontWeight: 600,
}
const itemBaseStyle: React.CSSProperties = {
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/**
 * Conversation history rendered inside the "Eve chat" sidebar tab. Seeded by a
 * server-fetched list, kept live by the CONVERSATION_CREATED_EVENT, and
 * highlighting the active thread from the URL. Styled with Payload's nav classes
 * + inline styles (Tailwind/eve.css are not guaranteed inside the Nav tree).
 */
export const ConversationHistoryPanel: React.FC<{
  initialConversations: ConversationSummary[]
}> = ({ initialConversations }) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations)

  // Server revalidation (tab re-activation) hands us a fresh list. Adopt it, but keep any
  // locally-known rows the server list doesn't have yet: a brand-new conversation added via
  // the event may not be persisted by the time the server re-renders, and we must not wipe it
  // (the optimistic row, newest, stays on top). Safe because there is no conversation-delete
  // feature — a local extra is never a stale ghost that should disappear.
  useEffect(() => {
    setConversations((prev) => {
      const serverIds = new Set(initialConversations.map((c) => c.id))
      const localExtras = prev.filter((c) => !serverIds.has(c.id))
      return [...localExtras, ...initialConversations]
    })
  }, [initialConversations])

  // Live updates from the chat view (separate React tree).
  useEffect(() => {
    const onCreated = (e: Event) => {
      const detail = (e as CustomEvent<ConversationCreatedDetail>).detail
      if (!detail?.id) return
      setConversations((prev) => [
        { id: detail.id, title: detail.title || 'New conversation' },
        ...prev.filter((c) => c.id !== detail.id),
      ])
    }
    window.addEventListener(CONVERSATION_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(CONVERSATION_CREATED_EVENT, onCreated)
  }, [])

  const activeId =
    pathname === EVE_VIEW_PATH ? (searchParams.get('conversation') ?? undefined) : undefined

  const openConversation = useCallback(
    (id: string) => router.push(`${EVE_VIEW_PATH}?conversation=${id}`),
    [router],
  )
  const startNewChat = useCallback(() => router.push(EVE_VIEW_PATH), [router])

  return (
    <div style={wrapStyle}>
      <button type="button" className="nav__link" style={newBtnStyle} onClick={startNewChat}>
        + New chat
      </button>
      <nav style={{ display: 'flex', flexDirection: 'column' }}>
        {conversations.length === 0 ? (
          <p className="nav__label" style={{ opacity: 0.7, padding: 4 }}>
            No conversations yet.
          </p>
        ) : (
          conversations.map((c) => {
            const isActive = c.id === activeId
            return (
              <button
                key={c.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => openConversation(c.id)}
                className="nav__link"
                style={{
                  ...itemBaseStyle,
                  fontWeight: isActive ? 600 : undefined,
                  background: isActive ? 'var(--theme-elevation-100)' : undefined,
                }}
              >
                {c.title || 'Untitled'}
              </button>
            )
          })
        )}
      </nav>
    </div>
  )
}
