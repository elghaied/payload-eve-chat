import { describe, it, expect, afterEach } from 'vitest'
// The connection lives under agent/ (Eve discovers agent/connections/* as connections),
// so its test must NOT sit in that directory — Eve would try to load the .test file as a
// connection and fail discovery. Test the exported helpers from here instead.
import { mcpAuthHeaderToken, resolveMcpServerUrl } from '../../agent/connections/payload-mcp'

describe('mcpAuthHeaderToken', () => {
  it('returns the trimmed key when set', () => {
    expect(mcpAuthHeaderToken('  abc ')).toBe('abc')
  })
  it('returns undefined when unset or blank', () => {
    expect(mcpAuthHeaderToken(undefined)).toBeUndefined()
    expect(mcpAuthHeaderToken('   ')).toBeUndefined()
  })
})

describe('resolveMcpServerUrl', () => {
  const saved = {
    MCP_SERVER_URL: process.env.MCP_SERVER_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  }
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  const clear = () => {
    delete process.env.MCP_SERVER_URL
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
  }

  it('defaults to localhost when nothing is set (local dev)', () => {
    clear()
    expect(resolveMcpServerUrl()).toBe('http://localhost:3000/api/mcp')
  })

  it('uses the Vercel production domain when present', () => {
    clear()
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'my-app.vercel.app'
    expect(resolveMcpServerUrl()).toBe('https://my-app.vercel.app/api/mcp')
  })

  it('falls back to the per-deployment VERCEL_URL (previews)', () => {
    clear()
    process.env.VERCEL_URL = 'my-app-abc123.vercel.app'
    expect(resolveMcpServerUrl()).toBe('https://my-app-abc123.vercel.app/api/mcp')
  })

  it('MCP_SERVER_URL overrides everything', () => {
    clear()
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'my-app.vercel.app'
    process.env.MCP_SERVER_URL = 'https://internal.example.com/api/mcp'
    expect(resolveMcpServerUrl()).toBe('https://internal.example.com/api/mcp')
  })
})
