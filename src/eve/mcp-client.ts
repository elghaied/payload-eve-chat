import { createMCPClient } from '@ai-sdk/mcp'
import type { EveConfig } from './config'

type PayloadMcpClient = Awaited<ReturnType<typeof createMCPClient>>
type PayloadMcpTools = Awaited<ReturnType<PayloadMcpClient['tools']>>

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
): Promise<{ tools: PayloadMcpTools; close: () => Promise<void> }> {
  const apiKey = config.mcpApiKey?.trim()
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: config.mcpServerUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    },
  })

  try {
    const tools = await client.tools()
    return { tools, close: () => client.close() }
  } catch (err) {
    // Tear down the just-opened connection before surfacing the failure.
    await client.close()
    throw err
  }
}
