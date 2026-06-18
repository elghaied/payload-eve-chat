import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getEveConfig } from '@/eve/config'
import { resolveModel } from '@/eve/provider'
import { createPayloadMcpTools } from '@/eve/mcp-client'
import { EVE_SYSTEM_PROMPT } from '@/eve/system-prompt'
import { createConversation, loadConversation, saveMessages } from '@/eve/conversations'

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // payload.auth() returns User | PayloadMcpApiKey; only real users-collection
  // users may own conversations. Reject API-key auth at this endpoint.
  if (user.collection !== 'users') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // At this point TypeScript narrows `user` to `User` (collection: 'users').
  const typedUser = user

  let body: { messages: UIMessage[]; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { messages, conversationId } = body

  let eveConfig
  try {
    eveConfig = getEveConfig()
  } catch (err) {
    payload.logger.error({ msg: 'Eve config error', err })
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }

  // Resolve (or create) the conversation this thread persists to.
  const firstUserText =
    messages
      .find((m) => m.role === 'user')
      ?.parts.find((p) => p.type === 'text')?.text ?? 'New conversation'

  let conversation = conversationId
    ? await loadConversation(payload, conversationId, typedUser)
    : null
  if (!conversation) {
    conversation = await createConversation(payload, typedUser, firstUserText.slice(0, 80))
  }

  const { tools, close } = await createPayloadMcpTools(eveConfig)

  const modelMessages = await convertToModelMessages(messages)

  const result = streamText({
    model: resolveModel(eveConfig),
    system: EVE_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    onFinish: () => { void close() },
    onAbort: () => { void close() },
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      // Drop content-less messages (e.g. an empty assistant shell from a run that
      // errored before producing output) so a failed turn never poisons the thread.
      const persistable = finalMessages.filter((m) => (m.parts?.length ?? 0) > 0)
      void saveMessages(payload, String(conversation!.id), persistable, typedUser)
    },
  })
}
