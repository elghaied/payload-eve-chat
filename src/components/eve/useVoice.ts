'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@payloadcms/ui'
import type { UseEveAgentStatus } from 'eve/react'
import { createSentenceStreamer } from './sentenceStreamer'
import { extractSpeak, firstSentences, stripForSpeech } from './speakable'

// ── Constants ──────────────────────────────────────────────────────────────────

// Push-to-talk STT: the mic is only open while the user holds the button/key, so there's no
// need for VAD endpointing/barge-in (which caused echo-driven false interrupts). We just
// stream audio while held, then Finalize to flush the transcript on release.
const DG_STT_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-3&language=en&interim_results=true&smart_format=true&punctuate=true'

// TTS goes through our server proxy (/api/deepgram/speak): Deepgram grant tokens are ASR-only
// so Aura TTS needs the server-side key. Proxy returns linear16 PCM @ 24 kHz.
const TTS_SAMPLE_RATE = 24000
// After releasing PTT, wait briefly for Deepgram's trailing final transcript before submitting.
const FINALIZE_WAIT_MS = 700

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
  /** Called with the final transcript when the user finishes a push-to-talk utterance. */
  onTranscript: (text: string) => void
  /** Called when the user starts talking while a turn is in flight, so the caller can stop it. */
  onInterrupt?: () => void
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Fetch a short-lived Deepgram access token (STT only) from our server-side route. */
async function fetchDeepgramToken(): Promise<string> {
  const res = await fetch('/api/deepgram/token', { method: 'POST', credentials: 'same-origin' })
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
  const usable = buffer.byteLength - (buffer.byteLength % 2)
  const int16 = new Int16Array(buffer, 0, usable / 2)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i]! / 32768
  return float32
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Push-to-talk voice for Eve: hold the mic (or a key) to talk; release to send. Deepgram STT
 * while held → onTranscript on release. Eve's reply (for voice turns) is spoken via the Aura
 * TTS server proxy. No VAD/barge-in: pressing to talk explicitly stops any current playback/turn.
 */
export function useVoice({
  voiceAvailable,
  status,
  assistantText,
  assistantMessageId,
  onTranscript,
  onInterrupt,
}: UseVoiceArgs) {
  const [listening, setListening] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')

  // Live mirrors for long-lived handlers / async start.
  const wantListeningRef = useRef(false) // user intent (set synchronously by press/release)
  const startingRef = useRef(false)
  const statusRef = useRef(status)
  const onTranscriptRef = useRef(onTranscript)
  const onInterruptRef = useRef(onInterrupt)
  useEffect(() => {
    statusRef.current = status
    onTranscriptRef.current = onTranscript
    onInterruptRef.current = onInterrupt
  })

  // ── STT refs ──────────────────────────────────────────────────────────────
  const sttWsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const accumulatedRef = useRef('')
  const finalizeTimerRef = useRef<number | null>(null)

  // ── TTS playback refs ───────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null)
  const pcmQueueRef = useRef<Float32Array[]>([])
  const isPlayingRef = useRef(false)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ttsTextQueueRef = useRef<string[]>([])
  const ttsProcessingRef = useRef(false)
  const ttsAbortRef = useRef<AbortController | null>(null)

  // ── Sentence streamer refs ─────────────────────────────────────────────────
  const streamerRef = useRef(createSentenceStreamer())
  const lastAssistantIdRef = useRef<string | undefined>(undefined)
  const assistantMessageIdRef = useRef<string | undefined>(undefined)
  // Speak only the reply to a voice (PTT) turn, not typed turns. Set on submit.
  const speakReplyRef = useRef(false)
  // The assistant message already on screen when a PTT turn was sent — don't speak it.
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
      setState((s) => (s === 'speaking' ? 'idle' : s))
      return
    }
    const ctx = audioCtxRef.current
    if (!ctx) return
    isPlayingRef.current = true
    setState('speaking')
    const buf = ctx.createBuffer(1, chunk.length, TTS_SAMPLE_RATE)
    buf.getChannelData(0).set(chunk)
    const source = ctx.createBufferSource()
    source.buffer = buf
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
    (f: Float32Array) => {
      if (f.length === 0) return
      pcmQueueRef.current.push(f)
      if (!isPlayingRef.current) playNext()
    },
    [playNext],
  )

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
            enqueueAudio(decodeLinear16(await res.arrayBuffer()))
          } else {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            toast.error(`Voice: ${body.error ?? "Eve's reply couldn't be spoken."}`)
          }
        } catch {
          // aborted (interrupt/stop) or network error
        } finally {
          ttsAbortRef.current = null
        }
      }
    } finally {
      ttsProcessingRef.current = false
    }
  }, [enqueueAudio])

  const speak = useCallback(
    (sentence: string) => {
      const cleaned = stripForSpeech(sentence)
      if (!cleaned.trim()) return
      ttsTextQueueRef.current.push(cleaned)
      void processTtsQueue()
    },
    [processTtsQueue],
  )

  const clearPlayback = useCallback(() => {
    try {
      currentSourceRef.current?.stop()
    } catch {
      // already stopped
    }
    currentSourceRef.current = null
    isPlayingRef.current = false
    pcmQueueRef.current = []
    ttsTextQueueRef.current = []
    ttsAbortRef.current?.abort()
  }, [])

  // ── Speak the reply to a voice turn as it streams ───────────────────────────
  // Speak ONLY the <speak>…</speak> summary (Eve wraps a short spoken version). The full reply
  // is still shown in the chat; only the wrapped part is read aloud.
  useEffect(() => {
    if (!speakReplyRef.current || !assistantText) return
    if (assistantMessageId === baselineAssistantIdRef.current) return
    if (assistantMessageId !== lastAssistantIdRef.current) {
      streamerRef.current = createSentenceStreamer()
      lastAssistantIdRef.current = assistantMessageId
    }
    const spoken = extractSpeak(assistantText)
    if (spoken !== null) {
      for (const s of streamerRef.current.push(spoken)) speak(s)
    }
  }, [assistantText, assistantMessageId, speak])

  useEffect(() => {
    if (!speakReplyRef.current) return
    if (assistantMessageId === baselineAssistantIdRef.current) return
    if (status === 'streaming' || status === 'submitted') return
    const text = assistantText ?? ''
    if (extractSpeak(text) !== null) {
      for (const s of streamerRef.current.flush()) speak(s)
    } else if (text.trim()) {
      // Model didn't wrap a <speak> summary — speak a brief fallback, not the whole reply.
      speak(firstSentences(text, 2))
    }
    speakReplyRef.current = false // spoken this voice reply; don't speak subsequent typed turns
  }, [status, assistantMessageId, speak])

  // Stop Eve speaking: halt playback AND further synthesis (so it stops spending TTS tokens).
  const stopSpeaking = useCallback(() => {
    speakReplyRef.current = false
    clearPlayback()
    setState((s) => (s === 'speaking' ? 'idle' : s))
  }, [clearPlayback])

  // ── Teardown of the STT capture side only (keeps AudioContext for playback) ──
  const teardownCapture = useCallback(() => {
    if (finalizeTimerRef.current != null) {
      window.clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    try {
      sttWsRef.current?.close()
    } catch {
      // ignore
    }
    sttWsRef.current = null
  }, [])

  // ── startListening (push) ────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (!voiceAvailable) {
      toast.error('Voice not configured (DEEPGRAM_API_KEY missing).')
      return
    }
    wantListeningRef.current = true
    if (startingRef.current || sttWsRef.current) return
    startingRef.current = true

    // Pressing to talk interrupts Eve: stop any TTS + any in-flight turn.
    clearPlayback()
    if (statusRef.current === 'submitted' || statusRef.current === 'streaming') {
      onInterruptRef.current?.()
    }
    baselineAssistantIdRef.current = assistantMessageIdRef.current
    accumulatedRef.current = ''

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      if (!wantListeningRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      micStreamRef.current = stream

      const token = await fetchDeepgramToken()
      if (!wantListeningRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        micStreamRef.current = null
        return
      }

      // Lazily create + resume the AudioContext (within the user gesture) for later playback.
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
      }
      await audioCtxRef.current.resume().catch(() => {})

      const ws = new WebSocket(DG_STT_URL, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      sttWsRef.current = ws
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(ev.data) as Record<string, unknown>
        } catch {
          return
        }
        if (msg['type'] !== 'Results') return
        const channel = msg['channel'] as Record<string, unknown> | undefined
        const alts = channel?.['alternatives'] as Array<{ transcript: string }> | undefined
        const transcript = alts?.[0]?.transcript ?? ''
        if (msg['is_final'] && transcript) accumulatedRef.current += transcript + ' '
      }
      ws.onerror = () => toast.error('Voice: STT connection error.')

      await new Promise<void>((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve()
        ws.addEventListener('open', () => resolve(), { once: true })
        ws.addEventListener('error', () => reject(new Error('STT WS failed to open')), { once: true })
        ws.addEventListener('close', () => reject(new Error('STT WS closed before open')), { once: true })
      })
      if (!wantListeningRef.current) {
        teardownCapture()
        return
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }
      recorder.start(250)

      setListening(true)
      setState('listening')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start voice')
      teardownCapture()
      setListening(false)
      setState((s) => (s === 'listening' ? 'idle' : s))
    } finally {
      startingRef.current = false
      // If the user released during async startup, stop now.
      if (!wantListeningRef.current) {
        teardownCapture()
        setListening(false)
      }
    }
  }, [voiceAvailable, clearPlayback, teardownCapture])

  // ── stopListening (release) → finalize + submit ──────────────────────────────
  const stopListening = useCallback(() => {
    wantListeningRef.current = false
    if (!sttWsRef.current && !mediaRecorderRef.current) {
      setListening(false)
      setState((s) => (s === 'listening' ? 'idle' : s))
      return
    }
    setListening(false)

    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignore
    }
    mediaRecorderRef.current = null
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null

    const ws = sttWsRef.current
    const submit = () => {
      finalizeTimerRef.current = null
      const text = accumulatedRef.current.trim()
      accumulatedRef.current = ''
      try {
        ws?.close()
      } catch {
        // ignore
      }
      if (sttWsRef.current === ws) sttWsRef.current = null
      if (text) {
        speakReplyRef.current = true
        setState('thinking')
        onTranscriptRef.current(text)
      } else {
        setState((s) => (s === 'speaking' ? s : 'idle'))
      }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'Finalize' }))
      } catch {
        // ignore
      }
      finalizeTimerRef.current = window.setTimeout(submit, FINALIZE_WAIT_MS)
    } else {
      submit()
    }
  }, [])

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stopListening()
    else void startListening()
  }, [startListening, stopListening])

  // Full teardown on unmount.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false
      teardownCapture()
      clearPlayback()
      void audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [teardownCapture, clearPlayback])

  return {
    available: voiceAvailable,
    listening,
    state,
    startListening,
    stopListening,
    stopSpeaking,
    toggle,
  }
}
