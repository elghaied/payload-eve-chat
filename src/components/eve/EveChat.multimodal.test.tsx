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
  let agentSend: ReturnType<typeof vi.fn> & ((arg: SendArg) => Promise<void>)

  beforeEach(() => {
    sendingRef = { current: false }
    pendingFileQueue = { current: [] }
    agentSend = vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn> & ((arg: SendArg) => Promise<void>)
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
