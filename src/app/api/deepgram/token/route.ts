import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * POST /api/deepgram/token
 *
 * Issues a short-lived Deepgram access token (JWT, TTL = 30 s) that the
 * browser can use to open a WebSocket to Deepgram STT or TTS directly.
 * The raw DEEPGRAM_API_KEY never reaches the client.
 *
 * Auth: mirrors src/app/api/eve/session-index/route.ts — requires a valid
 * Payload users-collection session cookie.
 */
export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })

  if (!user || user.collection !== 'users') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DEEPGRAM_API_KEY) {
    return Response.json({ error: 'voice not configured' }, { status: 503 })
  }

  let res: Response
  try {
    res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    })
  } catch (err) {
    payload.logger.error({ msg: 'Deepgram /v1/auth/grant network error', err })
    return Response.json({ error: 'Voice service unavailable' }, { status: 502 })
  }

  if (!res.ok) {
    payload.logger.error({ msg: `Deepgram /v1/auth/grant returned ${res.status}` })
    return Response.json({ error: 'Voice service error' }, { status: 502 })
  }

  let body: { access_token?: string; expires_in?: number }
  try {
    body = (await res.json()) as { access_token?: string; expires_in?: number }
  } catch (err) {
    payload.logger.error({ msg: 'Deepgram /v1/auth/grant invalid JSON', err })
    return Response.json({ error: 'Voice service error' }, { status: 502 })
  }

  if (!body.access_token) {
    payload.logger.error({ msg: 'Deepgram /v1/auth/grant missing access_token' })
    return Response.json({ error: 'Voice service error' }, { status: 502 })
  }

  return Response.json({ token: body.access_token, expires_in: body.expires_in ?? 30 })
}
