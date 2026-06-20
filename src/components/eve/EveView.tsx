import React from 'react'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import type { User } from '@/payload-types'
import { listConversations, loadConversationBySession } from '../../eve/conversations'
import { EveChat } from './EveChat'

/**
 * Admin view for the Eve chat agent. Renders inside the Payload admin shell.
 * Loads the signed-in user's conversation index and (optionally) the active
 * thread's session cursor, then hands them to the client chat component.
 *
 * Auth narrowing: req.user is the project-wide union User | PayloadMcpApiKey | null
 * (widened by the MCP plugin). Only a real users-collection User can own
 * conversations, so we narrow by checking collection === 'users' before calling
 * the conversation helpers or rendering the chat surface.
 */
export const EveView: React.FC<AdminViewServerProps> = async ({
  initPageResult,
  params,
  searchParams,
}) => {
  const { req, permissions, visibleEntities, locale } = initPageResult

  // Narrow away PayloadMcpApiKey — only users-collection documents can own conversations.
  const user: User | null =
    req.user && 'collection' in req.user && req.user.collection === 'users'
      ? (req.user as User)
      : null

  const activeId =
    typeof searchParams?.conversation === 'string' ? searchParams.conversation : undefined

  const conversations = user ? await listConversations(req.payload, user) : []

  const activeRow =
    user && activeId ? await loadConversationBySession(req.payload, activeId, user) : null
  const initialSession = activeRow
    ? {
        sessionId: activeRow.eveSessionId ?? undefined,
        continuationToken: activeRow.continuationToken ?? undefined,
        streamIndex: activeRow.streamIndex ?? 0,
      }
    : undefined

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={user ?? undefined}
      visibleEntities={visibleEntities}
    >
      {user ? (
        // Key by the active conversation so switching threads (or starting a new
        // chat) remounts EveChat — re-seeding it with the selected thread's
        // session cursor. Without this, the client keeps its mount-time state
        // and the wrong (or empty) thread is shown.
        <EveChat
          key={activeId ?? 'new'}
          conversations={conversations.map((c) => ({
            id: c.eveSessionId ?? String(c.id),
            title: c.title ?? 'Untitled',
          }))}
          activeId={activeId}
          initialSession={initialSession}
          voiceAvailable={!!process.env.DEEPGRAM_API_KEY}
        />
      ) : (
        <Gutter>
          <h1>Eve</h1>
          <p>Please sign in to chat with Eve.</p>
        </Gutter>
      )}
    </DefaultTemplate>
  )
}
