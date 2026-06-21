# Article-Writing Skill (SP-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the Eve agent the full Lexical Markdown vocabulary and the draft→approve→publish editorial workflow as a load-on-demand Eve skill (`agent/skills/article-writing.md`), trimming the now-duplicated inline guidance from `agent/instructions.md`.

**Architecture:** A flat markdown skill file with `description` frontmatter. Eve reads the frontmatter routing hint and loads the skill lazily via the built-in `load_skill` tool when the model matches an article-writing intent. The skill adds instructions only — no tools, no imports, no src/ references. Existing MCP tools (`createDocumentFromMarkdown`, `updateDocument`, `findDocuments`) are called by the model over the `payload-mcp` connection. `agent/instructions.md` is trimmed to a one-line pointer so the always-on system prompt stays concise.

**Tech Stack:** Payload CMS v4 (canary), Eve `0.11.7`, Vitest (jsdom env), pnpm. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-21-eve-article-skill-design.md`

## Global Constraints

- **No new dependencies.** This plan touches only markdown + test files.
- **No tools defined in the skill.** The skill is instructions-only.
- **No imports from `src/`** in any `agent/` file — Eve's bundler cannot resolve them.
- **Inline the upload regex literal** in tests. Do NOT import from `@payloadcms/richtext-lexical/dist/...` (path blocked by the package exports map → `ERR_PACKAGE_PATH_NOT_EXPORTED`).
- **No live model or image calls in tests.** All gateway credits must be protected.
- **Upload placeholder canonical form:** `![media:<id>]()` — `media` is the collection slug from `src/collections/Media.ts`. Must match dist regex `/!\[([^\]:]+):([^\]]+)\]\(\)/`.
- **`createDocumentFromMarkdown` input shape** (from `src/eve/markdown-tool.ts`): `{ collectionSlug: "posts", data?: Record<string, unknown>, markdown?: Record<string, string> }`. Body goes in `markdown.content`.
- **`structuredContent` rule:** custom MCP tools authored by us must return `structuredContent` to expose typed output. This plan defines no new tools, so the rule is informational only.
- **Test commands:** `pnpm run test:int` (runs `tests/int/**/*.int.spec.ts`, `src/**/*.test.ts`, `src/**/*.test.tsx`). Types: `pnpm exec tsc --noEmit`. Agent graph: `node_modules/.bin/eve info` (expect 0 diagnostics).
- **Default model:** `anthropic/claude-haiku-4.5` (unchanged; the skill adds no model config).
- Commit after every task. Conventional-commit messages.

---

### Task 1: Create the skill file

**Files:**
- Create: `agent/skills/article-writing.md`
- Test path: `src/components/eve/articleSkill.test.ts` (new)

**Interfaces:**
- Produces: `agent/skills/article-writing.md` — flat markdown with YAML frontmatter (`description`) and body sections covering editorial workflow, Markdown vocabulary table, upload placeholder format, hero image heuristic, article structure guidelines, tool reference table, and constraints.
- Consumes: Nothing — the skill is pure content.

- [ ] **Step 1: Write the failing test for skill file existence and frontmatter**

Create `src/components/eve/articleSkill.test.ts`:

```ts
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
```

Run (expected FAIL — skill file does not exist yet):

```bash
cd /home/sam/projects/payload-eve-chat && pnpm run test:int -- --reporter=verbose src/components/eve/articleSkill.test.ts 2>&1 | tail -20
```

Expected: test run fails with `ENOENT: no such file or directory` on `agent/skills/article-writing.md`.

- [ ] **Step 2: Create the skill directory and file**

```bash
mkdir -p /home/sam/projects/payload-eve-chat/agent/skills
```

Then create `agent/skills/article-writing.md` with the exact content specified in the spec (verbatim from the "Skill File Content" section):

```md
---
description: |
  Use when writing or drafting an article or blog post — including choosing heading levels,
  inserting images or hero images (with a media ID from generateHeroImage), using checklists,
  blockquotes, or other rich formatting — or managing the draft/approve/publish workflow for posts.
---

# Article-Writing Procedure

## 1. Editorial workflow

1. **Draft inline.** Write the full article as Markdown in your chat reply — title heading plus
   body. Do NOT call `createDocumentFromMarkdown` yet.
2. **Ask for approval.** End with a short prompt, e.g.: _"Reply 'approve' to save this as a draft,
   or tell me what to change."_ Revise inline if the user requests edits; ask again after each
   revision.
3. **On approval** (user says "approve", "yes", "create it", "looks good", etc.):
   - If a hero image was requested and not yet generated, call `generateHeroImage` first (see §4).
   - Call `createDocumentFromMarkdown` with `collectionSlug: "posts"`, `data: { title, status: "draft" }`,
     and `markdown: { content: "<the article body you already wrote>" }`.
   - Confirm with: _"Saved as a draft. Reply 'publish' to make it live."_
4. **On publish** (user says "publish it", "go live", etc.):
   - Call `updateDocument` with `collectionSlug: "posts"`, the document `id` from step 3,
     and `data: { status: "published" }`.
   - Confirm with: _"Published."_

Never fabricate an id. Always reuse the content already written in the conversation — do not
re-generate the article on save.

## 2. Markdown vocabulary

The Posts `content` field uses Payload's default `lexicalEditor()`. The following Markdown
syntax is understood by `convertMarkdownToLexical` (verified against
`@payloadcms/richtext-lexical` dist `lexical/config/server/default.js`):

| Feature | Syntax | Notes |
|---------|--------|-------|
| Heading H1 | `# Title` | Use for the article title only when the field itself is the content; omit if `title` is a separate field |
| Heading H2 | `## Section` | Main section headings |
| Heading H3 | `### Sub-section` | Sub-headings |
| Bold | `**text**` | |
| Italic | `*text*` or `_text_` | |
| Inline code | `` `code` `` | |
| Unordered list | `- item` | |
| Ordered list | `1. item` | |
| Checklist (unchecked) | `- [ ] item` | |
| Checklist (checked) | `- [x] item` | |
| Blockquote | `> text` | |
| Horizontal rule | `---` | Separates major sections |
| Link | `[label](url)` | |
| Upload (image/file embed) | `![media:<id>]()` | Special Lexical Upload node — see §3 |

Features that are NOT in the default editor (do not use them): tables, footnotes, definition lists,
task tags beyond checklist syntax, raw HTML.

## 3. Embedding images — the upload placeholder

Payload's Lexical UploadFeature recognises **one specific placeholder pattern** for embedding
a Media document into the article body:

```
![<relationTo>:<id>]()
```

Where `<relationTo>` is the collection slug (`media`) and `<id>` is the Media document id.
Example:

```
![media:6860a1c3f2e4d10012ab3456]()
```

This is converted by `UploadMarkdownTransformer` into a real Lexical UploadServerNode — a proper
embedded image block in the editor, not a plain `<img>` tag. Standard Markdown image syntax
`![alt](url)` does NOT create an Upload node and will be silently ignored by Lexical.

**Do not guess or fabricate a media id.** Always obtain the id from a tool call:

- Hero image: call `generateHeroImage` (SP-B tool, available over `payload-mcp`). It returns
  `{ id, url }`. Use the `id` to build the placeholder.
- Existing Media: call `findDocuments` with `collectionSlug: "media"` to locate an existing upload.

### Hero image placement

Place the hero placeholder at the very top of the `markdown.content` string, on its own line,
before the first heading:

```
![media:6860a1c3f2e4d10012ab3456]()

## Introduction

Body text...
```

This renders as a full-width hero image block in the Lexical editor.

### Inline images

Inline images (within the body, not just hero) use the same placeholder. Place them on their own
line between paragraphs:

```
Some paragraph.

![media:6860a1c3f2e4d10012bc7890]()

Next paragraph.
```

## 4. Deciding when to generate a hero image

Apply this heuristic:

- The user explicitly requests an image or hero → always call `generateHeroImage`.
- The user asks for a "full article" or "complete post" without specifying images → ask once:
  _"Should I generate a hero image for this article?"_ Then proceed based on the answer.
- The user asks for a quick draft, note, or checklist → no image unless asked.

If generating a hero image: call `generateHeroImage` (SP-B) before calling
`createDocumentFromMarkdown`, and embed the returned `id` in the placeholder. Tool call sequence:

```
1. generateHeroImage({ prompt: "<article topic> hero image, ..." })
   → { id: "abc123", url: "https://..." }
2. createDocumentFromMarkdown({
     collectionSlug: "posts",
     data: { title: "...", status: "draft" },
     markdown: { content: "![media:abc123]()\n\n## Introduction\n\n..." }
   })
```

## 5. Article structure guidelines

A well-structured Lexical article:

- Uses H2 (`##`) for top-level sections, H3 (`###`) for sub-sections. H1 (`#`) only as the
  article title if the content field embeds the title; otherwise omit H1 in the body.
- Uses blockquotes (`>`) for pull quotes, key takeaways, or external quotes.
- Uses horizontal rules (`---`) to separate major thematic breaks (sparingly — one or two max).
- Uses unordered lists for non-sequential items, ordered lists for steps or ranked content,
  checklists for actionable items or requirements.
- Uses inline code (`` `code` ``) for technical terms, commands, or filenames.
- Aims for 300–1500 words for a standard article. Adjust to the request.
- Keeps paragraphs under 5 lines for readability in the Lexical editor.

## 6. Tool reference (payload-mcp connection)

| Tool name (MCP) | Purpose |
|-----------------|---------|
| `createDocumentFromMarkdown` | Create a Post: converts `markdown.content` (Markdown string) to Lexical, merges with `data` fields |
| `updateDocument` | Flip `status` from `"draft"` to `"published"` (pass `id` + `data: { status: "published" }`) |
| `findDocuments` | Look up existing posts or media by query |
| `generateHeroImage` *(SP-B)* | Generate an image, save to Payload Media, return `{ id, url }` |

MCP tool names arrive prefixed (`connection__payload-mcp__<tool>`). You call them by their short
name through the connection — the framework resolves the prefix.

## 7. Constraints

- This skill adds instructions only. Do not define new tools here.
- Agent code in `agent/` cannot import from `src/`. All Payload writes and image generation are
  handled by custom MCP tools in `src/eve/` called over the `payload-mcp` connection.
- Keep `generateHeroImage` calls out of unit tests (they bill AI Gateway credits). Test the skill
  text only (see §8 in the spec).
- `generateHeroImage` tool output is `{ id, url }` only — never raw bytes or base64 — to keep the
  model context small.
```

- [ ] **Step 3: Run tests (expected PASS)**

```bash
cd /home/sam/projects/payload-eve-chat && pnpm run test:int -- --reporter=verbose src/components/eve/articleSkill.test.ts 2>&1 | tail -30
```

Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /home/sam/projects/payload-eve-chat add agent/skills/article-writing.md src/components/eve/articleSkill.test.ts && git -C /home/sam/projects/payload-eve-chat commit -m "feat(eve): add article-writing skill with Lexical vocabulary and draft→publish workflow"
```

---

### Task 2: Trim `agent/instructions.md`

**Files:**
- Modify: `agent/instructions.md` (lines 17–25)
- Test path: `src/components/eve/articleSkill.test.ts` (extend the existing test file — add one new `describe` block)

**Interfaces:**
- Consumes: `agent/instructions.md` current content (lines 17–25 hold the full write→approve→publish bullet block).
- Produces: trimmed `agent/instructions.md` where lines 17–25 are replaced by a single pointer line, keeping the always-on baseline concept without duplicating the full vocabulary.

- [ ] **Step 1: Write the failing test for the trimmed instructions**

Extend `src/components/eve/articleSkill.test.ts` — append this describe block at the bottom of the file, before the final closing brace if any (the file has no outer wrapper, so just append):

```ts
import { readFileSync as readFS } from 'fs'
import { resolve as res } from 'path'

describe('agent/instructions.md trim', () => {
  const INSTRUCTIONS_PATH = res(process.cwd(), 'agent/instructions.md')

  function readInstructions(): string {
    return readFS(INSTRUCTIONS_PATH, 'utf-8')
  }

  it('still mentions creating a post (baseline concept preserved)', () => {
    const raw = readInstructions()
    expect(raw.toLowerCase()).toContain('creating a post')
  })

  it('points to the article-writing skill', () => {
    const raw = readInstructions()
    expect(raw).toContain('article-writing')
  })

  it('no longer contains the full numbered approval steps inline (steps 1-3 removed)', () => {
    const raw = readInstructions()
    // The old text included these exact numbered strings in the inline block.
    // After trimming, they must not appear (they live in the skill file now).
    expect(raw).not.toContain('When asked to write/draft/create a post or article')
    expect(raw).not.toContain('End with a short line asking the user to approve')
    expect(raw).not.toContain('ONLY when the user approves')
  })
})
```

Note: `readFileSync` and `resolve` are already imported at the top of the file under different names. Since the test file already imports them as `readFileSync` and `resolve`, use those directly instead of re-importing. The code block above shows the intent; the actual addition to the test file should reuse existing imports without re-declaring them.

The correct addition to `src/components/eve/articleSkill.test.ts` (no re-imports, reusing `readFileSync` and `resolve` already at the top):

```ts
describe('agent/instructions.md trim', () => {
  const INSTRUCTIONS_PATH = resolve(process.cwd(), 'agent/instructions.md')

  function readInstructions(): string {
    return readFileSync(INSTRUCTIONS_PATH, 'utf-8')
  }

  it('still mentions creating a post (baseline concept preserved)', () => {
    const raw = readInstructions()
    expect(raw.toLowerCase()).toContain('creating a post')
  })

  it('points to the article-writing skill', () => {
    const raw = readInstructions()
    expect(raw).toContain('article-writing')
  })

  it('no longer contains the full numbered approval steps inline', () => {
    const raw = readInstructions()
    expect(raw).not.toContain('When asked to write/draft/create a post or article')
    expect(raw).not.toContain('End with a short line asking the user to approve')
    expect(raw).not.toContain('ONLY when the user approves')
  })
})
```

Run (expected FAIL — instructions.md still has the old text):

```bash
cd /home/sam/projects/payload-eve-chat && pnpm run test:int -- --reporter=verbose src/components/eve/articleSkill.test.ts 2>&1 | tail -20
```

Expected: the `agent/instructions.md trim` describe block fails on the "no longer contains" assertions.

- [ ] **Step 2: Trim `agent/instructions.md`**

Replace lines 17–25 (the full `Creating a post` bullet block) with the single pointer line from the spec. Current text to replace (exact):

```
- **Creating a post — write it inline, then wait for approval (do NOT save first):**
  1. When asked to write/draft/create a post or article, write the FULL article directly in
     your chat reply as Markdown (a title heading + the body). Do NOT call any create tool yet.
  2. End with a short line asking the user to approve, e.g. "Reply 'approve' to publish this, or
     tell me what to change." The user may ask for edits — revise inline and ask again.
  3. ONLY when the user approves (e.g. "approve", "yes", "create it", "publish it"), call
     createDocumentFromMarkdown (collectionSlug "posts", plain fields like title/status in
     "data", body in "markdown" as { "content": "..." }) using the article you already wrote.
     Do not re-ask for the content — reuse what's in the conversation.
```

Replace with:

```
- **Creating a post:** write it inline first, get user approval, then call
  createDocumentFromMarkdown as draft; use updateDocument to publish. Load the
  article-writing skill for the full procedure and Markdown vocabulary.
```

- [ ] **Step 3: Run all tests (expected PASS)**

```bash
cd /home/sam/projects/payload-eve-chat && pnpm run test:int -- --reporter=verbose src/components/eve/articleSkill.test.ts 2>&1 | tail -30
```

Expected: all 11 tests pass (8 from Task 1 + 3 from Task 2).

- [ ] **Step 4: Type-check (expected PASS)**

```bash
cd /home/sam/projects/payload-eve-chat && pnpm exec tsc --noEmit 2>&1 | tail -20
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git -C /home/sam/projects/payload-eve-chat add agent/instructions.md src/components/eve/articleSkill.test.ts && git -C /home/sam/projects/payload-eve-chat commit -m "refactor(eve): trim inline article guidance from instructions.md, point to article-writing skill"
```

---

### Task 3: Verify skill discovery via `eve info`

**Files:**
- No new files. This task runs the Eve CLI to confirm the agent graph compiles with 0 diagnostics and the new skill is recognized.
- Test path: inline shell assertions (no vitest file needed).

**Interfaces:**
- Consumes: `agent/skills/article-writing.md` (Task 1), `agent/agent.ts` (existing), `agent/instructions.md` (Task 2).
- Produces: confirmed 0-diagnostic Eve compile + skill listing. Any diagnostic failure must be resolved before closing the task.

- [ ] **Step 1: Run `eve info` and assert 0 diagnostics**

```bash
cd /home/sam/projects/payload-eve-chat && node_modules/.bin/eve info 2>&1
```

Expected output includes:
- `Diagnostics   0 errors, 0 warnings` (the exact label Eve prints)
- `Skills        1 skill` (confirms discovery; individual skill names are NOT printed in text mode)

If diagnostics appear: read the error, fix the offending file (most likely a syntax error in `agent/skills/article-writing.md` or `agent/instructions.md`), and re-run.

If the skill count is 0: confirm `agent/skills/` exists and `article-writing.md` has valid YAML frontmatter with a `description` key. Re-run after fixing.

To confirm the skill name (not just the count), run the JSON variant:

```bash
cd /home/sam/projects/payload-eve-chat && node_modules/.bin/eve info --json 2>&1 | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.skills)"
```

Expected: `[ 'article-writing' ]`

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
cd /home/sam/projects/payload-eve-chat && pnpm run test:int 2>&1 | tail -20
```

Expected: all existing tests pass plus the 11 new skill tests from Tasks 1–2.

- [ ] **Step 3: Commit**

```bash
git -C /home/sam/projects/payload-eve-chat commit --allow-empty -m "chore(eve): verify article-writing skill discovered by eve info (0 diagnostics)"
```

Note: if Tasks 1 and 2 were already committed cleanly and `eve info` required no fix, this step produces no file changes. Use `--allow-empty` only in that case. If a fix was required in Step 1, stage and commit the fix file instead (no `--allow-empty`).
