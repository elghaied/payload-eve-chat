'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@payloadcms/ui'
import { createSentenceStreamer } from './sentenceStreamer'
import { encodeWav } from './wav'

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

type UseVoiceArgs = {
  sttAvailable: boolean // server attached an STT service
  ttsAvailable: boolean // server attached a TTS service
  status: string // useChat status ('streaming' | 'submitted' | 'ready' | 'error')
  assistantText: string | undefined // latest streaming assistant message text
  onTranscript: (text: string) => void // -> sendMessage
}

/**
 * Hands-free voice loop: Silero VAD captures utterances -> /transcribe -> onTranscript,
 * and (when TTS is attached) the streaming assistant text is split into sentences ->
 * /speak -> sequential playback. Speaking while Eve talks (barge-in) aborts playback
 * and resumes listening. STT and TTS are each optional; the not-attached cases notify
 * via the admin toast. Browser-only; relies on getUserMedia + Web Audio + @ricky0123/vad-web.
 */
export function useVoice({ sttAvailable, ttsAvailable, status, assistantText, onTranscript }: UseVoiceArgs) {
  const [active, setActive] = useState(false)
  const [state, setState] = useState<VoiceState>('idle')

  const vadRef = useRef<{ start: () => void; pause: () => void; destroy: () => void } | null>(null)
  const streamerRef = useRef(createSentenceStreamer())
  const queueRef = useRef<HTMLAudioElement[]>([])
  const playingRef = useRef(false)
  const speakAbortRef = useRef<AbortController | null>(null)
  const transcribeAbortRef = useRef<AbortController | null>(null)
  // Use a stable ref so the recursive playNext call avoids the
  // react-hooks/immutability forward-reference and render-time-ref-write rules.
  const playNextRef = useRef<() => void>(null)

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

  const clearPlayback = useCallback(() => {
    speakAbortRef.current?.abort()
    speakAbortRef.current = null
    for (const a of queueRef.current) {
      URL.revokeObjectURL(a.src)
      a.pause()
      a.removeAttribute('src')
    }
    queueRef.current = []
    playingRef.current = false
  }, [])

  const speakSentence = useCallback(
    async (sentence: string) => {
      const controller = new AbortController()
      speakAbortRef.current?.abort()
      speakAbortRef.current = controller
      try {
        const res = await fetch('/api/eve/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sentence }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        queueRef.current.push(new Audio(blobUrl))
        playNext()
      } catch {
        // aborted (barge-in) or network error: ignore, stay responsive
      }
    },
    [playNext],
  )

  const handleUtterance = useCallback(
    async (pcm: Float32Array) => {
      setState('transcribing')
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
          streamerRef.current = createSentenceStreamer()
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

  // Feed streamed assistant text to TTS as sentences complete (only when TTS attached).
  useEffect(() => {
    if (!active || !ttsAvailable || !assistantText) return
    for (const sentence of streamerRef.current.push(assistantText)) void speakSentence(sentence)
  }, [assistantText, active, ttsAvailable, speakSentence])

  // Flush the trailing sentence when the LLM stream finishes.
  useEffect(() => {
    if (!active || !ttsAvailable) return
    if (status !== 'streaming' && status !== 'submitted') {
      for (const sentence of streamerRef.current.flush()) void speakSentence(sentence)
    }
  }, [status, active, ttsAvailable, speakSentence])

  const start = useCallback(async () => {
    // Guard: a hands-free loop needs speech input.
    if (!sttAvailable) {
      toast.error('No speech-to-text service is attached.')
      return
    }
    if (!ttsAvailable) {
      toast.info("No text-to-speech attached — Eve's replies won't be spoken.")
    }
    try {
      const { MicVAD } = await import('@ricky0123/vad-web')
      const vad = await MicVAD.new({
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
