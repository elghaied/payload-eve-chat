import { defineMcpClientConnection } from 'eve/connections'

/** Returns the trimmed MCP bearer token, or undefined when unset/blank. */
export function mcpAuthHeaderToken(raw: string | undefined): string | undefined {
  const t = raw?.trim()
  return t ? t : undefined
}

/**
 * The Payload MCP endpoint the Eve runtime should call. Local dev: localhost:3000. On Vercel the
 * Eve runtime is a SEPARATE service, so `localhost` is unreachable — `connection__search` then
 * fails and Eve reports the connection as unavailable (breaking every Payload MCP tool, Unsplash
 * included). Fall back to the deployment's own public URL (VERCEL_PROJECT_PRODUCTION_URL →
 * VERCEL_URL). Override with MCP_SERVER_URL for a custom hostname.
 */
export function resolveMcpServerUrl(): string {
  if (process.env.MCP_SERVER_URL) return process.env.MCP_SERVER_URL
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost}/api/mcp`
  return 'http://localhost:3000/api/mcp'
}

const url = resolveMcpServerUrl()
const token = mcpAuthHeaderToken(process.env.MCP_API_KEY)

export default defineMcpClientConnection({
  url,
  description: 'Payload CMS: Posts and Tasks (find, create, update) over MCP.',
  // Dev: Payload MCP accepts no auth (overrideAuth). Prod: Bearer MCP_API_KEY.
  ...(token ? { auth: { getToken: async () => ({ token }) } } : {}),
})
