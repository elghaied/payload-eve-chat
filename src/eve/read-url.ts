import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { assertFetchableUrl } from './url-safety'

const DEFAULT_MAX_CHARS = 12_000
const MAX_BYTES = 2_000_000

/** Extract the main readable title + text from an HTML string (scripts disabled). */
export function extractReadable(html: string, url: string): { title: string; text: string } {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const article = new Readability(doc).parse()
  const title = (article?.title || doc.title || '').trim()
  const raw = article?.textContent || doc.body?.textContent || ''
  return { title, text: raw.replace(/\s+/g, ' ').trim() }
}

/** Safely fetch a page and return its readable text, truncated to a context budget. */
export async function readUrl({
  url,
  maxChars = DEFAULT_MAX_CHARS,
}: {
  url: string
  maxChars?: number
}): Promise<{ title: string; url: string; text: string; truncated: boolean }> {
  const target = await assertFetchableUrl(url)
  // We validate the initial URL above and re-validate the final URL after redirects (below).
  // Using redirect:'follow' means intermediate redirect hops are not individually inspected —
  // a known, accepted limitation; only the origin and final destination are checked.
  const res = await fetch(target, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
  // Re-validate the final URL host after any redirects.
  // Fall back to the original `url` if res.url is empty (e.g. constructed Response in tests).
  await assertFetchableUrl(res.url || url)

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('html') && !contentType.includes('xml')) {
    throw new Error(`Not an HTML page (${contentType || 'unknown'})`)
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('Page too large')

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new Error('Page too large')
  const html = new TextDecoder().decode(buffer)

  const finalUrl = res.url || url
  const { title, text } = extractReadable(html, finalUrl)
  const truncated = text.length > maxChars
  return { title, url: finalUrl, text: truncated ? text.slice(0, maxChars) : text, truncated }
}
