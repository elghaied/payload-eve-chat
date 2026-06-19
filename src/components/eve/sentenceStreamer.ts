export type SentenceStreamer = {
  /** Feed the latest *full* text of the streaming assistant message.
   *  Returns sentences newly completed since the last push (possibly empty). */
  push(fullText: string): string[]
  /** Stream finished: returns any trailing remainder as a final sentence (or []). */
  flush(): string[]
}

// Lowercased tokens that end in '.' but do not end a sentence.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
])

const isBoundaryChar = (c: string): boolean =>
  c === '.' || c === '!' || c === '?' || c === '\n' || c === '。' || c === '！' || c === '？'

const isWhitespace = (c: string | undefined): boolean => c === undefined || /\s/.test(c)

const isAscii = (c: string): boolean => c.charCodeAt(0) < 128

const isCjkBoundary = (c: string): boolean => c === '。' || c === '！' || c === '？'

/** Is the '.' at `i` actually a decimal point or part of an abbreviation? */
function isNonTerminalDot(text: string, i: number): boolean {
  const before = text[i - 1]
  const after = text[i + 1]
  if (before >= '0' && before <= '9' && after >= '0' && after <= '9') return true
  const word = (text.slice(0, i).match(/([A-Za-z.]+)$/)?.[1] ?? '').toLowerCase()
  return ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.replace(/\.$/, ''))
}

export function createSentenceStreamer(): SentenceStreamer {
  let consumed = 0
  let lastText = ''

  function scan(fullText: string, final: boolean): string[] {
    const out: string[] = []
    let start = consumed
    let i = consumed

    while (i < fullText.length) {
      const c = fullText[i]
      if (!isBoundaryChar(c)) {
        i++
        continue
      }
      if (c === '.' && isNonTerminalDot(fullText, i)) {
        i++
        continue
      }
      // Consume a run of boundary characters (e.g. "?!", "...").
      let j = i + 1
      while (j < fullText.length && isBoundaryChar(fullText[j])) j++

      const atEnd = j >= fullText.length
      // A sentence is complete when its boundary is followed by whitespace/text,
      // a newline, or we are flushing the final text.
      // CJK punctuation emits even if followed by non-ASCII; Latin punctuation requires whitespace/end.
      if (c === '\n' || (!atEnd && (isWhitespace(fullText[j]) || (isCjkBoundary(c) && !isAscii(fullText[j])))) || (atEnd && final)) {
        const sentence = fullText.slice(start, j).trim()
        if (sentence) out.push(sentence)
        // Skip trailing whitespace so the next sentence starts clean.
        let k = j
        while (k < fullText.length && /\s/.test(fullText[k])) k++
        consumed = k
        start = k
        i = k
        continue
      }
      if (atEnd && !final) break // boundary at very end mid-stream: keep buffered
      i = j
    }

    if (final) {
      const remainder = fullText.slice(consumed).trim()
      if (remainder) out.push(remainder)
      consumed = fullText.length
    }
    return out
  }

  return {
    push(fullText: string) {
      lastText = fullText
      return scan(fullText, false)
    },
    flush() {
      return scan(lastText, true)
    },
  }
}
