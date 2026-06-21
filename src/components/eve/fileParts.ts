import type { FileUIPart, FilePart, UserContent } from 'ai'
import { createDataUrlFilePart } from 'eve/client'

/**
 * Converts an array of FileUIPart (with data: URLs already resolved by PromptInput)
 * and an optional text string into an AI SDK UserContent array.
 *
 * Each file is fetched (data URL → ArrayBuffer → Uint8Array) and converted to a
 * FilePart via createDataUrlFilePart from 'eve/client'. Files that fail to convert
 * are skipped with a console.warn. If all files fail and text is also empty, returns
 * [{type:'text',text:''}] — the caller's empty-turn guard detects this exact shape
 * and aborts the send before it reaches the AI Gateway.
 */
export async function buildUserContent(
  text: string,
  files: FileUIPart[],
): Promise<UserContent> {
  const trimmedText = text.trim()

  const fileParts: FilePart[] = []
  for (const f of files) {
    try {
      const res = await fetch(f.url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const buf = await res.arrayBuffer()
      fileParts.push(
        createDataUrlFilePart({
          bytes: new Uint8Array(buf),
          filename: f.filename,
          mediaType: f.mediaType,
        }),
      )
    } catch (err) {
      console.warn(`[eve] buildUserContent: failed to read file ${f.filename ?? f.url}`, err)
    }
  }

  if (trimmedText && fileParts.length > 0) {
    return [{ type: 'text', text: trimmedText }, ...fileParts]
  }
  if (fileParts.length > 0) {
    return fileParts
  }
  // All files failed or no files; return text-only (may be empty string — caller guards)
  return [{ type: 'text', text: trimmedText }]
}
