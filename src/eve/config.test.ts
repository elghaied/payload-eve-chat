import { describe, expect, it } from 'vitest'
import { getEveConfig } from './config'

describe('getEveConfig', () => {
  it('defaults to anthropic with default model and requires its key', () => {
    const cfg = getEveConfig({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(cfg.provider).toBe('anthropic')
    expect(cfg.anthropicModel).toBe('claude-sonnet-4-6')
    expect(cfg.mcpServerUrl).toBe('http://localhost:3000/api/mcp')
  })

  it('throws a readable error when the anthropic key is missing', () => {
    expect(() => getEveConfig({})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('selects openai and validates its key', () => {
    const cfg = getEveConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-o' })
    expect(cfg.provider).toBe('openai')
    expect(cfg.openaiModel).toBe('gpt-4o')
    expect(() => getEveConfig({ AI_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/)
  })

  it('selects ollama without requiring an API key, with default model and base URL', () => {
    const cfg = getEveConfig({ AI_PROVIDER: 'ollama' })
    expect(cfg.provider).toBe('ollama')
    expect(cfg.ollamaModel).toBe('qwen2.5')
    expect(cfg.ollamaBaseURL).toBe('http://localhost:11434/api')
  })

  it('honors ollama model and base URL overrides', () => {
    const cfg = getEveConfig({
      AI_PROVIDER: 'ollama',
      OLLAMA_MODEL: 'llama3.1',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434/api',
    })
    expect(cfg.ollamaModel).toBe('llama3.1')
    expect(cfg.ollamaBaseURL).toBe('http://127.0.0.1:11434/api')
  })

  it('honors model and mcp overrides', () => {
    const cfg = getEveConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-opus-4-8',
      MCP_SERVER_URL: 'http://localhost:4000/api/mcp',
      MCP_API_KEY: 'mcp-key',
    })
    expect(cfg.anthropicModel).toBe('claude-opus-4-8')
    expect(cfg.mcpServerUrl).toBe('http://localhost:4000/api/mcp')
    expect(cfg.mcpApiKey).toBe('mcp-key')
  })

  it('leaves audio services unattached by default, with model/voice/format defaults', () => {
    const cfg = getEveConfig({ ANTHROPIC_API_KEY: 'k' })
    expect(cfg.sttBaseURL).toBeUndefined()
    expect(cfg.ttsBaseURL).toBeUndefined()
    expect(cfg.sttModel).toBe('Systran/faster-whisper-small')
    expect(cfg.ttsModel).toBe('kokoro')
    expect(cfg.ttsVoice).toBe('af_sky')
    expect(cfg.ttsFormat).toBe('mp3')
    expect(cfg.sttApiKey).toBeUndefined()
    expect(cfg.ttsApiKey).toBeUndefined()
  })

  it('attaches services via base URLs and honors overrides + keys', () => {
    const cfg = getEveConfig({
      ANTHROPIC_API_KEY: 'k',
      STT_BASE_URL: 'https://api.openai.com/v1',
      STT_MODEL: 'whisper-1',
      STT_API_KEY: 'sk-stt',
      TTS_BASE_URL: 'https://api.openai.com/v1',
      TTS_MODEL: 'gpt-4o-mini-tts',
      TTS_VOICE: 'alloy',
      TTS_FORMAT: 'wav',
      TTS_API_KEY: 'sk-tts',
    })
    expect(cfg.sttBaseURL).toBe('https://api.openai.com/v1')
    expect(cfg.sttModel).toBe('whisper-1')
    expect(cfg.sttApiKey).toBe('sk-stt')
    expect(cfg.ttsBaseURL).toBe('https://api.openai.com/v1')
    expect(cfg.ttsModel).toBe('gpt-4o-mini-tts')
    expect(cfg.ttsVoice).toBe('alloy')
    expect(cfg.ttsFormat).toBe('wav')
    expect(cfg.ttsApiKey).toBe('sk-tts')
  })

  it('attaches STT only (TTS stays unattached)', () => {
    const cfg = getEveConfig({ ANTHROPIC_API_KEY: 'k', STT_BASE_URL: 'http://localhost:8000/v1' })
    expect(cfg.sttBaseURL).toBe('http://localhost:8000/v1')
    expect(cfg.ttsBaseURL).toBeUndefined()
  })

  it('leaves searxngUrl undefined by default and reads it from env', () => {
    expect(getEveConfig({ ANTHROPIC_API_KEY: 'k' }).searxngUrl).toBeUndefined()
    expect(getEveConfig({ ANTHROPIC_API_KEY: 'k', SEARXNG_URL: 'http://localhost:8080' }).searxngUrl).toBe(
      'http://localhost:8080',
    )
  })
})
