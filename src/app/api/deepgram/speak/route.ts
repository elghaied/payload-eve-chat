import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * POST /api/deepgram/speak  — body: { text: string }
 *
 * Server-side Deepgram Aura TTS proxy. Returns raw linear16 PCM (24 kHz, mono).
 *
 * WHY a server proxy (not a browser WebSocket like STT): Deepgram's /v1/auth/grant
 * short-lived tokens are scoped to ASR (`asr:write`) only — they authorize live STT but
 * Aura TTS rejects them (WS close 1008). So TTS must use the full API key, which has to stay
 * server-side. STT still uses a browser token; only TTS is proxied.
 *
 * Auth: mirrors src/app/api/deepgram/token/route.ts — requires a Payload users session.
 */
const TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en'

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })

  if (!user || user.collection !== 'users') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Trim defensively — a stray space/newline in the env value corrupts the auth header.
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim()
  if (!apiKey) {
    return Response.json({ error: 'voice not configured' }, { status: 503 })
  }

  let text: string
  try {
    const body = (await req.json()) as { text?: unknown }
    text = typeof body.text === 'string' ? body.text : ''
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!text.trim()) {
    return Response.json({ error: 'empty text' }, { status: 400 })
  }

  const url =
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(TTS_MODEL)}` +
    `&encoding=linear16&sample_rate=24000`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    payload.logger.error({ msg: 'Deepgram /v1/speak network error', err })
    return Response.json({ error: 'Voice service unavailable' }, { status: 502 })
  }

  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    payload.logger.error({ msg: `Deepgram /v1/speak returned ${res.status}`, detail })
    return Response.json({ error: 'Voice service error' }, { status: 502 })
  }

  // Stream the raw PCM straight through to the browser, which decodes linear16 for playback.
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': 'audio/L16; rate=24000', 'Cache-Control': 'no-store' },
  })
}
