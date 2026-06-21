import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Inline the upload placeholder regex — do NOT import from @payloadcms/richtext-lexical dist
// (that path is not in the package exports map and throws ERR_PACKAGE_PATH_NOT_EXPORTED).
const UPLOAD_PLACEHOLDER_REGEX = /!\[([^\]:]+):([^\]]+)\]\(\)/

const SKILL_PATH = resolve(process.cwd(), 'agent/skills/article-writing.md')

function readSkill(): string {
  return readFileSync(SKILL_PATH, 'utf-8')
}

function parseDescription(raw: string): string {
  // Extract YAML frontmatter between opening and closing ---
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return ''
  const fm = match[1]!
  // description: | (block scalar) — collect all indented lines after the key
  const descMatch = fm.match(/^description:\s*\|\n((?:[ \t]+[^\n]*\n?)+)/m)
  if (!descMatch) return ''
  return descMatch[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
}

describe('article-writing skill', () => {
  it('skill file exists', () => {
    expect(() => readSkill()).not.toThrow()
  })

  it('has non-empty description frontmatter containing "article"', () => {
    const raw = readSkill()
    const desc = parseDescription(raw)
    expect(desc.length).toBeGreaterThan(0)
    expect(desc.toLowerCase()).toContain('article')
  })

  it('body contains all required Markdown syntax markers', () => {
    const raw = readSkill()
    const required = [
      '## ',
      '### ',
      '- [ ]',
      '- [x]',
      '> ',
      '---',
      '![media:',
      'createDocumentFromMarkdown',
      'updateDocument',
    ]
    for (const marker of required) {
      expect(raw, `missing required marker: ${JSON.stringify(marker)}`).toContain(marker)
    }
  })

  it('body does NOT contain a bare ES-module import statement (no src/ import slipped in)', () => {
    const raw = readSkill()
    // Match actual JS module import syntax, not the word "import" appearing in prose
    // (e.g. "cannot import from `src/`" is legitimate instructional text)
    expect(raw).not.toMatch(/^import\s+[^a-z]/m) // 'import {' or 'import type'
    expect(raw).not.toContain("from 'src/")
    expect(raw).not.toContain('from "src/')
  })

  it('body is at least 500 characters (guard against accidental truncation)', () => {
    const raw = readSkill()
    // Strip frontmatter, measure body only
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
    expect(body.length).toBeGreaterThan(500)
  })

  it('upload placeholder regex matches canonical form', () => {
    expect(UPLOAD_PLACEHOLDER_REGEX.test('![media:6860a1c3f2e4d10012ab3456]()')).toBe(true)
    expect(UPLOAD_PLACEHOLDER_REGEX.test('![media:42]()')).toBe(true)
  })

  it('upload placeholder regex does NOT match standard Markdown image', () => {
    expect(UPLOAD_PLACEHOLDER_REGEX.test('![alt text](https://example.com/img.png)')).toBe(false)
  })

  it('upload placeholder regex captures relationTo and id', () => {
    const m = '![media:abc123]()'.match(UPLOAD_PLACEHOLDER_REGEX)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('media')
    expect(m![2]).toBe('abc123')
  })
})
