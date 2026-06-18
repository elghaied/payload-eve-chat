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
})
