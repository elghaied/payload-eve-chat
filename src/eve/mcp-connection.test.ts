import { describe, it, expect } from 'vitest'
// The connection lives under agent/ (Eve discovers agent/connections/* as connections),
// so its test must NOT sit in that directory — Eve would try to load the .test file as a
// connection and fail discovery. Test the exported helper from here instead.
import { mcpAuthHeaderToken } from '../../agent/connections/payload-mcp'

describe('mcpAuthHeaderToken', () => {
  it('returns the trimmed key when set', () => {
    expect(mcpAuthHeaderToken('  abc ')).toBe('abc')
  })
  it('returns undefined when unset or blank', () => {
    expect(mcpAuthHeaderToken(undefined)).toBeUndefined()
    expect(mcpAuthHeaderToken('   ')).toBeUndefined()
  })
})
