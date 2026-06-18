import { createMCPClient } from '@ai-sdk/mcp'
import type { EveConfig } from './config'

/**
 * Connects to the Payload MCP server (exposed by @payloadcms/plugin-mcp) as a
 * client and returns its tools for use with streamText. Always call `close()`
 * when the run finishes to release the connection.
 *
 * In development the MCP endpoint needs no auth; in production it requires a
 * Bearer API key from the `payload-mcp-api-keys` collection (set MCP_API_KEY).
 */
export async function createPayloadMcpTools(
  config: EveConfig,
): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }> {
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: config.mcpServerUrl,
      headers: config.mcpApiKey
        ? { Authorization: `Bearer ${config.mcpApiKey}` }
        : undefined,
    },
  })

  const tools = await client.tools()
  return { tools, close: () => client.close() }
}
