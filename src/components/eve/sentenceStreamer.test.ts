import { describe, expect, it } from 'vitest'
import { createSentenceStreamer } from './sentenceStreamer'

describe('createSentenceStreamer', () => {
  it('emits a sentence only once its boundary is followed by more text', () => {
    const s = createSentenceStreamer()
    expect(s.push('Hello there')).toEqual([])
    expect(s.push('Hello there. How')).toEqual(['Hello there.'])
    expect(s.push('Hello there. How are you? I')).toEqual(['How are you?'])
    expect(s.flush()).toEqual(['I'])
  })

  it('does not split on decimals or common abbreviations', () => {
    const s = createSentenceStreamer()
    expect(s.push('Pi is 3.14 and e.g. this continues')).toEqual([])
    expect(s.flush()).toEqual(['Pi is 3.14 and e.g. this continues'])
  })

  it('splits on newlines', () => {
    const s = createSentenceStreamer()
    expect(s.push('Line one\nLine two')).toEqual(['Line one'])
    expect(s.flush()).toEqual(['Line two'])
  })

  it('handles multiple sentences arriving in one push', () => {
    const s = createSentenceStreamer()
    expect(s.push('One. Two! Three? ')).toEqual(['One.', 'Two!', 'Three?'])
    expect(s.flush()).toEqual([])
  })

  it('handles CJK sentence punctuation', () => {
    const s = createSentenceStreamer()
    expect(s.push('こんにちは。元気ですか')).toEqual(['こんにちは。'])
    expect(s.flush()).toEqual(['元気ですか'])
  })

  it('drops whitespace-only remainders on flush', () => {
    const s = createSentenceStreamer()
    expect(s.push('Done.   ')).toEqual(['Done.'])
    expect(s.flush()).toEqual([])
  })

  it('does not split a Latin boundary glued to a non-ASCII char', () => {
    const s = createSentenceStreamer()
    expect(s.push('Bonjour.Über continues')).toEqual([])
    expect(s.flush()).toEqual(['Bonjour.Über continues'])
  })
})
