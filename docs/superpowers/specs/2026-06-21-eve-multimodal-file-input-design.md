# Eve Multimodal File Input — Design Spec

## Goal

Allow users to attach images and PDFs in the Eve chat composer so the model can read and reason about them, with no Payload Media persistence (option A: model-only, ephemeral).

---

## Architecture

The existing `PromptInput` component in `src/components/ai-elements/prompt-input.tsx` already handles file attachment UI — drag-and-drop, paste, file dialog, blob URL management, size/type filtering, and converting blob URLs to data URLs before calling `onSubmit`. `EveChat` adds `accept`, `maxFileSize`, and `maxFiles` props to `PromptInput`, reads `message.files` in `handleSubmit`, converts each file's blob data URL to bytes via `fetch`, builds AI SDK `UserContent` using `createDataUrlFilePart` / `createTextWithFileContent` from `eve/client`, then calls `agent.send({ message: userContent })`. Attached-file previews in the user bubble are rendered from a local-state sidecar (a `Map<turnKey, FileUIPart[]>`) because eve's `defaultMessageReducer` only stores a text summary of `UserContent` in the projected `EveMessage` — file parts never appear in `agent.data.messages`.

---

## Verified Facts from Installed Dists

**`eve/client` file-part exports** (confirmed in `dist/src/client/file-parts.d.ts` and `.js`):

```ts
// from 'eve/client'
createDataUrlFilePart(input: { bytes: Uint8Array; filename?: string; mediaType: string }): FilePart
createTextWithFileContent(input: { bytes: Uint8Array; filename?: string; mediaType: string; text: string }): UserContent
```

`createTextWithFileContent` returns `[{ type:'text', text }, createDataUrlFilePart(...)]` — an array that is valid `UserContent` (AI SDK `UserContent = string | Array<TextPart | FilePart | ImagePart | ...>`).

**`SendTurnPayload.message`** (confirmed in `dist/src/client/types.d.ts`):

```ts
readonly message?: string | UserContent;
```

`UserContent` is imported from `'ai'`. Passing an array of parts is valid.

**`defaultMessageReducer` user-message projection** (confirmed in `dist/src/client/message-reducer.js`):

- On `client.message.submitted` (optimistic): projects `parts: [{ type:'text', text: summarizeUserContent(message) }]` — for `UserContent`, `summarizeUserContent` joins text parts and renders file parts as `[file: filename]` or `[file]`. No file/image parts appear.
- On `message.received` (server confirm): `parts: [{ type:'text', text: message, state:'done' }]` — same, text only.

Conclusion: **file previews must be stored in local state, keyed per turn, not read from `agent.data.messages`.**

**`PromptInputMessage`** (confirmed in `src/components/ai-elements/prompt-input.tsx`, line 484):

```ts
export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];  // FileUIPart from 'ai'
}
```

`PromptInput.onSubmit` already converts blob URLs to data URLs before calling the handler (lines 862-877). `EveChat.handleSubmit` receives data-URL strings in `message.files[*].url`. Blob-to-bytes conversion is therefore `fetch(dataUrl)` then `.arrayBuffer()`.

**`PromptInput` built-in constraints** (confirmed in `src/components/ai-elements/prompt-input.tsx`):

- `accept` prop: comma-separated MIME types, validated on add + provider-side.
- `maxFileSize` prop: bytes, enforced in `addLocal` / `addWithProviderValidation`.
- `maxFiles` prop: integer cap.
- `onError` prop: `(err: { code: 'max_files' | 'max_file_size' | 'accept'; message: string }) => void`.

The existing `PromptInputTextarea` already handles paste-to-attach (lines 1014-1038) and backspace-to-remove-last (lines 998-1009).

**`FileUIPart`** (confirmed in `ai` dist `dist/index.d.ts`):

```ts
type FileUIPart = { type:'file'; mediaType: string; filename?: string; url: string; ... }
```

The `url` field after `PromptInput`'s conversion holds a `data:` URL.

---

## Supported Types and Size Cap

**Supported MIME types** (Haiku 4.5 multimodal capabilities):
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`

Set `accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"` on `PromptInput`.

**Size cap: 4 MB per file, max 5 files per turn.**

Rationale: data URLs ride in the HTTP request body to the Eve agent process and then in the model context window. Haiku 4.5's context is ~200K tokens; a 4 MB image base64-encodes to ~5.4 MB of text (roughly 1350 tokens per KB at typical vision encoding). Five 4 MB images ≈ 27 MB of base64 — still within practical HTTP limits (Eve runs locally, no Vercel 4.5 MB function limit applies to the Eve child process), but keeps individual requests sane. A 4 MB cap also covers most real-world photos compressed to JPEG.

Rejection: handled by `PromptInput`'s existing `onError` callback; `EveChat` renders a dismissible toast-style inline notice (a `<p>` below the composer) with the error message.

---

## Components & Files

| Path | Change | Responsibility |
|------|--------|----------------|
| `src/components/eve/EveChat.tsx` | **Modify** | Wire `PromptInput` constraints, convert data-URL files to `UserContent` in `handleSubmit`, maintain `attachedFilesRef` sidecar, render file previews in user bubble |
| `src/components/eve/AttachmentPreview.tsx` | **Create** | Pure presentational: image thumbnail or file chip for a `FileUIPart`; used both in the user bubble (post-send) and potentially in a pre-send preview strip |
| `src/components/ai-elements/prompt-input.tsx` | **No change** | Already provides all attachment UI primitives needed |

No new dependencies required. All imports are from existing packages: `eve/client` (already installed), `ai` (already installed), React.

---

## Data Flow

```
User drops/selects/pastes file
        │
        ▼
PromptInput.add()
  → validates accept + maxFileSize + maxFiles
  → stores FileUIPart with blob: URL in local attachments state
  → renders thumbnail strip above textarea (existing PromptInputHeader + AttachmentPreview)
        │
User types text + hits Enter / Submit
        │
        ▼
PromptInput.handleSubmit (internal)
  → converts each blob: URL to data: URL via convertBlobUrlToDataUrl()
  → calls EveChat.handleSubmit({ text, files: FileUIPart[] })
        │
        ▼
EveChat.handleSubmit (modified)
  1. text = message.text.trim()
  2. files = message.files  (data: URLs already resolved)
  3. if files.length === 0:
       agent.send({ message: text })          // existing path, unchanged
  4. else:
       // read bytes for each file
       const parts: UserContent = await buildUserContent(text, files)
       // store for preview sidecar (keyed by submit counter)
       const turnKey = ++submitCountRef.current
       attachedFilesRef.current.set(turnKey, files)
       // send
       agent.send({ message: parts })
       // after send resolves, associate turnKey → sessionMessageId is not needed
       // because preview is keyed optimistically per turn order
        │
        ▼
Eve agent process receives UserContent
  → model sees text + inline base64 file(s)
  → model responds normally
        │
        ▼
EveChat message render loop (user messages)
  m.role === 'user'
    → render text part (existing: MessageResponse)
    → if attachedFilesRef has files for this message's position:
        render <AttachmentPreview /> for each file
```

**Attachment lookup strategy:** Because the reducer replaces the optimistic user message with the confirmed one (matching by `submissionId`), and because message order is stable, the simplest correlation is: maintain `pendingAttachmentsRef: Map<number, FileUIPart[]>` keyed by a per-submit counter, and separately maintain `confirmedAttachmentsRef: Map<string, FileUIPart[]>` keyed by message ID. When a user message renders, check its `id`:
- If `id.startsWith('optimistic:')` → look up by the last unconfirmed counter entry.
- Once the server confirms (`message.received` replaces optimistic), the message gets a stable id like `${turnId}:user`. At that point, transfer the attachment from the optimistic key to the confirmed id.

A simpler alternative: store `{ messageId: string, files: FileUIPart[] }[]` as state, push optimistic id on submit, leave in place (the optimistic id is stable in the list even after server replace since `upsertMessage` replaces by matching id). This works because `optimisticUserMessageId(submissionId)` produces the id used both optimistically and replaced on confirm — so once replaced, the id changes. **Chosen approach: store `lastSubmittedFiles` in a `useRef<FileUIPart[] | null>` reset to null after the next user message renders, combined with a `Map<messageId, FileUIPart[]>` for already-rendered turns.**

Concretely: a `useState<Map<string, FileUIPart[]>>` named `attachmentsByMessageId` is updated in `handleSubmit` using the optimistic message id (which can be computed deterministically: `optimistic:${submissionId}:user` — but that's internal to eve). Simpler: pass files down through a `useRef` queue — each submit pushes files, each newly-rendered user message pops one — reliable since messages are always appended in order.

**Recommended final approach:** `pendingFileQueue = useRef<FileUIPart[][]>([])`. On submit with files: `pendingFileQueue.current.push(files)`. In the render loop, track how many user messages have been rendered with a `useRef<number>` count; when a new user message appears at index `n`, pop `pendingFileQueue.current[n]` if it exists. This is fully deterministic because the eve message list is append-only.

---

## Interfaces

### `buildUserContent` (internal helper in EveChat.tsx)

```ts
async function buildUserContent(
  text: string,
  files: FileUIPart[],         // data: URL already resolved
): Promise<UserContent> {
  // Fetch each data URL → bytes, build FilePart array
  const fileParts: FilePart[] = await Promise.all(
    files.map(async (f) => {
      const res = await fetch(f.url)
      const buf = await res.arrayBuffer()
      return createDataUrlFilePart({
        bytes: new Uint8Array(buf),
        filename: f.filename,
        mediaType: f.mediaType,
      })
    })
  )
  if (text.trim()) {
    return [{ type: 'text', text }, ...fileParts]
  }
  return fileParts  // file(s) only (unlikely but legal)
}
```

Note: `createTextWithFileContent` only handles a single file + text. For multiple files, build the array manually as above.

### `AttachmentPreview` component

```ts
interface AttachmentPreviewProps {
  file: FileUIPart
  onRemove?: (file: FileUIPart) => void  // present only in pre-send strip
  className?: string
}
```

- If `file.mediaType.startsWith('image/')`: render `<img src={file.url} className="max-h-24 rounded object-cover" alt={file.filename ?? 'attachment'} />`
- Otherwise (PDF): render a chip — filename + a document icon.
- `onRemove` renders an X button for the pre-send strip only.

### Pre-send strip

Rendered inside `PromptInput` as a `PromptInputHeader` child, between the hidden file input and the textarea. Uses the `usePromptInputAttachments()` hook (available within `PromptInput`) to read `attachments.files` and `attachments.remove`.

### `handleSubmit` signature change in EveChat

```ts
// Before (text only):
const handleSubmit = async (message: PromptInputMessage) => {
  const text = message.text?.trim()
  if (!text) return
  ...
  await agent.send({ message: text })
}

// After:
const handleSubmit = async (message: PromptInputMessage) => {
  const text = message.text?.trim()
  const hasFiles = message.files.length > 0
  if (!text && !hasFiles) return
  ...
  const userContent = hasFiles
    ? await buildUserContent(text ?? '', message.files)
    : text!
  if (hasFiles) pendingFileQueue.current.push(message.files)
  await agent.send({ message: userContent })
}
```

### `PromptInput` props added to the instance in EveChat

```tsx
<PromptInput
  onSubmit={handleSubmit}
  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
  maxFileSize={4 * 1024 * 1024}   // 4 MB
  maxFiles={5}
  onError={(err) => setAttachError(err.message)}
  className="mt-3"
>
```

---

## Interaction with Existing Send Paths

| Path | Files applicable? | Change |
|------|------------------|--------|
| `handleSubmit` (text submit) | YES | Modified to call `buildUserContent` when `message.files.length > 0` |
| Voice `onTranscript` | NO | Calls `agent.send({ message: text, clientContext: ... })` directly — no file UI at all; voice and file attachment are mutually exclusive in the same turn |
| HITL `handleRespondInput` | NO | Calls `agent.send({ inputResponses: [...] })` — no message field involved |
| Retry `handleRetry` | NO | Re-sends last user text only; does not replay files |

The submit button disabled check must be updated: currently `!input.trim()` disables the button. It should be `!input.trim() && !hasAttachments` so a file-only message (no text) can be submitted.

The voice mic button and the attach button coexist in `PromptInputTools`. They are independent; no mutual exclusion needed. A user can type + attach + send while voice is not listening. While voice IS listening (`voice.listening === true`), the voice transcript fires immediately on speech end and calls `agent.send` directly — files staged in the composer are NOT included, which is correct and expected.

---

## File Preview in User Message Bubble

The message render loop in `EveChatInner` currently maps over `m.parts` for each `EveMessage`. After rendering the text part for a user message, look up pending files by queue index:

```tsx
// In the message render loop, after the text part:
{m.role === 'user' && (() => {
  const userMsgIndex = userMessagesSeen++  // ref or derived count
  const files = renderedUserAttachments.get(m.id) 
    ?? pendingFileQueue.current[userMsgIndex]
  if (!files?.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {files.map((f, i) => (
        <AttachmentPreview key={i} file={f} />
      ))}
    </div>
  )
})()}
```

Since `EveMessage.parts` for a user message only ever contains one text part (from `defaultMessageReducer`), the file previews are appended after it, visually below the user's text in the same bubble.

---

## Error Handling

| Failure | Handling |
|---------|----------|
| File exceeds 4 MB | `PromptInput.onError({ code:'max_file_size' })` → `attachError` state → inline notice below composer, auto-dismiss on next submit or file removal |
| Unsupported type | `PromptInput.onError({ code:'accept' })` → same inline notice |
| More than 5 files | `PromptInput.onError({ code:'max_files' })` → same inline notice |
| `buildUserContent` fetch fails (data URL unreadable) | `try/catch` in `handleSubmit`; skip that file and log a warning; if all files fail, fall back to text-only send |
| Text blank AND no files | Guard at top of `handleSubmit`: `if (!text && !hasFiles) return` |
| Model is text-only | The model silently ignores `FilePart`s it cannot decode. No special client-side handling; document in agent instructions or skill that attachments require a multimodal model |

---

## Testing Strategy

All tests use vitest in jsdom environment. RTL is available but no jest-dom matchers (use `toBeTruthy()`, `toBeNull()`, `querySelector`, etc.).

**Unit tests to add:**

1. `buildUserContent.test.ts` — Test the helper function:
   - Single image file + text → returns `[{ type:'text' }, { type:'file', mediaType:'image/jpeg', data:... }]`
   - Multiple files + text → correct array length
   - No text + one file → returns array with only the file part
   - Verifies `createDataUrlFilePart` produces a `data:` URL data field (mock `fetch`)

2. `AttachmentPreview.test.tsx` — Test the component:
   - Image file renders `<img>` with correct `src`
   - PDF file renders a chip with filename, no `<img>`
   - `onRemove` fires when X button clicked
   - No `onRemove` → X button absent

3. `EveChat.handleSubmit.test.ts` (extend existing coverage if present, or new file):
   - Files-only message is NOT blocked when text is empty
   - Text-only message still works (existing behavior unchanged)
   - `pendingFileQueue` is populated on submit with files
   - Voice `onTranscript` does NOT touch `pendingFileQueue`

**Integration / type checks:**
- `tsc --noEmit` must pass with the new component and modified `EveChat`.
- `pnpm devsafe` smoke test: attach an image, send "what do you see?", verify the model responds (costs 1 Haiku call — do manually, not in CI).

**What NOT to test automatically:**
- Actual model vision (live gateway call, costs credits).
- File drag-and-drop behavior (requires browser environment beyond jsdom).

---

## Cost / Credit Considerations

- Every file attached adds base64-encoded bytes to the model context. At 4 MB per file, five files = ~5.4 MB × 5 ≈ 27 MB of base64 per turn (but this is worst case; typical JPEG photos are 0.5–2 MB).
- Haiku 4.5 vision pricing: input tokens for images follow Anthropic's tile-based pricing (~1600 tokens per 512×512 tile for dense images). A full-resolution 4 MB JPEG might be ~8–12K tokens extra.
- The 4 MB cap + 5 file limit prevents the worst runaway cases. A note in the template README (or Eve's instructions skill) should remind template users that multimodal turns are more expensive.
- No server-side cost: files never touch Payload, S3, or any storage — pure in-request base64.

---

## Open Questions / Risks

1. **Eve process HTTP body limit:** The Eve child process listens on a local port. Its default body-size limit (if any) is unknown. Five 4 MB files ≈ 27 MB base64 in a POST body could hit a default Node.js / framework limit. Verify in implementation by checking Eve's server config or testing with a large file. If needed, reduce `maxFiles` to 3 or `maxFileSize` to 2 MB.

2. **Optimistic file preview queue correctness:** The queue-index approach assumes user messages are append-only and never re-ordered. This holds for the eve `defaultMessageReducer` as verified, but could break if a future eve version reorders messages. A more robust approach would be to intercept the optimistic message id from `summarizeUserContent` — but that id (`optimistic:${submissionId}:user`) is built internally by eve-agent-store and not exposed. Consider filing an upstream feature request for eve to expose the submission id in the reducer event.

3. **`message.received` text field:** When the server confirms the user message, it sends `t.data.message` (a string). For `UserContent` inputs, this string is presumably the server's serialization of the user content. It is unclear whether eve's server side also calls `summarizeUserContent` or sends something different. The text-only preview of the user bubble text may show `[file: filename]` placeholders — this is acceptable since the actual image preview renders from local state.

4. **Retry behavior:** `handleRetry` re-sends the last user message's text only (extracted from `m.parts.text`). Files are not re-attached. This is intentional and documented; the user must re-attach if they want to retry with the same file.

5. **PDF support on Haiku 4.5:** Claude Haiku 4.5 supports PDFs via the Anthropic API, but gateway routing might strip or reject PDF file parts depending on the provider gateway's multi-part handling. Test manually with a PDF before shipping.
