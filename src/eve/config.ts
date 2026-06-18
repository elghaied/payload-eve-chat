export type EveProvider = 'anthropic' | 'openai' | 'ollama'

export type EveConfig = {
  provider: EveProvider
  anthropicApiKey?: string
  openaiApiKey?: string
  anthropicModel: string
  openaiModel: string
  ollamaModel: string
  ollamaBaseURL: string
  mcpServerUrl: string
  mcpApiKey?: string
}

type Env = Record<string, string | undefined>

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const DEFAULT_OPENAI_MODEL = 'gpt-4o'
// Ollama runs models locally — needs no API key. Use a tool-calling-capable model
// (the agent drives Posts/Tasks through MCP tools), e.g. qwen2.5, llama3.1, mistral-nemo.
const DEFAULT_OLLAMA_MODEL = 'qwen2.5'
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/api'
const DEFAULT_MCP_SERVER_URL = 'http://localhost:3000/api/mcp'

const PROVIDERS: readonly EveProvider[] = ['anthropic', 'openai', 'ollama']

/**
 * Reads and validates the Eve agent configuration from the environment.
 * Throws a readable error if the active provider's API key is missing.
 * (Ollama runs locally and needs no key.)
 */
export function getEveConfig(env: Env = process.env): EveConfig {
  const provider: EveProvider = PROVIDERS.includes(env.AI_PROVIDER as EveProvider)
    ? (env.AI_PROVIDER as EveProvider)
    : 'anthropic'

  const config: EveConfig = {
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    ollamaModel: env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    ollamaBaseURL: env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    mcpServerUrl: env.MCP_SERVER_URL || DEFAULT_MCP_SERVER_URL,
    mcpApiKey: env.MCP_API_KEY,
  }

  if (provider === 'anthropic' && !config.anthropicApiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY (AI_PROVIDER=anthropic).')
  }
  if (provider === 'openai' && !config.openaiApiKey) {
    throw new Error('Missing OPENAI_API_KEY (AI_PROVIDER=openai).')
  }

  return config
}
