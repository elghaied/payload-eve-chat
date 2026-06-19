'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@payloadcms/ui'
import { createSentenceStreamer } from './sentenceStreamer'
import { extractSpeak, stripForSpeech } from './speakable'
import { encodeWav } from './wav'

// @ricky0123/vad-web needs to fetch its worklet + Silero ONNX model and the
// onnxruntime-web WASM at runtime. We serve these self-hosted from /vad/ (copied
// into public/vad/ by scripts/copy-vad-assets.mjs) rather than a CDN, so no
// third-party code is loaded into the admin context and voice works offline.
const VAD_ASSET_BASE = '/vad/'
const ORT_WASM_BASE = '/vad/'

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

type UseVoiceArgs = {
  sttAvailable: boolean // server attached an STT service
  ttsAvailable: boolean // server attached a TTS service
  status: string // useChat status ('streaming' | 'submitted' | 'ready' | 'error')
  assistantText: string | undefined // latest streaming assistant message text
  assistantMessageId: string | undefined // id of the latest assistant message (resets the streamer per turn)
  onTranscript: (text: string) => void // -> sendMessage
}

/**
 * Hands-free voice loop: Silero VAD captures utterances -> /transcribe -> onTranscript,
 * and (when TTS is attached) the streaming assistant text is split into sentences ->
 * /speak -> sequential playback. Speaking while Eve talks (barge-in) aborts playback
 * and resumes listening. STT and TTS are each optional; the not-attached cases notify
 * via the admin toast. Browser-only; relies on getUserMedia + Web Audio + @ricky0123/vad-web.
 */
export function useVoice({
  sttAvailable,
  ttsAvailable,
  status,
  assistantText,
  assistantMessageId,
  onTranscript,
}: UseVoiceArgs) {
  const [active, setActive] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')

  const vadRef = useRef<{ start: () => void; pause: () => void; destroy: () => void } | null>(null)
  const streamerRef = useRef(createSentenceStreamer())
  // Tracks which assistant message the streamer is currently consuming, so a new
  // turn (voice or text) resets the streamer instead of applying a stale cursor.
  const lastAssistantIdRef = useRef<string | undefined>(undefined)
  // Live mirror of the latest assistant message id (for use in start()).
  const assistantMessageIdRef = useRef<string | undefined>(undefined)
  // The assistant message that already existed when voice was turned on — never
  // spoken, so activating voice doesn't read back the prior reply.
  const baselineAssistantIdRef = useRef<string | undefined>(undefined)
  const queueRef = useRef<HTMLAudioElement[]>([])
  const playingRef = useRef(false)
  // Strict FIFO speak pipeline: at most one /speak fetch in flight at a time.
  const pendingSpeakRef = useRef<string[]>([]) // queued sentence texts awaiting a fetch
  const speakingFetchRef = useRef(false) // a /speak fetch is currently running
  const speakAbortRef = useRef<AbortController | null>(null) // the one in-flight fetch
  const transcribeAbortRef = useRef<AbortController | null>(null)
  // Use a stable ref so the recursive playNext call avoids the
  // react-hooks/immutability forward-reference and render-time-ref-write rules.
  const playNextRef = useRef<() => void>(null)
  // Same pattern for the self-recursive pumpSpeak (finally -> pumpSpeak again).
  const pumpSpeakRef = useRef<() => void>(null)

  const playNext = useCallback(() => {
    if (playingRef.current) return
    const audio = queueRef.current.shift()
    if (!audio) {
      setState((s) => (s === 'speaking' ? 'listening' : s))
      return
    }
    playingRef.current = true
    setState('speaking')
    const done = () => {
      URL.revokeObjectURL(audio.src)
      playingRef.current = false
      // call through the ref to avoid a forward-reference in the closure
      playNextRef.current?.()
    }
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done)
  }, [])

  // Keep the ref in sync after every render (safe; refs are write-any-time).
  useEffect(() => {
    playNextRef.current = playNext
  })

  // Mirror the latest assistant message id so start() can baseline it.
  useEffect(() => {
    assistantMessageIdRef.current = assistantMessageId
  })

  const clearPlayback = useCallback(() => {
    // Barge-in / stop: cancel the in-flight fetch and drop the whole speak queue.
    speakAbortRef.current?.abort()
    speakAbortRef.current = null
    speakingFetchRef.current = false
    pendingSpeakRef.current = []
    for (const a of queueRef.current) {
      URL.revokeObjectURL(a.src)
      a.pause()
      a.removeAttribute('src')
    }
    queueRef.current = []
    playingRef.current = false
  }, [])

  // Drain the FIFO speak queue one sentence at a time: exactly one /speak fetch
  // runs at a time, so sentences are fetched (and thus queued for playback) in
  // strict order. The finally re-pumps to process the next queued sentence.
  const pumpSpeak = useCallback(() => {
    if (speakingFetchRef.current || pendingSpeakRef.current.length === 0) return
    const sentence = pendingSpeakRef.current.shift()!
    speakingFetchRef.current = true
    const controller = new AbortController()
    speakAbortRef.current = controller
    void (async () => {
      try {
        const res = await fetch('/api/eve/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sentence }),
          signal: controller.signal,
        })
        if (res.ok) {
          const blob = await res.blob()
          const blobUrl = URL.createObjectURL(blob)
          queueRef.current.push(new Audio(blobUrl))
          playNext()
        }
      } catch {
        // aborted (barge-in) or network error: ignore, stay responsive
      } finally {
        speakingFetchRef.current = false
        pumpSpeakRef.current?.()
      }
    })()
  }, [playNext])

  // Keep the ref in sync so the finally above can re-enter pumpSpeak.
  useEffect(() => {
    pumpSpeakRef.current = pumpSpeak
  })

  const enqueueSpeak = useCallback(
    (sentence: string) => {
      // Don't read emoji/pictographs aloud; skip if nothing speakable remains.
      const cleaned = stripForSpeech(sentence)
      if (!cleaned) return
      pendingSpeakRef.current.push(cleaned)
      pumpSpeak()
    },
    [pumpSpeak],
  )

  const handleUtterance = useCallback(
    async (pcm: Float32Array) => {
      setState('transcribing')
      // Abort any prior in-flight transcribe so two rapid utterances don't race.
      transcribeAbortRef.current?.abort()
      const controller = new AbortController()
      transcribeAbortRef.current = controller
      try {
        const form = new FormData()
        form.append('file', encodeWav(pcm, 16000), 'utterance.wav')
        const res = await fetch('/api/eve/transcribe', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
        if (!res.ok) {
          toast.error('Transcription failed')
          setState('listening')
          return
        }
        const { text } = (await res.json()) as { text: string }
        if (text.trim()) {
          setState('thinking')
          // Streamer reset is handled by the assistant-message-id change in the
          // push effect below (covers both voice and text-typed turns).
          onTranscript(text)
        } else {
          setState('listening')
        }
      } catch {
        setState('listening')
      }
    },
    [onTranscript],
  )

  // Speak only the <speak> summary as it streams (when TTS attached). Until that
  // block appears we stay silent — the detailed reply streams to the chat but is
  // not voiced.
  useEffect(() => {
    if (!active || !ttsAvailable || !assistantText) return
    // Never speak the reply that already existed when voice was turned on.
    if (assistantMessageId === baselineAssistantIdRef.current) return
    // A new assistant turn (id change) means the streamer's consumed cursor is
    // stale for this different string — reset before pushing the new text.
    if (assistantMessageId !== lastAssistantIdRef.current) {
      streamerRef.current = createSentenceStreamer()
      lastAssistantIdRef.current = assistantMessageId
    }
    const speakable = extractSpeak(assistantText)
    if (speakable !== null) {
      for (const sentence of streamerRef.current.push(speakable)) enqueueSpeak(sentence)
    }
  }, [assistantText, assistantMessageId, active, ttsAvailable, enqueueSpeak])

  // When the stream finishes, flush the trailing spoken sentence. If the model
  // produced no <speak> block, fall back to speaking the whole reply so voice is
  // never silent.
  useEffect(() => {
    if (!active || !ttsAvailable) return
    // Never speak the reply that already existed when voice was turned on.
    if (assistantMessageId === baselineAssistantIdRef.current) return
    if (status === 'streaming' || status === 'submitted') return
    const text = assistantText ?? ''
    if (extractSpeak(text) !== null) {
      for (const sentence of streamerRef.current.flush()) enqueueSpeak(sentence)
    } else if (text.trim()) {
      for (const sentence of streamerRef.current.push(text)) enqueueSpeak(sentence)
      for (const sentence of streamerRef.current.flush()) enqueueSpeak(sentence)
    }
  }, [status, assistantText, assistantMessageId, active, ttsAvailable, enqueueSpeak])

  const start = useCallback(async () => {
    // Guard: a hands-free loop needs speech input.
    if (!sttAvailable) {
      toast.error('No speech-to-text service is attached.')
      return
    }
    if (!ttsAvailable) {
      toast.info("No text-to-speech attached — Eve's replies won't be spoken.")
    }
    // Baseline the reply that's already on screen so turning voice on doesn't
    // read it back; only turns that arrive after this point are spoken.
    baselineAssistantIdRef.current = assistantMessageIdRef.current
    try {
      const { MicVAD } = await import('@ricky0123/vad-web')
      const vad = await MicVAD.new({
        baseAssetPath: VAD_ASSET_BASE,
        onnxWASMBasePath: ORT_WASM_BASE,
        onSpeechStart: () => {
          clearPlayback() // barge-in: stop Eve talking
          setState('listening')
        },
        onSpeechEnd: (audio: Float32Array) => {
          void handleUtterance(audio)
        },
      })
      vad.start()
      vadRef.current = vad
      setActive(true)
      setState('listening')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Microphone unavailable')
      setActive(false)
      setState('idle')
    }
  }, [sttAvailable, ttsAvailable, clearPlayback, handleUtterance])

  const stop = useCallback(() => {
    vadRef.current?.pause()
    vadRef.current?.destroy()
    vadRef.current = null
    transcribeAbortRef.current?.abort()
    clearPlayback()
    setActive(false)
    setState('idle')
  }, [clearPlayback])

  // Tear everything down on unmount.
  useEffect(() => () => stop(), [stop])

  return { active, state, start, stop }
}
