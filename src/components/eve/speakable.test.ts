import { describe, expect, it } from 'vitest'
import { extractSpeak, stripSpeak } from './speakable'

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
