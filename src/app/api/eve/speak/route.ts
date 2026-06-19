import { getPayload } from 'payload'
import config from '@payload-config'
import { getEveConfig } from '@/eve/config'
import { synthesize } from '@/eve/audio'

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.collection !== 'users') return Response.json({ error: 'Forbidden' }, { status: 403 })

  let eveConfig
  try {
    eveConfig = getEveConfig()
  } catch (err) {
    payload.logger.error({ msg: 'Eve config error', err })
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
  if (!eveConfig.ttsBaseURL)
    return Response.json({ error: 'No text-to-speech service is attached' }, { status: 503 })

  let body: { text?: string; voice?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.text?.trim()) return Response.json({ error: 'Missing text' }, { status: 400 })

  try {
    const upstream = await synthesize({ text: body.text, voice: body.voice, config: eveConfig })
    if (!upstream.body) {
      payload.logger.error({ msg: 'Eve TTS returned no audio body', err: null })
      return Response.json({ error: 'Speech synthesis failed' }, { status: 503 })
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    payload.logger.error({ msg: 'Eve TTS failed', err })
    return Response.json({ error: 'Speech synthesis failed' }, { status: 503 })
  }
}
