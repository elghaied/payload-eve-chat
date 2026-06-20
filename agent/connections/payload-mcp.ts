import { defineMcpClientConnection } from 'eve/connections'

/** Returns the trimmed MCP bearer token, or undefined when unset/blank. */
export function mcpAuthHeaderToken(raw: string | undefined): string | undefined {
  const t = raw?.trim()
  return t ? t : undefined
}

const url = process.env.MCP_SERVER_URL || 'http://localhost:3000/api/mcp'
const token = mcpAuthHeaderToken(process.env.MCP_API_KEY)

export default defineMcpClientConnection({
  url,
  description: 'Payload CMS: Posts and Tasks (find, create, update) over MCP.',
  // Dev: Payload MCP accepts no auth (overrideAuth). Prod: Bearer MCP_API_KEY.
  ...(token ? { auth: { getToken: async () => ({ token }) } } : {}),
})
