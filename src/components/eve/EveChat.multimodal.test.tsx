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

// ── Pure helper extracted from EveChat for testability ─────────────────────────
//
// This mirrors the Map-based logic in EveChat:
//   - pendingFileMap: Map<number, FileUIPart[]> keyed by confirmed-user-message index
//   - At submit time: key = number of confirmed (non-optimistic) user messages before send
//   - At render time: iterate confirmed user messages with a counter; map.get(counter)
//
// The helper below simulates:
//   1. A sequence of sends (some with files, some without)
//   2. A sequence of "confirmed" user messages arriving (ignoring optimistic ones)
//   3. Returns which files (if any) would render under each confirmed message

interface FakeMessage {
  role: 'user' | 'assistant'
  metadata?: { optimistic?: true }
}

function simulateMapLookup(
  // sequence of {hasFiles, files} representing each submit
  submits: Array<{ hasFiles: boolean; files?: FileUIPart[] }>,
  // confirmed (non-optimistic) user message count that arrives for each submit
  // (in practice always 1 per submit, but the helper is general)
  confirmedPerSubmit: number[],
): Array<FileUIPart[] | undefined> {
  // --- At submit time ---
  const pendingFileMap = new Map<number, FileUIPart[]>()
  // Start with 0 confirmed user messages
  let confirmedCount = 0
  const submitConfirmedAtKey: number[] = []

  for (let i = 0; i < submits.length; i++) {
    const s = submits[i]!
    if (s.hasFiles && s.files) {
      // Key = confirmedCount BEFORE this submit's message lands
      pendingFileMap.set(confirmedCount, s.files)
    }
    submitConfirmedAtKey.push(confirmedCount)
    // Simulate confirmed messages landing for this submit
    confirmedCount += confirmedPerSubmit[i] ?? 1
  }

  // --- At render time ---
  // Build a fake message list: one confirmed user message per submit
  const messages: FakeMessage[] = []
  for (let i = 0; i < submits.length; i++) {
    for (let j = 0; j < (confirmedPerSubmit[i] ?? 1); j++) {
      messages.push({ role: 'user', metadata: undefined /* confirmed */ })
    }
  }

  // Simulate the render loop from EveChat
  let renderConfirmedIdx = 0
  const results: Array<FileUIPart[] | undefined> = []
  for (const m of messages) {
    if (m.role === 'user' && !m.metadata?.optimistic) {
      const idx = renderConfirmedIdx++
      results.push(pendingFileMap.get(idx))
    }
  }
  return results
}

// Simulate the handleSubmit logic (unchanged from previous test, but updated to use Map)
type SubmitMessage = { text: string; files: FileUIPart[] }
type SendArg = { message: string | Awaited<ReturnType<typeof buildUserContent>> }

async function simulateHandleSubmit(
  message: SubmitMessage,
  opts: {
    sendingRef: { current: boolean }
    pendingFileMap: { current: Map<number, FileUIPart[]> }
    confirmedUserCount: number
    agentSend: (arg: SendArg) => Promise<void>
  },
): Promise<void> {
  const text = message.text?.trim()
  const hasFiles = message.files.length > 0
  if (!text && !hasFiles) return
  if (opts.sendingRef.current) return
  opts.sendingRef.current = true
  try {
    let userContent: string | Awaited<ReturnType<typeof buildUserContent>>
    if (hasFiles) {
      userContent = await buildUserContent(text ?? '', message.files)
      if (
        Array.isArray(userContent) &&
        userContent.length === 1 &&
        userContent[0].type === 'text' &&
        !(userContent[0] as { type: 'text'; text: string }).text
      ) {
        opts.sendingRef.current = false
        return
      }
      // Use the confirmed-user-message count as the Map key
      opts.pendingFileMap.current.set(opts.confirmedUserCount, message.files)
    } else {
      userContent = text as string
    }
    await opts.agentSend({ message: userContent })
  } finally {
    opts.sendingRef.current = false
  }
}

describe('EveChat handleSubmit multimodal logic', () => {
  let sendingRef: { current: boolean }
  let pendingFileMap: { current: Map<number, FileUIPart[]> }
  let agentSend: ReturnType<typeof vi.fn> & ((arg: SendArg) => Promise<void>)

  beforeEach(() => {
    sendingRef = { current: false }
    pendingFileMap = { current: new Map() }
    agentSend = vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn> & ((arg: SendArg) => Promise<void>)
  })

  it('sends text-only when no files attached (existing path)', async () => {
    await simulateHandleSubmit(
      { text: 'hello', files: [] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(agentSend).toHaveBeenCalledWith({ message: 'hello' })
    expect(pendingFileMap.current.size).toBe(0)
  })

  it('blocks submit when text is empty and no files', async () => {
    await simulateHandleSubmit(
      { text: '', files: [] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(agentSend).not.toHaveBeenCalled()
  })

  it('blocks submit when text is whitespace-only and no files', async () => {
    await simulateHandleSubmit(
      { text: '   ', files: [] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(agentSend).not.toHaveBeenCalled()
  })

  it('allows file-only submit (no text)', async () => {
    const file = makeFileUIPart()
    await simulateHandleSubmit(
      { text: '', files: [file] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(agentSend).toHaveBeenCalledOnce()
    const arg = agentSend.mock.calls[0][0] as SendArg
    expect(Array.isArray(arg.message)).toBe(true)
  })

  it('populates pendingFileMap on file submit', async () => {
    const file = makeFileUIPart()
    await simulateHandleSubmit(
      { text: 'see this', files: [file] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(pendingFileMap.current.size).toBe(1)
    expect(pendingFileMap.current.get(0)).toEqual([file])
  })

  it('does NOT populate pendingFileMap for text-only submit', async () => {
    await simulateHandleSubmit(
      { text: 'text only', files: [] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(pendingFileMap.current.size).toBe(0)
  })

  it('ignores re-entrant submits while one is in flight', async () => {
    sendingRef.current = true
    await simulateHandleSubmit(
      { text: 'hello', files: [] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    expect(agentSend).not.toHaveBeenCalled()
  })

  it('sends array UserContent for text + file', async () => {
    const file = makeFileUIPart()
    await simulateHandleSubmit(
      { text: 'what is this?', files: [file] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )
    const arg = agentSend.mock.calls[0][0] as SendArg
    const parts = arg.message as Array<{ type: string }>
    expect(parts[0]).toMatchObject({ type: 'text', text: 'what is this?' })
    expect(parts[1]).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
  })

  it('does NOT call agentSend when buildUserContent returns only an empty text part (empty-turn guard)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network error') })

    const file = makeFileUIPart()
    await simulateHandleSubmit(
      { text: '', files: [file] },
      { sendingRef, pendingFileMap, confirmedUserCount: 0, agentSend },
    )

    expect(agentSend).not.toHaveBeenCalled()
    expect(pendingFileMap.current.size).toBe(0)

    vi.stubGlobal('fetch', async (_url: string) => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response))
  })
})

// ── C2 regression: Map-based desync fix ───────────────────────────────────────

describe('C2: pendingFileMap desync fix — text-only then file message', () => {
  it('image preview renders under the FILE message and NOT under the text-only message', () => {
    // Scenario:
    //   Submit 1: text-only "hello"      → no files → map NOT populated
    //   Submit 2: file message with img  → files → map populated at key=1
    //   (key=1 because there is 1 confirmed user message before submit 2)
    const imgFile = makeFileUIPart({ filename: 'img.jpg' })
    const results = simulateMapLookup(
      [
        { hasFiles: false },
        { hasFiles: true, files: [imgFile] },
      ],
      [1, 1],
    )
    // Message 0 (text-only): no preview
    expect(results[0]).toBeUndefined()
    // Message 1 (file): has preview
    expect(results[1]).toEqual([imgFile])
  })

  it('image preview is correct after two consecutive file messages', () => {
    const file1 = makeFileUIPart({ filename: 'a.jpg' })
    const file2 = makeFileUIPart({ filename: 'b.png' })
    const results = simulateMapLookup(
      [
        { hasFiles: true, files: [file1] },
        { hasFiles: true, files: [file2] },
      ],
      [1, 1],
    )
    expect(results[0]).toEqual([file1])
    expect(results[1]).toEqual([file2])
  })

  it('text-only turn between two file turns does not shift previews', () => {
    const file1 = makeFileUIPart({ filename: 'a.jpg' })
    const file2 = makeFileUIPart({ filename: 'c.png' })
    const results = simulateMapLookup(
      [
        { hasFiles: true, files: [file1] },
        { hasFiles: false },                  // text-only in between
        { hasFiles: true, files: [file2] },
      ],
      [1, 1, 1],
    )
    expect(results[0]).toEqual([file1])  // first file message
    expect(results[1]).toBeUndefined()   // text-only: no preview
    expect(results[2]).toEqual([file2])  // third message (second file): correct
  })

  it('all text-only turns produce no previews', () => {
    const results = simulateMapLookup(
      [
        { hasFiles: false },
        { hasFiles: false },
        { hasFiles: false },
      ],
      [1, 1, 1],
    )
    expect(results.every((r) => r === undefined)).toBe(true)
  })
})
