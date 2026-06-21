# Eve Multimodal File Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Allow users to attach images and PDFs in the Eve chat composer so the model can read and reason about them — ephemeral, no Payload Media storage (option A). When attachments are present, `EveChat.handleSubmit` converts them to AI SDK `UserContent` via `eve/client` helpers and sends `{ message: userContent }`. Attached files are previewed in the user message bubble via a local sidecar queue (not from `agent.data.messages`, which only stores a text summary).

**Architecture:** `PromptInput` already provides the full attachment UI (drag-drop, paste, file dialog, blob→data-URL conversion, `onError`). `EveChat` adds `accept` / `maxFileSize` / `maxFiles` / `onError` props to its existing `<PromptInput>` instance, plus a new `<PromptInputHeader>` pre-send strip using `usePromptInputAttachments()`. A new pure helper module `src/components/eve/fileParts.ts` exports `buildUserContent` (unit-testable, no DOM). A new presentational `src/components/eve/AttachmentPreview.tsx` renders one `FileUIPart` as an image thumbnail or PDF chip. In `EveChatInner`, a `pendingFileQueue = useRef<FileUIPart[][]>([])` ties each submit to the nth user message in the append-only message list. The text-only path is untouched; voice and HITL paths are explicitly excluded.

**Tech Stack:** React, `eve/client` (`createDataUrlFilePart`, `createTextWithFileContent` — confirmed in `node_modules/eve/dist/src/client/index.d.ts`), `ai` (`FileUIPart`, `UserContent`, `FilePart` — already imported in `prompt-input.tsx`), vitest + jsdom + `@testing-library/react`. No new npm dependencies.

## Global Constraints

- No new npm dependencies; all imports from existing packages (`eve/client`, `ai`, React).
- Default model: `anthropic/claude-haiku-4.5` (no change; just passes multimodal `UserContent`).
- `buildUserContent` must NOT import any DOM or browser API — pure `Uint8Array` + `fetch` only.
- `AttachmentPreview` is a pure presentational component; no context reads inside it.
- `EveChat.handleSubmit` text-only path must remain byte-for-byte unchanged in behavior.
- Voice `onTranscript` and HITL `handleRespondInput` must NOT be modified.
- Test command: `pnpm run test:int`; type check: `pnpm exec tsc --noEmit`.
- Tests must not make live model or image calls (mock `createDataUrlFilePart` / `fetch` where needed).
- No jest-dom matchers; use plain assertions (`toBeTruthy()`, `toBeNull()`, `querySelector`).
- File size cap: 4 MB per file (`maxFileSize={4 * 1024 * 1024}`); max 5 files (`maxFiles={5}`).
- Accepted MIME types: `"image/jpeg,image/png,image/gif,image/webp,application/pdf"`.

---

### Task 1: Pure helper — `buildUserContent`

**Files:**
- Create: `src/components/eve/fileParts.ts`
- Test: `src/components/eve/fileParts.test.ts`

**Interfaces:**
- Consumes: `FileUIPart` (from `'ai'`), `createDataUrlFilePart` (from `'eve/client'`)
- Produces:
  ```ts
  // src/components/eve/fileParts.ts
  import type { FileUIPart, UserContent } from 'ai'
  export async function buildUserContent(text: string, files: FileUIPart[]): Promise<UserContent>
  ```

- [ ] **Step 1: Write the failing test**

  Full test file at `src/components/eve/fileParts.test.ts`:

  ```ts
  import { describe, expect, it, vi } from 'vitest'
  import type { FileUIPart } from 'ai'

  // ---- Fixtures ----

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) // minimal JPEG magic
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])               // minimal PNG magic

  function makeFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
    return {
      type: 'file',
      mediaType: 'image/jpeg',
      url: 'data:image/jpeg;base64,/9j/4AAQ==',
      filename: 'photo.jpg',
      ...overrides,
    }
  }

  // ---- Mock fetch to return fixture bytes ----

  vi.stubGlobal('fetch', async (url: string) => {
    const isJpeg = url.includes('jpeg') || url.includes('photo')
    const bytes = isJpeg ? jpegBytes : pngBytes
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    } as Response
  })

  // ---- Mock eve/client so test stays unit-level ----

  vi.mock('eve/client', () => ({
    createDataUrlFilePart: vi.fn(({ bytes, filename, mediaType }: { bytes: Uint8Array; filename?: string; mediaType: string }) => ({
      type: 'file' as const,
      data: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
      mediaType,
      filename,
    })),
    createTextWithFileContent: vi.fn(),
  }))

  import { buildUserContent } from './fileParts'

  describe('buildUserContent', () => {
    it('returns [textPart, filePart] for single image + text', async () => {
      const result = await buildUserContent('What do you see?', [makeFile()])
      expect(Array.isArray(result)).toBe(true)
      const arr = result as Array<{ type: string }>
      expect(arr).toHaveLength(2)
      expect(arr[0]).toMatchObject({ type: 'text', text: 'What do you see?' })
      expect(arr[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    })

    it('returns [textPart, ...fileParts] for multiple files', async () => {
      const files = [
        makeFile({ mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,/9j/', filename: 'a.jpg' }),
        makeFile({ mediaType: 'image/png', url: 'data:image/png;base64,iVBO', filename: 'b.png' }),
      ]
      const result = await buildUserContent('hello', files)
      const arr = result as Array<{ type: string }>
      expect(arr).toHaveLength(3)
      expect(arr[0]).toMatchObject({ type: 'text', text: 'hello' })
      expect(arr[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
      expect(arr[2]).toMatchObject({ type: 'file', mediaType: 'image/png' })
    })

    it('returns file parts only when text is empty', async () => {
      const result = await buildUserContent('', [makeFile()])
      const arr = result as Array<{ type: string }>
      expect(arr).toHaveLength(1)
      expect(arr[0]).toMatchObject({ type: 'file' })
    })

    it('returns file parts only when text is whitespace', async () => {
      const result = await buildUserContent('   ', [makeFile()])
      const arr = result as Array<{ type: string }>
      expect(arr).toHaveLength(1)
      expect(arr[0]).toMatchObject({ type: 'file' })
    })

    it('skips a file and warns when fetch throws (graceful reject)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const badFile = makeFile({ url: 'data:image/jpeg;base64,BROKEN', filename: 'bad.jpg' })

      // Override fetch for this test to fail on the bad URL
      const originalFetch = globalThis.fetch
      vi.stubGlobal('fetch', async (url: string) => {
        if ((url as string).includes('BROKEN')) throw new Error('fetch failed')
        return originalFetch(url)
      })

      const result = await buildUserContent('hi', [badFile, makeFile({ url: 'data:image/jpeg;base64,/9j/', filename: 'good.jpg' })])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bad.jpg'), expect.any(Error))
      const arr = result as Array<{ type: string }>
      // bad file skipped; text + 1 good file remain
      expect(arr).toHaveLength(2)
      expect(arr[0]).toMatchObject({ type: 'text' })
      expect(arr[1]).toMatchObject({ type: 'file' })

      warnSpy.mockRestore()
    })

    it('falls back to text-only when all files fail', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.stubGlobal('fetch', async () => { throw new Error('all fail') })
      const result = await buildUserContent('fallback text', [makeFile()])
      const arr = result as Array<{ type: string }>
      expect(arr).toHaveLength(1)
      expect(arr[0]).toMatchObject({ type: 'text', text: 'fallback text' })
      warnSpy.mockRestore()
    })
  })
  ```

- [ ] **Step 2: Run test, expect FAIL (module not found)**

  ```
  pnpm run test:int src/components/eve/fileParts.test.ts
  # Expected: FAIL — cannot find module './fileParts'
  ```

- [ ] **Step 3: Implement `src/components/eve/fileParts.ts`**

  ```ts
  import type { FileUIPart, FilePart, UserContent } from 'ai'
  import { createDataUrlFilePart } from 'eve/client'

  /**
   * Converts an array of FileUIPart (with data: URLs already resolved by PromptInput)
   * and an optional text string into an AI SDK UserContent array.
   *
   * Each file is fetched (data URL → ArrayBuffer → Uint8Array) and converted to a
   * FilePart via createDataUrlFilePart from 'eve/client'. Files that fail to convert
   * are skipped with a console.warn. If all files fail and text is also empty, returns
   * an empty array (caller must guard against sending nothing).
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
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm run test:int src/components/eve/fileParts.test.ts
  # Expected: all 6 tests pass
  ```

- [ ] **Step 5: Type check**

  ```
  pnpm exec tsc --noEmit
  # Expected: 0 errors
  ```

- [ ] **Step 6: Commit**

  ```
  git add src/components/eve/fileParts.ts src/components/eve/fileParts.test.ts
  git commit -m "feat(eve): add buildUserContent helper for multimodal file-to-UserContent conversion"
  ```

---

### Task 2: Pure presentational component — `AttachmentPreview`

**Files:**
- Create: `src/components/eve/AttachmentPreview.tsx`
- Test: `src/components/eve/AttachmentPreview.test.tsx`

**Interfaces:**
- Consumes: `FileUIPart` from `'ai'`
- Produces:
  ```ts
  // src/components/eve/AttachmentPreview.tsx
  export interface AttachmentPreviewProps {
    file: FileUIPart
    onRemove?: (file: FileUIPart) => void
    className?: string
  }
  export function AttachmentPreview(props: AttachmentPreviewProps): React.ReactElement
  ```

- [ ] **Step 1: Write the failing test**

  Full test file at `src/components/eve/AttachmentPreview.test.tsx`:

  ```tsx
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, render } from '@testing-library/react'
  import type { FileUIPart } from 'ai'
  import { AttachmentPreview } from './AttachmentPreview'

  afterEach(cleanup)

  function imageFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
    return {
      type: 'file',
      mediaType: 'image/jpeg',
      url: 'data:image/jpeg;base64,/9j/4AAQ==',
      filename: 'photo.jpg',
      ...overrides,
    }
  }

  function pdfFile(overrides: Partial<FileUIPart> = {}): FileUIPart {
    return {
      type: 'file',
      mediaType: 'application/pdf',
      url: 'data:application/pdf;base64,JVBERi0=',
      filename: 'report.pdf',
      ...overrides,
    }
  }

  describe('AttachmentPreview', () => {
    it('renders an <img> for image files with correct src and alt', () => {
      const { container } = render(<AttachmentPreview file={imageFile()} />)
      const img = container.querySelector('img')
      expect(img).toBeTruthy()
      expect(img!.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/4AAQ==')
      expect(img!.getAttribute('alt')).toBe('photo.jpg')
    })

    it('renders a chip (no <img>) for PDF files', () => {
      const { container } = render(<AttachmentPreview file={pdfFile()} />)
      expect(container.querySelector('img')).toBeNull()
      expect(container.textContent).toContain('report.pdf')
    })

    it('uses fallback alt text when filename is absent', () => {
      const { container } = render(<AttachmentPreview file={imageFile({ filename: undefined })} />)
      const img = container.querySelector('img')
      expect(img!.getAttribute('alt')).toBe('attachment')
    })

    it('renders an X button when onRemove is provided', () => {
      const { container } = render(
        <AttachmentPreview file={imageFile()} onRemove={() => {}} />,
      )
      const btn = container.querySelector('button[aria-label="Remove attachment"]')
      expect(btn).toBeTruthy()
    })

    it('does NOT render an X button when onRemove is absent', () => {
      const { container } = render(<AttachmentPreview file={imageFile()} />)
      const btn = container.querySelector('button[aria-label="Remove attachment"]')
      expect(btn).toBeNull()
    })

    it('calls onRemove with the file when X button is clicked', () => {
      const onRemove = vi.fn()
      const file = imageFile()
      const { container } = render(<AttachmentPreview file={file} onRemove={onRemove} />)
      const btn = container.querySelector('button[aria-label="Remove attachment"]') as HTMLButtonElement
      btn.click()
      expect(onRemove).toHaveBeenCalledWith(file)
    })

    it('renders a chip with filename for PDF in post-send preview (no onRemove)', () => {
      const { container } = render(<AttachmentPreview file={pdfFile()} />)
      expect(container.textContent).toContain('report.pdf')
      expect(container.querySelector('button')).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run test, expect FAIL (module not found)**

  ```
  pnpm run test:int src/components/eve/AttachmentPreview.test.tsx
  # Expected: FAIL — cannot find module './AttachmentPreview'
  ```

- [ ] **Step 3: Implement `src/components/eve/AttachmentPreview.tsx`**

  ```tsx
  'use client'
  import React from 'react'
  import type { FileUIPart } from 'ai'
  import { FileIcon, XIcon } from 'lucide-react'
  import { cn } from '@/lib/utils'

  export interface AttachmentPreviewProps {
    file: FileUIPart
    onRemove?: (file: FileUIPart) => void
    className?: string
  }

  /**
   * Pure presentational component that renders a single attached file as:
   * - An image thumbnail (for image/* MIME types)
   * - A filename chip with a document icon (for everything else, e.g. application/pdf)
   *
   * When onRemove is provided (pre-send strip), an X button appears.
   * Without onRemove (post-send bubble), the X button is absent.
   */
  export function AttachmentPreview({ file, onRemove, className }: AttachmentPreviewProps): React.ReactElement {
    const isImage = file.mediaType.startsWith('image/')

    return (
      <div className={cn('relative inline-flex items-center', className)}>
        {isImage ? (
          <img
            src={file.url}
            alt={file.filename ?? 'attachment'}
            className="max-h-24 max-w-[120px] rounded object-cover"
          />
        ) : (
          <div className="flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-muted-foreground text-xs">
            <FileIcon className="size-3 shrink-0" aria-hidden="true" />
            <span className="max-w-[100px] truncate">{file.filename ?? 'file'}</span>
          </div>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => onRemove(file)}
            className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:bg-destructive hover:text-destructive-foreground"
          >
            <XIcon className="size-2.5" />
          </button>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 4: Run test, expect PASS**

  ```
  pnpm run test:int src/components/eve/AttachmentPreview.test.tsx
  # Expected: all 7 tests pass
  ```

- [ ] **Step 5: Type check**

  ```
  pnpm exec tsc --noEmit
  # Expected: 0 errors
  ```

- [ ] **Step 6: Commit**

  ```
  git add src/components/eve/AttachmentPreview.tsx src/components/eve/AttachmentPreview.test.tsx
  git commit -m "feat(eve): add AttachmentPreview component for image thumbnails and PDF chips"
  ```

---

### Task 3: Wire EveChat — composer constraints, submit path, file previews in user bubble

**Files:**
- Modify: `src/components/eve/EveChat.tsx`
- Test: `src/components/eve/EveChat.multimodal.test.tsx` (new file; does NOT touch the existing live component test if one exists)

**Interfaces:**
- Consumes: `buildUserContent` from `./fileParts`, `AttachmentPreview` from `./AttachmentPreview`, `usePromptInputAttachments` + `PromptInputHeader` from `@/components/ai-elements/prompt-input`, `FileUIPart` from `'ai'`
- Produces: modified `handleSubmit` in `EveChatInner`; modified `<PromptInput>` JSX; new `pendingFileQueue` ref; new `attachError` state; new pre-send strip and post-send preview rendering

The changes are all inside `EveChatInner` and its returned JSX. The `EveChat` outer shell (replay loader) is unchanged.

Key ref: `EveChat.tsx` lines 315–349 (current `handleSubmit`), lines 453–488 (current `<PromptInput>` JSX), lines 396–433 (message render loop). Verified from the file read above.

- [ ] **Step 1: Write the failing unit test**

  This test isolates the logic units of the new `handleSubmit` path using a minimal fake agent, without mounting the full component (which requires heavy mocking of `useEveAgent`, router, etc.). It tests the pure behaviors: queue population, text-only guard, file-only guard.

  Full test file at `src/components/eve/EveChat.multimodal.test.tsx`:

  ```tsx
  import { describe, expect, it, vi, beforeEach } from 'vitest'

  // Mock eve/client so buildUserContent stays unit-level
  vi.mock('eve/client', () => ({
    createDataUrlFilePart: vi.fn(({ bytes, mediaType, filename }: { bytes: Uint8Array; mediaType: string; filename?: string }) => ({
      type: 'file' as const,
      data: `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
      mediaType,
      filename,
    })),
    createTextWithFileContent: vi.fn(),
  }))

  // Stub fetch for data URL reads
  vi.stubGlobal('fetch', async (_url: string) => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as Response))

  import { buildUserContent } from './fileParts'
  import type { FileUIPart } from 'ai'

  function makeFileUIPart(overrides: Partial<FileUIPart> = {}): FileUIPart {
    return {
      type: 'file',
      mediaType: 'image/jpeg',
      url: 'data:image/jpeg;base64,/9j/4AAQ==',
      filename: 'test.jpg',
      ...overrides,
    }
  }

  // Simulate the handleSubmit logic we are adding to EveChat,
  // extracted as a pure function for testability.
  type SubmitMessage = { text: string; files: FileUIPart[] }
  type SendArg = { message: string | Awaited<ReturnType<typeof buildUserContent>> }

  async function simulateHandleSubmit(
    message: SubmitMessage,
    opts: {
      sendingRef: { current: boolean }
      pendingFileQueue: { current: FileUIPart[][] }
      agentSend: (arg: SendArg) => Promise<void>
    },
  ): Promise<void> {
    const text = message.text?.trim()
    const hasFiles = message.files.length > 0
    if (!text && !hasFiles) return
    if (opts.sendingRef.current) return
    opts.sendingRef.current = true
    try {
      const userContent = hasFiles
        ? await buildUserContent(text ?? '', message.files)
        : (text as string)
      if (hasFiles) opts.pendingFileQueue.current.push(message.files)
      await opts.agentSend({ message: userContent })
    } finally {
      opts.sendingRef.current = false
    }
  }

  describe('EveChat handleSubmit multimodal logic', () => {
    let sendingRef: { current: boolean }
    let pendingFileQueue: { current: FileUIPart[][] }
    let agentSend: ReturnType<typeof vi.fn>

    beforeEach(() => {
      sendingRef = { current: false }
      pendingFileQueue = { current: [] }
      agentSend = vi.fn().mockResolvedValue(undefined)
    })

    it('sends text-only when no files attached (existing path)', async () => {
      await simulateHandleSubmit(
        { text: 'hello', files: [] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(agentSend).toHaveBeenCalledWith({ message: 'hello' })
      expect(pendingFileQueue.current).toHaveLength(0)
    })

    it('blocks submit when text is empty and no files', async () => {
      await simulateHandleSubmit(
        { text: '', files: [] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(agentSend).not.toHaveBeenCalled()
    })

    it('blocks submit when text is whitespace-only and no files', async () => {
      await simulateHandleSubmit(
        { text: '   ', files: [] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(agentSend).not.toHaveBeenCalled()
    })

    it('allows file-only submit (no text)', async () => {
      const file = makeFileUIPart()
      await simulateHandleSubmit(
        { text: '', files: [file] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(agentSend).toHaveBeenCalledOnce()
      const arg = agentSend.mock.calls[0][0] as SendArg
      expect(Array.isArray(arg.message)).toBe(true)
    })

    it('populates pendingFileQueue on file submit', async () => {
      const file = makeFileUIPart()
      await simulateHandleSubmit(
        { text: 'see this', files: [file] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(pendingFileQueue.current).toHaveLength(1)
      expect(pendingFileQueue.current[0]).toEqual([file])
    })

    it('does NOT populate pendingFileQueue for text-only submit', async () => {
      await simulateHandleSubmit(
        { text: 'text only', files: [] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(pendingFileQueue.current).toHaveLength(0)
    })

    it('ignores re-entrant submits while one is in flight', async () => {
      sendingRef.current = true
      await simulateHandleSubmit(
        { text: 'hello', files: [] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      expect(agentSend).not.toHaveBeenCalled()
    })

    it('sends array UserContent for text + file', async () => {
      const file = makeFileUIPart()
      await simulateHandleSubmit(
        { text: 'what is this?', files: [file] },
        { sendingRef, pendingFileQueue, agentSend },
      )
      const arg = agentSend.mock.calls[0][0] as SendArg
      const parts = arg.message as Array<{ type: string }>
      expect(parts[0]).toMatchObject({ type: 'text', text: 'what is this?' })
      expect(parts[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    })
  })
  ```

- [ ] **Step 2: Run test, expect tests PASS (they test logic from `fileParts.ts`, not EveChat directly yet)**

  ```
  pnpm run test:int src/components/eve/EveChat.multimodal.test.tsx
  # Expected: all 8 tests PASS (they only import from fileParts.ts which already exists)
  ```

- [ ] **Step 3: Modify `src/components/eve/EveChat.tsx`**

  Apply the following changes to `EveChat.tsx`. All changes are inside `EveChatInner`. The outer `EveChat` shell is unchanged.

  **3a. Add imports** (after the existing imports block, before the `// ── Voice constants` comment):

  Replace the existing imports block at the top of `EveChat.tsx`. The new block adds `useRef` is already imported; add `FileUIPart` from `'ai'`, `buildUserContent` from `./fileParts`, `AttachmentPreview` from `./AttachmentPreview`, and `PromptInputHeader`, `usePromptInputAttachments`, `PromptInputActionMenuTrigger`, `PromptInputActionMenu`, `PromptInputActionMenuContent`, `PromptInputActionAddAttachments` from `@/components/ai-elements/prompt-input`.

  Specifically, add to the existing `prompt-input` import line:

  ```ts
  // Before (line 14-21 in EveChat.tsx):
  import {
    PromptInput,
    PromptInputFooter,
    type PromptInputMessage,
    PromptInputSubmit,
    PromptInputTextarea,
    PromptInputTools,
  } from '@/components/ai-elements/prompt-input'
  ```

  ```ts
  // After:
  import {
    PromptInput,
    PromptInputFooter,
    PromptInputHeader,
    type PromptInputMessage,
    PromptInputSubmit,
    PromptInputTextarea,
    PromptInputTools,
    usePromptInputAttachments,
    PromptInputActionMenu,
    PromptInputActionMenuTrigger,
    PromptInputActionMenuContent,
    PromptInputActionAddAttachments,
  } from '@/components/ai-elements/prompt-input'
  import type { FileUIPart } from 'ai'
  import { buildUserContent } from './fileParts'
  import { AttachmentPreview } from './AttachmentPreview'
  import { PaperclipIcon } from 'lucide-react'
  ```

  **3b. Add new state / refs inside `EveChatInner`** (after `sendingRef` declaration at line 235, before `latestSessionIdRef`):

  ```ts
  // After: const sendingRef = useRef(false)
  // Add:
  const pendingFileQueue = useRef<FileUIPart[][]>([])
  // Attachment error for inline notice below the composer.
  const [attachError, setAttachError] = useState<string | null>(null)
  ```

  **3c. Replace `handleSubmit`** (lines 315–349 in `EveChat.tsx`):

  ```ts
  // Before:
  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text) return
    if (sendingRef.current) return // ignore re-entrant submits while a send is in flight
    sendingRef.current = true
    setInput('')
    setStalled(false)

    const isNew = !activeId && !agent.session.sessionId
    // Capture the first user message as the title for a new thread.
    if (isNew && !titleRef.current) {
      titleRef.current = text.slice(0, 80)
    }

    try {
      await agent.send({ message: text })
    } finally {
      sendingRef.current = false
    }

    // After send resolves for a brand-new chat, push the new sessionId into the URL
    // so follow-ups persist to the same thread. Read the ref (set by onSessionChange),
    // not agent.session.sessionId, which is stale in this async closure.
    if (isNew) {
      const sid = latestSessionIdRef.current
      if (sid) {
        setSidebarConversations((prev) =>
          prev.some((c) => c.id === sid)
            ? prev
            : [{ id: sid, title: titleRef.current ?? text.slice(0, 80) }, ...prev],
        )
        router.push(`?conversation=${sid}`)
      }
    }
  }
  ```

  ```ts
  // After:
  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim()
    const hasFiles = message.files.length > 0
    if (!text && !hasFiles) return
    if (sendingRef.current) return // ignore re-entrant submits while a send is in flight
    sendingRef.current = true
    setInput('')
    setAttachError(null)
    setStalled(false)

    const isNew = !activeId && !agent.session.sessionId
    // Capture the first user message as the title for a new thread (prefer text; fallback for file-only).
    if (isNew && !titleRef.current) {
      titleRef.current = (text ?? '[attachment]').slice(0, 80)
    }

    try {
      let userContent: string | Awaited<ReturnType<typeof buildUserContent>>
      if (hasFiles) {
        userContent = await buildUserContent(text ?? '', message.files)
        // Guard: if all files failed to fetch AND text was empty, buildUserContent returns
        // [{type:'text',text:''}] — an effectively empty turn that wastes gateway credits.
        // Check for an array whose only element is an empty text part and bail out.
        if (
          Array.isArray(userContent) &&
          userContent.length === 1 &&
          userContent[0].type === 'text' &&
          !(userContent[0] as { type: 'text'; text: string }).text
        ) {
          sendingRef.current = false
          return
        }
        pendingFileQueue.current.push(message.files)
      } else {
        userContent = text as string
      }
      await agent.send({ message: userContent })
    } finally {
      sendingRef.current = false
    }

    // After send resolves for a brand-new chat, push the new sessionId into the URL
    // so follow-ups persist to the same thread. Read the ref (set by onSessionChange),
    // not agent.session.sessionId, which is stale in this async closure.
    if (isNew) {
      const sid = latestSessionIdRef.current
      if (sid) {
        setSidebarConversations((prev) =>
          prev.some((c) => c.id === sid)
            ? prev
            : [{ id: sid, title: titleRef.current ?? (text ?? '[attachment]').slice(0, 80) }, ...prev],
        )
        router.push(`?conversation=${sid}`)
      }
    }
  }
  ```

  **3d. Render per-message attachment previews** — add a local `userMsgIndex` counter in the message render loop (inside the `agent.data.messages.map` callback), just before the `return`:

  The message render loop at line 396–433 currently calls `agent.data.messages.map((m, index) => { ... })`. We need to count user messages as they are rendered. Add a mutable counter variable declared just before the `.map()` call:

  ```tsx
  // Before the .map() call at line 396, add:
  let userMsgIndex = 0
  ```

  Then inside the map callback, after `<MessageContent>` opens and AFTER the existing `m.parts.map(...)` call renders, add the file preview block for user messages:

  ```tsx
  // In the message render loop, after m.parts.map(...) and before </MessageContent>:
  {m.role === 'user' && (() => {
    const idx = userMsgIndex++
    const files = pendingFileQueue.current[idx]
    if (!files?.length) return null
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {files.map((f, fi) => (
          <AttachmentPreview key={fi} file={f} />
        ))}
      </div>
    )
  })()}
  ```

  **3e. Update the `<PromptInput>` JSX** (lines 453–488). Add `accept`, `maxFileSize`, `maxFiles`, `onError` props, a pre-send attachment strip (`PromptInputHeader`), and the attach action menu trigger in `PromptInputTools`:

  ```tsx
  // Before (line 453):
  <PromptInput onSubmit={handleSubmit} className="mt-3">
    <PromptInputTextarea
      value={input}
      placeholder="Message Eve…"
      onChange={(e) => setInput(e.currentTarget.value)}
    />
    <PromptInputFooter>
      {voiceAvailable && (
        <PromptInputTools>
          <VoiceButton voice={voice} />
          ...
        </PromptInputTools>
      )}
      <PromptInputSubmit
        status={agent.status}
        onStop={agent.stop}
        disabled={
          agent.status !== 'streaming' && agent.status !== 'submitted' && !input.trim()
        }
      />
    </PromptInputFooter>
  </PromptInput>
  ```

  ```tsx
  // After:
  <PromptInput
    onSubmit={handleSubmit}
    accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
    maxFileSize={4 * 1024 * 1024}
    maxFiles={5}
    onError={(err) => setAttachError(err.message)}
    className="mt-3"
  >
    <PreSendAttachmentStrip />
    <PromptInputTextarea
      value={input}
      placeholder="Message Eve…"
      onChange={(e) => setInput(e.currentTarget.value)}
    />
    <PromptInputFooter>
      <PromptInputTools>
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger
            tooltip="Attach file"
            aria-label="Attach file"
          >
            <PaperclipIcon className="size-4" />
          </PromptInputActionMenuTrigger>
          <PromptInputActionMenuContent>
            <PromptInputActionAddAttachments />
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>
        {voiceAvailable && (
          <>
            <VoiceButton voice={voice} />
            {voice.state === 'speaking' ? (
              <button
                type="button"
                onClick={() => voice.stopSpeaking()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground text-xs hover:bg-accent hover:text-accent-foreground"
                aria-label="Stop speaking"
              >
                <SquareIcon className="size-3 fill-current" />
                Speaking… tap to stop
              </button>
            ) : voice.listening ? (
              <span className="text-muted-foreground text-xs" role="status">
                {voice.state === 'thinking' ? 'Thinking…' : 'Listening…'}
              </span>
            ) : null}
          </>
        )}
      </PromptInputTools>
      <PromptInputSubmit
        status={agent.status}
        onStop={agent.stop}
        disabled={
          agent.status !== 'streaming' &&
          agent.status !== 'submitted' &&
          !input.trim() &&
          attachmentCount === 0
        }
      />
    </PromptInputFooter>
  </PromptInput>
  {attachError && (
    <p className="mt-1 text-destructive text-xs" role="alert">
      {attachError}
    </p>
  )}
  ```

  Note: `attachmentCount` is a `useState` value declared in Step 3f below; `attachmentCount === 0` is the correct guard. `<PreSendAttachmentStrip>` reads the PromptInput context (must be rendered inside `<PromptInput>`) and calls `onCountChange` to bubble the count up, so the submit button can become enabled for file-only messages.

  **3f. Add `PreSendAttachmentStrip` as a named inner component and wire `attachmentCount` state.**

  Add `const [attachmentCount, setAttachmentCount] = useState(0)` to the `EveChatInner` state declarations (alongside `attachError` from Step 3b). Then implement the strip component (module-level or above the return inside `EveChatInner`) and pass `onCountChange={setAttachmentCount}` to `<PreSendAttachmentStrip />` in the JSX:

  ```tsx
  /**
   * Reads the PromptInput attachment context (must be rendered inside <PromptInput>)
   * to display the pre-send strip and report attachment count up to EveChat.
   */
  function PreSendAttachmentStrip({
    onCountChange,
  }: {
    onCountChange: (count: number) => void
  }): React.ReactElement | null {
    const attachments = usePromptInputAttachments()
    const count = attachments.files.length

    // Report count to parent so PromptInputSubmit disabled prop can reflect it.
    React.useEffect(() => {
      onCountChange(count)
    }, [count, onCountChange])

    if (count === 0) return null

    return (
      <PromptInputHeader className="p-1">
        <div className="flex flex-wrap gap-1">
          {attachments.files.map((f) => (
            <AttachmentPreview
              key={f.id}
              file={f}
              onRemove={() => attachments.remove(f.id)}
            />
          ))}
        </div>
      </PromptInputHeader>
    )
  }
  ```

  Add `const [attachmentCount, setAttachmentCount] = useState(0)` to the `EveChatInner` state block (Step 3b). Then pass `onCountChange={setAttachmentCount}` to `<PreSendAttachmentStrip />` in the JSX from Step 3e. The `disabled` expression using `attachmentCount === 0` is already shown in Step 3e above — no changes needed to it here.

- [ ] **Step 4: Run existing tests to confirm no regressions**

  ```
  pnpm run test:int
  # Expected: all pre-existing tests still pass; 8 new EveChat.multimodal tests pass
  ```

- [ ] **Step 5: Type check**

  ```
  pnpm exec tsc --noEmit
  # Expected: 0 errors
  ```

- [ ] **Step 6: Eve agent graph compile check**

  ```
  node_modules/.bin/eve info
  # Expected: 0 diagnostics (agent/ is unchanged; this verifies no import side-effects)
  ```

- [ ] **Step 7: Commit**

  ```
  git add src/components/eve/EveChat.tsx
  git commit -m "feat(eve): wire multimodal file input — composer constraints, buildUserContent, attachment previews in user bubble"
  ```

---

### Task 4: Integration smoke test (manual, not CI)

**Files:** none changed — manual verification only.

**Purpose:** Confirm the full round-trip works with the live Eve agent and real model calls before shipping. This step MUST NOT be automated (it costs gateway credits).

- [ ] **Step 1: Start the dev server**

  ```
  pnpm devsafe
  # Wait for "ready" output from Next and Eve child process
  ```

- [ ] **Step 2: Verify the paperclip attach button appears in the composer**

  Open `http://localhost:3000/admin/eve` (or equivalent). Confirm the PaperclipIcon button appears in `PromptInputTools`.

- [ ] **Step 3: Attach a JPEG image and send "What do you see?"**

  Click the paperclip, select a JPEG. Confirm:
  - A thumbnail appears in the pre-send strip above the textarea.
  - After sending, the thumbnail appears in the user message bubble (below the text).
  - The model responds with a description of the image.

- [ ] **Step 4: Verify the error notice for oversized files**

  Attempt to attach a file > 4 MB. Confirm an inline `<p role="alert">` with the error message appears below the composer.

- [ ] **Step 5: Verify text-only path is unchanged**

  Send a plain text message. Confirm it works exactly as before, no regressions.

- [ ] **Step 6: (Optional) Attach a PDF and ask a question about it**

  Attach a small PDF. Confirm the chip renders. Confirm the model responds (note: PDF support on Haiku 4.5 may vary — see Open Questions in the spec).

- [ ] **Step 7: Final type check + test suite**

  ```
  pnpm exec tsc --noEmit && pnpm run test:int
  # Expected: 0 type errors, all tests pass
  ```

- [ ] **Step 8: Commit**

  ```
  git add -p   # stage only if any last-minute fixes were made during smoke test
  git commit -m "chore(eve): multimodal file input — verified smoke test, ready to ship"
  # (skip if no code changed during smoke test)
  ```
