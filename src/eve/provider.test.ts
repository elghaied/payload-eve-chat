import { describe, expect, it } from 'vitest'
import { resolveModel } from './provider'
import type { EveConfig } from './config'

// The Vercel AI SDK LanguageModel union includes LanguageModelV3 which
// exposes `provider` and `modelId` at runtime. We cast to access them.
type ModelInspect = { provider: string; modelId: string }

const base: EveConfig = {
  provider: 'anthropic',
  anthropicApiKey: 'k',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4o',
  ollamaModel: 'qwen2.5',
  ollamaBaseURL: 'http://localhost:11434/api',
  mcpServerUrl: 'http://localhost:3000/api/mcp',
  sttModel: 'm',
  ttsModel: 'm',
  ttsVoice: 'v',
  ttsFormat: 'mp3',
}

describe('resolveModel', () => {
  it('returns an anthropic model with the configured id', () => {
    const model = resolveModel(base) as unknown as ModelInspect
    expect(model.provider).toContain('anthropic')
    expect(model.modelId).toBe('claude-sonnet-4-6')
  })

  it('returns an openai model when provider is openai', () => {
    const model = resolveModel({ ...base, provider: 'openai', openaiApiKey: 'k' }) as unknown as ModelInspect
    expect(model.provider).toContain('openai')
    expect(model.modelId).toBe('gpt-4o')
  })

  it('returns an ollama model when provider is ollama', () => {
    const model = resolveModel({ ...base, provider: 'ollama' }) as unknown as ModelInspect
    expect(model.provider).toContain('ollama')
    expect(model.modelId).toBe('qwen2.5')
  })
})
