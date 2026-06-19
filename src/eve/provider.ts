import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider-v2'
import type { LanguageModel } from 'ai'
import type { EveConfig } from './config'

/** Builds the Vercel AI SDK language model for the configured provider. */
export function resolveModel(config: EveConfig): LanguageModel {
  if (config.provider === 'openai') {
    const openai = createOpenAI({ apiKey: config.openaiApiKey })
    return openai(config.openaiModel)
  }
  if (config.provider === 'ollama') {
    // Local models via Ollama — no API key needed. Pick a tool-calling-capable model.
    // Reasoning is separated from the answer via the `think` provider option set
    // on the streamText call (see src/app/api/eve/route.ts).
    const ollama = createOllama({ baseURL: config.ollamaBaseURL })
    return ollama(config.ollamaModel)
  }
  const anthropic = createAnthropic({ apiKey: config.anthropicApiKey })
  return anthropic(config.anthropicModel)
}
