// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  logger: { error: vi.fn() },
  getEveConfig: vi.fn(),
  transcribe: vi.fn(),
}))
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ auth: m.auth, logger: m.logger })) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/eve/config', () => ({ getEveConfig: m.getEveConfig }))
vi.mock('@/eve/audio', () => ({ transcribe: m.transcribe }))

import { POST } from './route'

const multipart = () => {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'a.wav')
  return new Request('http://x/api/eve/transcribe', { method: 'POST', body: fd })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.getEveConfig.mockReturnValue({ sttBaseURL: 'http://stt/v1' })
})

describe('POST /api/eve/transcribe', () => {
  it('401 when unauthenticated', async () => {
    m.auth.mockResolvedValue({ user: null })
    expect((await POST(multipart())).status).toBe(401)
  })

  it('403 for non-users collection', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'payload-mcp-api-keys' } })
    expect((await POST(multipart())).status).toBe(403)
  })

  it('503 when STT is not attached', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'users' } })
    m.getEveConfig.mockReturnValue({ sttBaseURL: undefined })
    expect((await POST(multipart())).status).toBe(503)
  })

  it('returns the transcript on success', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'users' } })
    m.transcribe.mockResolvedValue('hello world')
    const res = await POST(multipart())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'hello world' })
  })

  it('400 when no file is provided', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'users' } })
    const emptyFd = new FormData()
    const req = new Request('http://x/api/eve/transcribe', { method: 'POST', body: emptyFd })
    expect((await POST(req)).status).toBe(400)
  })

  it('503 when the STT service throws', async () => {
    m.auth.mockResolvedValue({ user: { collection: 'users' } })
    m.transcribe.mockRejectedValue(new Error('down'))
    expect((await POST(multipart())).status).toBe(503)
    expect(m.logger.error).toHaveBeenCalled()
  })
})
