'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@payloadcms/ui'
import type { UseEveAgentStatus } from 'eve/react'
import { createSentenceStreamer } from './sentenceStreamer'
import { extractSpeak, stripForSpeech } from './speakable'

// ── Constants ──────────────────────────────────────────────────────────────────

const DG_STT_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-3' +
  '&language=en' +
  '&interim_results=true' +
  '&endpointing=300' +
  '&utterance_end_ms=1000' +
  '&vad_events=true' +
  '&smart_format=true' +
  '&punctuate=true'

const DG_TTS_URL =
  'wss://api.deepgram.com/v1/speak' +
  '?model=aura-2-thalia-en' +
  '&encoding=linear16' +
  '&sample_rate=24000'

const TTS_SAMPLE_RATE = 24000

// ── Public types ───────────────────────────────────────────────────────────────

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type UseVoiceArgs = {
  /** True only when DEEPGRAM_API_KEY is set server-side. */
  voiceAvailable: boolean
  /** Current agent status from useEveAgent. */
  status: UseEveAgentStatus
  /** Latest assistant message text (streams in). */
  assistantText: string
  /** ID of the latest assistant message (resets the streamer per turn). */
  assistantMessageId: string | undefined
  /** Called when a complete utterance is transcribed — send to the agent. */
  onTranscript: (text: string) => void
  /** Optional: called on barge-in so the caller can stop an in-flight agent turn. */
  onBargeIn?: () => void
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Fetch a short-lived Deepgram access token from our server-side route. */
async function fetchDeepgramToken(): Promise<string> {
  const res = await fetch('/api/deepgram/token', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Token request failed (${res.status})`)
  }
  const { token } = (await res.json()) as { token: string }
  if (!token) throw new Error('No token in response')
  return token
}

/** Decode a linear16 binary ArrayBuffer into a Float32Array for AudioContext. */
export function decodeLinear16(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i]! / 32768
  }
  return float32
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Hands-free voice loop for Eve using Deepgram cloud STT and Aura TTS.
 *
 * Flow:
 *   start() → getUserMedia + token → STT WebSocket (MediaRecorder sends blobs)
 *           → on speech_final/UtteranceEnd → onTranscript → agent sends reply
 *           → reply streams → extractSpeak → sentence splitter → TTS WebSocket
 *           → binary linear16 frames → AudioContext FIFO queue → playback
 *
 * Barge-in:
 *   STT SpeechStarted while TTS playing → stop audio, send Clear to TTS WS,
 *   call onBargeIn() so caller can abort the agent turn, state → listening.
 *
 * SSR safety: all browser APIs are guarded with `typeof window !== 'undefined'`
 * and accessed only in callbacks / effects, never at module initialisation.
 */
export function useVoice({
  voiceAvailable,
  status,
  assistantText,
  assistantMessageId,
  onTranscript,
  onBargeIn,
}: UseVoiceArgs) {
  const [active, setActive] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')

  // Mirror `active` into a ref so closures (e.g. sttWs.onclose) always read
  // the current value without capturing a stale snapshot from useState.
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = active
  })

  // ── STT refs ──────────────────────────────────────────────────────────────
  const sttWsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const accumulatedRef = useRef('')

  // ── TTS refs ──────────────────────────────────────────────────────────────
  const ttsWsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // FIFO queue of decoded PCM buffers waiting to play.
  const pcmQueueRef = useRef<Float32Array[]>([])
  const isPlayingRef = useRef(false)
  // Keep a ref to the current playing source for barge-in stop.
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)

  // ── Sentence streamer refs ─────────────────────────────────────────────────
  const streamerRef = useRef(createSentenceStreamer())
  const lastAssistantIdRef = useRef<string | undefined>(undefined)
  const assistantMessageIdRef = useRef<string | undefined>(undefined)
  // The message that was already on screen when voice was turned on — don't speak it.
  const baselineAssistantIdRef = useRef<string | undefined>(undefined)

  // Keep live refs in sync
  useEffect(() => {
    assistantMessageIdRef.current = assistantMessageId
  })

  // ── AudioContext FIFO playback ─────────────────────────────────────────────

  /** Stable ref version of playNext to avoid recursive closure issues. */
  const playNextRef = useRef<() => void>(() => {})

  const playNext = useCallback(() => {
    if (isPlayingRef.current) return
    const chunk = pcmQueueRef.current.shift()
    if (!chunk) {
      isPlayingRef.current = false
      setState((s) => (s === 'speaking' ? 'listening' : s))
      return
    }
    const ctx = audioCtxRef.current
    if (!ctx) return

    isPlayingRef.current = true
    setState('speaking')

    const audioBuffer = ctx.createBuffer(1, chunk.length, TTS_SAMPLE_RATE)
    audioBuffer.getChannelData(0).set(chunk)
    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)
    source.onended = () => {
      isPlayingRef.current = false
      currentSourceRef.current = null
      playNextRef.current()
    }
    source.start()
    currentSourceRef.current = source
  }, [])

  useEffect(() => {
    playNextRef.current = playNext
  })

  const enqueueAudio = useCallback(
    (float32: Float32Array) => {
      pcmQueueRef.current.push(float32)
      if (!isPlayingRef.current) playNext()
    },
    [playNext],
  )

  // ── Clear TTS playback (barge-in or stop) ─────────────────────────────────

  const clearPlayback = useCallback(() => {
    try {
      currentSourceRef.current?.stop()
    } catch {
      // ignore "already stopped"
    }
    currentSourceRef.current = null
    isPlayingRef.current = false
    pcmQueueRef.current = []
    // Tell Deepgram TTS to discard its buffer.
    if (ttsWsRef.current?.readyState === WebSocket.OPEN) {
      ttsWsRef.current.send(JSON.stringify({ type: 'Clear' }))
    }
  }, [])

  // ── TTS WebSocket ──────────────────────────────────────────────────────────

  const openTtsWs = useCallback(
    async (token: string) => {
      const ws = new WebSocket(DG_TTS_URL, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      ttsWsRef.current = ws

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          // Raw linear16 PCM — decode and queue for playback.
          if (ev.data.byteLength === 0) return
          const float32 = decodeLinear16(ev.data)
          enqueueAudio(float32)
        }
        // Text messages: Flushed / Cleared / Metadata — no action needed.
      }

      // Wait for open before caller sends text.
      // Use addEventListener with { once: true } for the open-wait rejection so
      // we don't clobber the persistent onerror handler we set after the await.
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true })
        ws.addEventListener('error', () => reject(new Error('TTS WS failed to open')), { once: true })
      })

      // Persistent post-handshake error handler.  Assigned AFTER the open-wait
      // so a mid-session TTS error is always surfaced rather than swallowed.
      ws.onerror = () => {
        // Non-fatal: TTS WebSocket error — voice continues but Eve won't be heard.
        toast.error("Voice: TTS connection error — Eve's replies won't be spoken.")
      }
    },
    [enqueueAudio],
  )

  // ── Sentence streaming → TTS ───────────────────────────────────────────────

  const sendSentenceToTts = useCallback((sentence: string) => {
    const cleaned = stripForSpeech(sentence)
    if (!cleaned) return
    const ws = ttsWsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'Text', text: cleaned }))
    ws.send(JSON.stringify({ type: 'Flush' }))
  }, [])

  // ── React to streaming assistant text → TTS ────────────────────────────────

  useEffect(() => {
    if (!active) return
    if (!assistantText) return
    if (assistantMessageId === baselineAssistantIdRef.current) return

    if (assistantMessageId !== lastAssistantIdRef.current) {
      streamerRef.current = createSentenceStreamer()
      lastAssistantIdRef.current = assistantMessageId
    }
    const speakable = extractSpeak(assistantText)
    if (speakable !== null) {
      for (const sentence of streamerRef.current.push(speakable)) {
        sendSentenceToTts(sentence)
      }
    }
  }, [assistantText, assistantMessageId, active, sendSentenceToTts])

  // When agent stream finishes, flush remaining buffered sentence.
  useEffect(() => {
    if (!active) return
    if (assistantMessageId === baselineAssistantIdRef.current) return
    if (status === 'streaming' || status === 'submitted') return

    const text = assistantText ?? ''
    if (extractSpeak(text) !== null) {
      for (const sentence of streamerRef.current.flush()) sendSentenceToTts(sentence)
    } else if (text.trim()) {
      // No <speak> block — fall back to speaking the whole reply so voice isn't silent.
      for (const sentence of streamerRef.current.push(text)) sendSentenceToTts(sentence)
      for (const sentence of streamerRef.current.flush()) sendSentenceToTts(sentence)
    }
  }, [status, assistantText, assistantMessageId, active, sendSentenceToTts])

  // ── start() ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!voiceAvailable) {
      toast.error('Voice not configured (DEEPGRAM_API_KEY missing).')
      return
    }

    // Baseline: don't speak the message already on screen.
    baselineAssistantIdRef.current = assistantMessageIdRef.current

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Microphone unavailable')
      return
    }
    micStreamRef.current = stream

    // Fetch tokens for both WS connections upfront (two separate 30 s tokens).
    let sttToken: string
    let ttsToken: string
    try {
      ;[sttToken, ttsToken] = await Promise.all([fetchDeepgramToken(), fetchDeepgramToken()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start voice')
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    // Create a fresh AudioContext for this session.
    audioCtxRef.current = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })

    // Open TTS WS.
    try {
      await openTtsWs(ttsToken)
    } catch {
      toast.error("Voice: TTS connection failed — Eve's replies won't be spoken.")
      // Close the AudioContext that was just created to avoid a resource leak
      // when TTS fails during handshake (STT still starts so voice continues).
      void audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      // Continue: STT still works.
    }

    // Open STT WebSocket.
    // Subprotocol: ['bearer', token] for short-lived access tokens (not 'token' for raw keys).
    const sttWs = new WebSocket(DG_STT_URL, ['bearer', sttToken])
    sttWs.binaryType = 'arraybuffer'
    sttWsRef.current = sttWs

    sttWs.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>
      } catch {
        return
      }

      const msgType = msg['type'] as string | undefined

      if (msgType === 'Results') {
        const channel = msg['channel'] as Record<string, unknown> | undefined
        const alts = channel?.['alternatives'] as Array<{ transcript: string }> | undefined
        const transcript = alts?.[0]?.transcript ?? ''
        const isFinal = msg['is_final'] as boolean | undefined
        const speechFinal = msg['speech_final'] as boolean | undefined

        if (isFinal && transcript) {
          accumulatedRef.current += transcript + ' '
        }
        if (speechFinal) {
          const text = accumulatedRef.current.trim()
          accumulatedRef.current = ''
          if (text) {
            setState('thinking')
            onTranscript(text)
          }
        }
      } else if (msgType === 'UtteranceEnd') {
        // Backstop: submit accumulated text if speech_final never fired.
        const text = accumulatedRef.current.trim()
        accumulatedRef.current = ''
        if (text) {
          setState('thinking')
          onTranscript(text)
        }
      } else if (msgType === 'SpeechStarted') {
        // Barge-in: user started speaking while Eve was talking.
        if (isPlayingRef.current) {
          clearPlayback()
          onBargeIn?.()
          setState('listening')
        }
      }
    }

    sttWs.onerror = () => {
      toast.error('Voice: STT connection error.')
    }

    sttWs.onclose = () => {
      // Read from the ref so we see the live value, not the stale snapshot
      // captured when start() was called (before setActive(true) ran).
      if (activeRef.current) {
        toast.error('Voice: STT disconnected.')
      }
    }

    // Wait for STT WS to open before starting the MediaRecorder.
    // Both error and close before open are treated as fatal so the Promise
    // doesn't hang forever if the handshake fails.
    try {
      await new Promise<void>((resolve, reject) => {
        if (sttWs.readyState === WebSocket.OPEN) {
          resolve()
        } else {
          sttWs.addEventListener('open', () => resolve(), { once: true })
          sttWs.addEventListener('error', () => reject(new Error('STT WS failed to open')), { once: true })
          sttWs.addEventListener('close', () => reject(new Error('STT WS closed before open')), { once: true })
        }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Voice: STT failed to connect')
      // Clean up everything already allocated.
      stream.getTracks().forEach((t) => t.stop())
      sttWsRef.current = null
      return
    }

    // Start MediaRecorder — sends webm/opus blobs (no encoding/sample_rate params needed).
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0 && sttWs.readyState === WebSocket.OPEN) {
        sttWs.send(ev.data)
      }
    }
    recorder.start(250) // 250 ms chunks

    setActive(true)
    setState('listening')
    // Note: `active` is intentionally omitted from the deps — we read `activeRef.current`
    // inside the closure instead, so start/toggle identities stay stable after voice starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAvailable, openTtsWs, clearPlayback, onTranscript, onBargeIn])

  // ── stop() ─────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    // Stop MediaRecorder and mic tracks.
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null

    // Close STT WebSocket.
    sttWsRef.current?.close()
    sttWsRef.current = null

    // Clear TTS playback and close TTS WebSocket.
    clearPlayback()
    try {
      ttsWsRef.current?.close()
    } catch {
      // ignore
    }
    ttsWsRef.current = null

    // Close AudioContext.
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null

    // Reset streamer and accumulated transcript.
    accumulatedRef.current = ''
    streamerRef.current = createSentenceStreamer()
    lastAssistantIdRef.current = undefined

    setActive(false)
    setState('idle')
  }, [clearPlayback])

  const toggle = useCallback(() => {
    if (active) {
      stop()
    } else {
      void start()
    }
  }, [active, start, stop])

  // Tear everything down on unmount.
  useEffect(() => () => stop(), [stop])

  return { active, state, start, stop, toggle }
}
