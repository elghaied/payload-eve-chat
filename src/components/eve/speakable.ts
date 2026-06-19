// On voice turns Eve wraps a short spoken summary in <speak>…</speak> at the
// start of her reply. The browser speaks only that block; the chat shows the
// rest. These pure helpers extract the spoken text and strip the block for
// display, and tolerate a partially-streamed (unclosed) block.

const OPEN = '<speak>'
const CLOSE = '</speak>'

/**
 * Inner text of the <speak> block, for TTS. Returns the content after <speak>
 * (up to </speak> if closed, otherwise to the end so it can stream
 * incrementally). Returns null when no <speak> tag has appeared yet.
 */
export function extractSpeak(text: string): string | null {
  const open = text.indexOf(OPEN)
  if (open === -1) return null
  const start = open + OPEN.length
  const close = text.indexOf(CLOSE, start)
  return close === -1 ? text.slice(start) : text.slice(start, close)
}

/**
 * Remove the <speak>…</speak> block for display. Drops a still-open block
 * (mid-stream) from <speak> to the end, and preserves text before/after.
 */
export function stripSpeak(text: string): string {
  const open = text.indexOf(OPEN)
  if (open === -1) return text
  const close = text.indexOf(CLOSE, open + OPEN.length)
  const before = text.slice(0, open)
  const after = close === -1 ? '' : text.slice(close + CLOSE.length)
  return (before + after).trim()
}

/**
 * Strip content the TTS shouldn't read aloud — emoji and pictographs (incl. flag
 * pairs, variation selectors, and ZWJ joiners) — then collapse the gaps. Returns
 * '' when nothing speakable remains (caller should skip synthesizing).
 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // regional indicators (flag halves)
    .replace(/[︀-️‍]/gu, '') // variation selectors + zero-width joiner
    .replace(/\s{2,}/g, ' ')
    .trim()
}
