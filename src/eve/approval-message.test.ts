import { describe, expect, it } from 'vitest'
import { buildApprovalMessage } from './approval-message'

describe('buildApprovalMessage', () => {
  it('names the MCP tool and includes title, status, and the exact Markdown', () => {
    const md = '# Heading\n\nA paragraph with *emphasis*.'
    const msg = buildApprovalMessage({ title: 'My Post', status: 'published', markdown: md })
    expect(msg).toContain('createDocumentFromMarkdown')
    expect(msg).toContain('title: My Post')
    expect(msg).toContain('status: published')
    expect(msg).toContain(md) // verbatim body
  })
})
