import { describe, it, expect } from 'vitest'
import { mcpAuthHeaderToken } from './payload-mcp'

describe('mcpAuthHeaderToken', () => {
  it('returns the trimmed key when set', () => {
    expect(mcpAuthHeaderToken('  abc ')).toBe('abc')
  })
  it('returns undefined when unset or blank', () => {
    expect(mcpAuthHeaderToken(undefined)).toBeUndefined()
    expect(mcpAuthHeaderToken('   ')).toBeUndefined()
  })
})
