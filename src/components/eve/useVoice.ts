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

// TTS goes through our server proxy (/api/deepgram/speak), NOT a browser WebSocket:
// Deepgram /v1/auth/grant tokens are ASR-scoped only and Aura TTS rejects them, so TTS must
// use the full API key, which stays server-side. The proxy returns linear16 PCM @ 24 kHz.
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

/** Fetch a short-lived Deepgram access token (STT only) from our server-side route. */
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
  // The byte length may be odd if a chunk split a sample; floor to whole samples.
  const usable = buffer.byteLength - (buffer.byteLength % 2)
  const int16 = new Int16Array(buffer, 0, usable / 2)
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
 *   start() → getUserMedia + STT token → STT WebSocket (MediaRecorder sends blobs)
 *           → on speech_final/UtteranceEnd → onTranscript → agent sends reply
 *           → reply streams → sentence splitter → POST /api/deepgram/speak (server proxy)
 *           → linear16 PCM → AudioContext FIFO queue → playback
 *
 * Barge-in:
 *   STT SpeechStarted while TTS playing → stop audio, abort in-flight TTS fetches,
 *   call onBargeIn() so caller can abort the agent turn, state → listening.
 *
 * SSR safety: all browser APIs are guarded and accessed only in callbacks / effects.
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

  // Mirror `active` into a ref so closures (e.g. sttWs.onclose) always read the live value.
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = active
  })

  // Mirror the agent status so the long-lived STT message handler can tell whether a turn
  // is in flight (it captures values at start() time, which would otherwise be stale).
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  })

  // ── STT refs ──────────────────────────────────────────────────────────────
  const sttWsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const accumulatedRef = useRef('')

  // ── TTS playback refs ───────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null)
  const pcmQueueRef = useRef<Float32Array[]>([]) // decoded PCM waiting to play
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  // Sequential TTS fetch queue (preserves sentence order; one request at a time).
  const ttsTextQueueRef = useRef<string[]>([])
  const ttsProcessingRef = useRef(false)
  const ttsAbortRef = useRef<AbortController | null>(null)

  // ── Sentence streamer refs ─────────────────────────────────────────────────
  const streamerRef = useRef(createSentenceStreamer())
  const lastAssistantIdRef = useRef<string | undefined>(undefined)
  const assistantMessageIdRef = useRef<string | undefined>(undefined)
  // The message already on screen when voice was turned on — don't speak it.
  const baselineAssistantIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    assistantMessageIdRef.current = assistantMessageId
  })

  // ── AudioContext FIFO playback ─────────────────────────────────────────────

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
      if (float32.length === 0) return
      pcmQueueRef.current.push(float32)
      if (!isPlayingRef.current) playNext()
    },
    [playNext],
  )

  // ── TTS: sequential fetch of synthesized sentences from the server proxy ─────

  const processTtsQueue = useCallback(async () => {
    if (ttsProcessingRef.current) return
    ttsProcessingRef.current = true
    try {
      while (ttsTextQueueRef.current.length > 0) {
        const text = ttsTextQueueRef.current.shift()
        if (!text) continue
        const ac = new AbortController()
        ttsAbortRef.current = ac
        try {
          const res = await fetch('/api/deepgram/speak', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: ac.signal,
          })
          if (res.ok) {
            const buf = await res.arrayBuffer()
            enqueueAudio(decodeLinear16(buf))
          } else if (res.status !== 0) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            // Surface once; keep draining the queue (which clears on barge-in/stop).
            toast.error(`Voice: ${body.error ?? "Eve's reply couldn't be spoken."}`)
          }
        } catch {
          // aborted (barge-in/stop) or network error — drop this sentence.
        } finally {
          ttsAbortRef.current = null
        }
      }
    } finally {
      ttsProcessingRef.current = false
    }
  }, [enqueueAudio])

  const speakText = useCallback(
    (sentence: string) => {
      const cleaned = stripForSpeech(sentence)
      if (!cleaned.trim()) return
      ttsTextQueueRef.current.push(cleaned)
      void processTtsQueue()
    },
    [processTtsQueue],
  )

  // ── Clear TTS playback + pending synthesis (barge-in or stop) ───────────────

  const clearPlayback = useCallback(() => {
    try {
      currentSourceRef.current?.stop()
    } catch {
      // ignore "already stopped"
    }
    currentSourceRef.current = null
    isPlayingRef.current = false
    pcmQueueRef.current = []
    ttsTextQueueRef.current = []
    ttsAbortRef.current?.abort()
  }, [])

  // ── Speak the assistant reply as it streams ─────────────────────────────────
  // We do NOT depend on the model wrapping text in <speak> (Claude/most models won't);
  // if a <speak> block is present we use its contents, otherwise we speak the whole reply.

  useEffect(() => {
    if (!active || !assistantText) return
    if (assistantMessageId === baselineAssistantIdRef.current) return

    if (assistantMessageId !== lastAssistantIdRef.current) {
      streamerRef.current = createSentenceStreamer()
      lastAssistantIdRef.current = assistantMessageId
    }
    const spoken = extractSpeak(assistantText) ?? assistantText
    for (const sentence of streamerRef.current.push(spoken)) speakText(sentence)
  }, [assistantText, assistantMessageId, active, speakText])

  // When the turn finishes, flush the trailing partial sentence.
  useEffect(() => {
    if (!active) return
    if (assistantMessageId === baselineAssistantIdRef.current) return
    if (status === 'streaming' || status === 'submitted') return
    for (const sentence of streamerRef.current.flush()) speakText(sentence)
  }, [status, assistantMessageId, active, speakText])

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

    // STT token (TTS uses the server proxy, no token needed).
    let sttToken: string
    try {
      sttToken = await fetchDeepgramToken()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start voice')
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    // Create + resume the AudioContext within the user gesture so playback isn't suspended.
    const ctx = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
    audioCtxRef.current = ctx
    try {
      await ctx.resume()
    } catch {
      // some browsers auto-run; ignore
    }

    // Open STT WebSocket. Subprotocol ['bearer', token] for short-lived access tokens.
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
        const text = accumulatedRef.current.trim()
        accumulatedRef.current = ''
        if (text) {
          setState('thinking')
          onTranscript(text)
        }
      } else if (msgType === 'SpeechStarted') {
        // Barge-in / turn-taking: the user started speaking again. Interrupt whenever a turn
        // is in flight (thinking OR streaming) or TTS is active — NOT just while audio plays —
        // so the next utterance starts a fresh turn instead of queuing behind the current one
        // (which caused the "she answers the previous question" lag).
        const agentBusy = statusRef.current === 'submitted' || statusRef.current === 'streaming'
        if (isPlayingRef.current || ttsTextQueueRef.current.length > 0 || agentBusy) {
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
      if (activeRef.current) {
        toast.error('Voice: STT disconnected.')
      }
    }

    // Wait for STT WS to open before starting the MediaRecorder.
    try {
      await new Promise<void>((resolve, reject) => {
        if (sttWs.readyState === WebSocket.OPEN) {
          resolve()
        } else {
          sttWs.addEventListener('open', () => resolve(), { once: true })
          sttWs.addEventListener('error', () => reject(new Error('STT WS failed to open')), {
            once: true,
          })
          sttWs.addEventListener('close', () => reject(new Error('STT WS closed before open')), {
            once: true,
          })
        }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Voice: STT failed to connect')
      stream.getTracks().forEach((t) => t.stop())
      sttWsRef.current = null
      void ctx.close().catch(() => {})
      audioCtxRef.current = null
      return
    }

    // Start MediaRecorder — sends webm/opus blobs (Deepgram auto-detects the format).
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
    // `active` intentionally omitted — we read activeRef.current inside closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceAvailable, clearPlayback, onTranscript, onBargeIn])

  // ── stop() ─────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null

    sttWsRef.current?.close()
    sttWsRef.current = null

    clearPlayback()

    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null

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
