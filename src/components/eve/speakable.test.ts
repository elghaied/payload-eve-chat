import { describe, expect, it } from 'vitest'
import {
  extractSpeak,
  firstSentences,
  removeSpeakTags,
  stripForSpeech,
  stripSpeak,
} from './speakable'

describe('removeSpeakTags', () => {
  it('keeps inner text, drops only the tags', () => {
    expect(removeSpeakTags('<speak>Hi there.</speak> More detail.')).toBe('Hi there. More detail.')
  })
  it('handles an unclosed (streaming) tag', () => {
    expect(removeSpeakTags('<speak>partial')).toBe('partial')
  })
  it('returns text unchanged when no tags', () => {
    expect(removeSpeakTags('plain reply')).toBe('plain reply')
  })
})

describe('firstSentences', () => {
  it('returns the first N sentences', () => {
    expect(firstSentences('One. Two. Three.', 2)).toBe('One. Two.')
  })
  it('handles text with no sentence punctuation', () => {
    expect(firstSentences('no punctuation here', 2)).toBe('no punctuation here')
  })
})

describe('extractSpeak', () => {
  it('returns null before any <speak> tag appears', () => {
    expect(extractSpeak('I am creating the post')).toBeNull()
  })

  it('returns the inner content of a closed block', () => {
    expect(extractSpeak('<speak>Done, created "Hi".</speak>\n\nFull details follow.')).toBe(
      'Done, created "Hi".',
    )
  })

  it('returns partial inner content while the block is still open (streaming)', () => {
    expect(extractSpeak('<speak>Done, crea')).toBe('Done, crea')
  })

  it('finds the block even when it is not at the start', () => {
    expect(extractSpeak('Detailed reply.\n<speak>All set.</speak>')).toBe('All set.')
  })
})

describe('stripSpeak', () => {
  it('leaves text without a block unchanged', () => {
    expect(stripSpeak('Just a normal reply.')).toBe('Just a normal reply.')
  })

  it('removes a closed block and keeps the surrounding reply', () => {
    expect(stripSpeak('<speak>All set.</speak>\n\nHere is the full reply.')).toBe(
      'Here is the full reply.',
    )
  })

  it('drops an unclosed block mid-stream (shows nothing until it closes)', () => {
    expect(stripSpeak('<speak>All se')).toBe('')
  })

  it('preserves text before an (unclosed) block', () => {
    expect(stripSpeak('Intro. <speak>summary')).toBe('Intro.')
  })
})

describe('stripForSpeech', () => {
  it('removes emoji and collapses the gap', () => {
    expect(stripForSpeech('Done! 🚀 Created the post.')).toBe('Done! Created the post.')
  })

  it('trims a trailing emoji', () => {
    expect(stripForSpeech('All set ✅')).toBe('All set')
  })

  it('removes flag emoji (regional indicator pairs)', () => {
    expect(stripForSpeech('Ship it 🇺🇸 today')).toBe('Ship it today')
  })

  it('returns empty when only emoji remain', () => {
    expect(stripForSpeech('🎉🎉')).toBe('')
  })

  it('leaves plain text unchanged', () => {
    expect(stripForSpeech('Just a normal sentence.')).toBe('Just a normal sentence.')
  })
})
