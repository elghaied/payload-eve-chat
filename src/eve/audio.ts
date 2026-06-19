import type { EveConfig } from './config'

/** Error from an upstream STT/TTS service (non-2xx response). */
export class AudioServiceError extends Error {
  constructor(
    public readonly service: 'stt' | 'tts',
    public readonly status: number,
    body: string,
  ) {
    super(`${service} request failed (${status}): ${body.slice(0, 200)}`)
    this.name = 'AudioServiceError'
  }
}

/**
 * Transcribe audio via an OpenAI-compatible STT server.
 * POST multipart to `${sttBaseURL}/audio/transcriptions`; returns the transcript.
 */
export async function transcribe({
  audio,
  config,
}: {
  audio: Blob
  config: EveConfig
}): Promise<string> {
  if (!config.sttBaseURL) throw new AudioServiceError('stt', 0, 'not configured')

  const form = new FormData()
  form.append('file', audio, 'audio.wav')
  form.append('model', config.sttModel)

  const headers: Record<string, string> = {}
  if (config.sttApiKey) headers.Authorization = `Bearer ${config.sttApiKey}`

  const res = await fetch(`${config.sttBaseURL}/audio/transcriptions`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) throw new AudioServiceError('stt', res.status, await res.text())

  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

/**
 * Synthesize speech via an OpenAI-compatible TTS server.
 * POST JSON to `${ttsBaseURL}/audio/speech`; returns the raw Response so the
 * caller can stream the audio body straight through.
 */
export async function synthesize({
  text,
  voice,
  config,
}: {
  text: string
  voice?: string
  config: EveConfig
}): Promise<Response> {
  if (!config.ttsBaseURL) throw new AudioServiceError('tts', 0, 'not configured')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.ttsApiKey) headers.Authorization = `Bearer ${config.ttsApiKey}`

  const res = await fetch(`${config.ttsBaseURL}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.ttsModel,
      input: text,
      voice: voice ?? config.ttsVoice,
      response_format: config.ttsFormat,
    }),
  })
  if (!res.ok) throw new AudioServiceError('tts', res.status, await res.text())

  return res
}
