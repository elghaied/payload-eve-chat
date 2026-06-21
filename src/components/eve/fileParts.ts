import type { FileUIPart, FilePart, UserContent } from 'ai'

// NOTE: do NOT import from 'eve/client' here. Its barrel transitively pulls in Eve's
// runtime (compiled zod + workflow chunk that requires `node:module`), which Turbopack
// cannot place in the browser bundle ("does not support external modules"). This is a
// client component, so we build the AI SDK FilePart inline instead — it's trivial.

/** Base64-encode bytes in the browser without blowing the call stack on large inputs. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Build an AI SDK FilePart whose data is an inline `data:` URL (browser-safe). */
function toDataUrlFilePart(input: {
  bytes: Uint8Array
  filename?: string
  mediaType: string
}): FilePart {
  const dataUrl = `data:${input.mediaType};base64,${uint8ToBase64(input.bytes)}`
  return { type: 'file', data: dataUrl, mediaType: input.mediaType, filename: input.filename }
}

/**
 * Converts an array of FileUIPart (with data: URLs already resolved by PromptInput)
 * and an optional text string into an AI SDK UserContent array.
 *
 * Each file is fetched (data URL → ArrayBuffer → Uint8Array) and converted to a
 * FilePart with an inline data: URL. Files that fail to convert are skipped with a
 * console.warn. If all files fail and text is also empty, returns [{type:'text',text:''}]
 * — the caller's empty-turn guard detects this exact shape and aborts the send before it
 * reaches the AI Gateway.
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
        toDataUrlFilePart({
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
