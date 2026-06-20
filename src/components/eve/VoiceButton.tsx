'use client'

import { useEffect, useRef } from 'react'
import { MicIcon } from 'lucide-react'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { EqualizerBars } from './EqualizerBars'

type Voice = {
  available: boolean
  listening: boolean
  state: 'idle' | 'listening' | 'thinking' | 'speaking'
  startListening: () => void | Promise<void>
  stopListening: () => void
}

const TAP_MS = 250 // press shorter than this = tap (latched); longer = hold-to-talk

/**
 * Push-to-talk mic. Three ways to talk, no VAD/barge-in needed:
 *  - **Hold** the button (press & hold, release to send).
 *  - **Tap** the button to toggle latched listening (tap again to send).
 *  - **Hold the Space key** (when not typing in a field) to talk.
 * The keyboard shortcut is shown in the tooltip on hover.
 */
export function VoiceButton({ voice }: { voice: Voice }) {
  const engagedRef = useRef(false) // intent: are we in a listening session
  const pressedRef = useRef(false) // is the pointer currently down on the button
  const pressStartRef = useRef(0)
  const stopOnReleaseRef = useRef(false) // this press should stop on release
  const keyHeldRef = useRef(false)

  // Keyboard PTT: hold Space (ignored while typing in an input/textarea/contenteditable).
  useEffect(() => {
    // Only let Space type when the focused field ALREADY has text — otherwise Space is PTT.
    // (The chat composer is focused by default, so bailing on any focused field meant the
    // shortcut never fired.)
    const typingWithText = () => {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) return false
      const isField =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      if (!isField) return false
      const value = el.isContentEditable ? (el.textContent ?? '') : (el.value ?? '')
      return value.trim().length > 0
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || keyHeldRef.current || typingWithText()) return
      e.preventDefault()
      keyHeldRef.current = true
      engagedRef.current = true
      void voice.startListening()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !keyHeldRef.current) return
      e.preventDefault()
      keyHeldRef.current = false
      engagedRef.current = false
      voice.stopListening()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [voice])

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    pressedRef.current = true
    pressStartRef.current = Date.now()
    if (engagedRef.current) {
      // Already listening (latched from a prior tap) → this press stops it.
      stopOnReleaseRef.current = true
    } else {
      engagedRef.current = true
      stopOnReleaseRef.current = false
      void voice.startListening()
    }
  }

  const endPress = () => {
    if (!pressedRef.current) return
    pressedRef.current = false
    const held = Date.now() - pressStartRef.current
    if (stopOnReleaseRef.current || held >= TAP_MS) {
      engagedRef.current = false
      voice.stopListening()
    }
    // else: a quick tap that started a session → stay latched (listening).
  }

  const tip = voice.listening
    ? 'Release / tap to send'
    : 'Hold to talk · tap to toggle · or hold Space'

  return (
    <PromptInputButton
      type="button"
      tooltip={tip}
      aria-label={tip}
      aria-pressed={voice.listening}
      className={voice.listening ? 'text-primary' : ''}
      onPointerDown={onPointerDown}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
    >
      {voice.listening ? (
        <EqualizerBars
          className={voice.state === 'thinking' || voice.state === 'speaking' ? 'opacity-50' : ''}
        />
      ) : (
        <MicIcon className="size-4" />
      )}
    </PromptInputButton>
  )
}
