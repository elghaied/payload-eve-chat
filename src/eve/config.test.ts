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
