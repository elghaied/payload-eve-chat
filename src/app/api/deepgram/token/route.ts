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

  // Trim defensively — a stray space/newline in the env value corrupts the auth header
  // (Deepgram then returns 400 "Invalid credentials").
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim()
  if (!apiKey) {
    return Response.json({ error: 'voice not configured' }, { status: 503 })
  }

  let res: Response
  try {
    res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    })
  } catch (err) {
    payload.logger.error({ msg: 'Deepgram /v1/auth/grant network error', err })
    return Response.json({ error: 'Voice service unavailable' }, { status: 502 })
  }

  if (!res.ok) {
    let detail = ''
    try {
      const e = (await res.json()) as { err_code?: string; err_msg?: string }
      detail = e?.err_msg || e?.err_code || ''
    } catch {
      // non-JSON error body — ignore
    }
    payload.logger.error({ msg: `Deepgram /v1/auth/grant returned ${res.status}`, detail })
    // 403 "Insufficient permissions" = the key lacks the Member role needed to grant tokens.
    if (res.status === 403) {
      return Response.json(
        {
          error:
            'Your Deepgram API key lacks token-grant permission. In the Deepgram Console → ' +
            'API Keys, create a key with the "Member" role (or higher) and set it as ' +
            'DEEPGRAM_API_KEY.',
        },
        { status: 502 },
      )
    }
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
