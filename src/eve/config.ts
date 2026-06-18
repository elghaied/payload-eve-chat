export type EveProvider = 'anthropic' | 'openai'

export type EveConfig = {
  provider: EveProvider
  anthropicApiKey?: string
  openaiApiKey?: string
  anthropicModel: string
  openaiModel: string
  mcpServerUrl: string
  mcpApiKey?: string
}

type Env = Record<string, string | undefined>

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const DEFAULT_MCP_SERVER_URL = 'http://localhost:3000/api/mcp'

/**
 * Reads and validates the Eve agent configuration from the environment.
 * Throws a readable error if the active provider's API key is missing.
 */
export function getEveConfig(env: Env = process.env): EveConfig {
  const provider: EveProvider = env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic'

  const config: EveConfig = {
    provider,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
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
