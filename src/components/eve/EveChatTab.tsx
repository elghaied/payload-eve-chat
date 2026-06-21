import React from 'react'
import type { SidebarTabServerProps } from 'payload'
import type { User } from '@/payload-types'
import { listConversations } from '../../eve/conversations'
import { ConversationHistoryPanel } from './ConversationHistoryPanel'

/**
 * Content of the "Eve chat" sidebar tab. Server component: fetches the signed-in
 * user's conversations (same as EveView) and hands them to the client panel.
 *
 * `user` is the project-wide union (widened by the MCP plugin). Only a
 * users-collection document can own conversations, so we narrow first.
 */
export const EveChatTab = async ({ payload, user }: SidebarTabServerProps) => {
  const typedUser: User | null =
    user && 'collection' in user && user.collection === 'users' ? (user as User) : null

  if (!typedUser) {
    return (
      <p className="nav__label" style={{ opacity: 0.7, padding: 8 }}>
        Sign in to chat with Eve.
      </p>
    )
  }

  const rows = await listConversations(payload, typedUser)
  const initialConversations = rows.map((c) => ({
    id: c.eveSessionId ?? String(c.id),
    title: c.title ?? 'Untitled',
  }))

  return <ConversationHistoryPanel initialConversations={initialConversations} />
}
