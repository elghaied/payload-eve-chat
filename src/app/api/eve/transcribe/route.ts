import { getPayload } from 'payload'
import config from '@payload-config'
import { getEveConfig } from '@/eve/config'
import { transcribe } from '@/eve/audio'

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
  if (!eveConfig.sttBaseURL)
    return Response.json({ error: 'No speech-to-text service is attached' }, { status: 503 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return Response.json({ error: 'Missing audio file' }, { status: 400 })

  try {
    const text = await transcribe({ audio: file, config: eveConfig })
    return Response.json({ text })
  } catch (err) {
    payload.logger.error({ msg: 'Eve STT failed', err })
    return Response.json({ error: 'Transcription failed' }, { status: 503 })
  }
}
