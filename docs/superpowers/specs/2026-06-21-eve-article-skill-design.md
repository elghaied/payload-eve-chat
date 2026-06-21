# Eve Article-Writing Skill — Design Spec

**Date:** 2026-06-21
**Status:** Draft
**Related:** SP-B (generateImage tool — image generation + Media upload custom MCP tool)

---

## Goal

Teach the Eve agent the full Lexical Markdown vocabulary (headings, lists, checklists, blockquotes,
horizontal rules, code, links, upload placeholders) and encode the draft→approve→publish editorial
workflow as a load-on-demand Eve skill, so the agent writes richly-structured articles without
bloating every turn's context.

---

## Architecture

This is a **flat markdown skill** at `agent/skills/article-writing.md`. A flat file is sufficient
because the skill carries only instructions (no sibling reference files, no typed runtime values, no
generated content). The skill is loaded lazily via Eve's `load_skill` built-in when the model matches
the skill's description; it adds zero context cost on unrelated turns.

The skill encodes the editorial flow (write inline → user approves → create as draft via
`createDocumentFromMarkdown` → publish via `updateDocument`) and the complete Lexical Markdown
vocabulary including the upload placeholder `![media:<id>]()` that SP-B's `generateHeroImage` tool
returns. The skill does not define any tools; it only adds instructions.

Because Eve agent code under `agent/` cannot import from `src/`, all runtime capabilities (Lexical
conversion, image generation, Payload writes) live as custom Payload MCP tools in `src/eve/` and are
called over the existing `payload-mcp` connection. The skill references these tools by their MCP
names but never imports them.

---

## Components & Files

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `agent/skills/article-writing.md` | The skill file: description frontmatter, full Lexical Markdown vocabulary reference, editorial workflow procedure |
| **Modify** | `agent/instructions.md` | Trim the inline article-writing section (lines 17–25: the write→approve→publish bullet block) to a one-line pointer so the detail lives only in the skill |

No other files need to change for SP-A alone. SP-B (generateImage) creates `src/eve/image-tool.ts`
and wires it into `src/payload.config.ts`; that is out of scope here.

---

## Deciding: Flat File vs Packaged SKILL.md

**Chosen: flat file** (`agent/skills/article-writing.md`).

Rationale (from verified Eve docs at `<eveDir>/docs/skills.mdx`):

- A flat markdown file can carry `description` frontmatter. Eve reads it and uses it as the routing
  hint. The filename slug is `article-writing`.
- A packaged `SKILL.md` is warranted only when sibling files (references, assets, scripts) or typed
  `defineSkill` values are needed. This skill needs neither.
- Eve's fallback (advertises first non-empty line as description) is unreliable for intent routing,
  so explicit `description` frontmatter is required on the flat file — included in the design below.

---

## Skill Routing Description

```
description: |
  Use when writing or drafting an article or blog post — including choosing heading levels,
  inserting images or hero images (with a media ID from generateHeroImage), using checklists,
  blockquotes, or other rich formatting — or managing the draft/approve/publish workflow for posts.
```

This is written as the task that should trigger activation, per Eve's routing-hint convention.

---

## Skill File Content (full text, to be saved verbatim)

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
  text only (see §8).
- `generateHeroImage` tool output is `{ id, url }` only — never raw bytes or base64 — to keep the
  model context small.

## 8. Testing strategy

Unit tests (vitest, jsdom env):

- Parse the skill file's `description` frontmatter and assert it is non-empty (confirms routing
  hint is present).
- Assert the skill body contains all required Markdown patterns: `##`, `###`, `- [ ]`, `- [x]`,
  `>`, `---`, `![media:`, `createDocumentFromMarkdown`, `updateDocument`.
- Assert the skill body does NOT contain the string `import` (confirms no src/ import slipped in).
- Snapshot test the skill body length (guard against accidental truncation).

No live model or image calls in tests. The `convertMarkdownToLexical` path is tested upstream
in Payload's own test suite and in the existing markdown-tool integration if present.
```

---

## Data Flow

```
User: "Write an article about X with a hero image"
  │
  ├─ Model matches skill description → load_skill("article-writing")
  │    └─ Skill body appended to turn context
  │
  ├─ Model drafts article inline (Markdown in chat reply)
  │    └─ Ends with approval prompt
  │
User: "approve"
  │
  ├─ Model calls: generateHeroImage({ prompt: "X hero image" })   [SP-B, payload-mcp]
  │    └─ Returns { id: "abc123", url: "https://..." }
  │
  ├─ Model calls: createDocumentFromMarkdown({
  │      collectionSlug: "posts",
  │      data: { title: "...", status: "draft" },
  │      markdown: { content: "![media:abc123]()\n\n## Introduction\n\n..." }
  │    })                                                          [payload-mcp]
  │    └─ convertMarkdownToLexical runs server-side in Payload process
  │    └─ UploadMarkdownTransformer converts ![media:abc123]() → UploadServerNode
  │    └─ Returns: "Created posts document (id: xyz789)."
  │
  ├─ Model replies: "Saved as draft. Reply 'publish' to make it live."
  │
User: "publish"
  │
  └─ Model calls: updateDocument({
         collectionSlug: "posts",
         id: "xyz789",
         data: { status: "published" }
       })                                                          [payload-mcp]
       └─ Model replies: "Published."
```

---

## Interfaces

### Skill file frontmatter (required)

```yaml
---
description: |
  Use when writing or drafting an article or blog post — including choosing heading levels,
  inserting images or hero images (with a media ID from generateHeroImage), using checklists,
  blockquotes, or other rich formatting — or managing the draft/approve/publish workflow for posts.
---
```

### Upload placeholder (verified from dist)

Regex in `UploadMarkdownTransformer` (dist `features/upload/server/markdownTransformer.js`):

```ts
const UPLOAD_PLACEHOLDER_REGEX = /!\[([^\]:]+):([^\]]+)\]\(\)/;
// Group 1: relationTo ("media")
// Group 2: id (string or numeric)
```

So the canonical form is `![media:<id>]()` where `<id>` is the Media document id (string for
MongoDB, number for SQLite).

### `createDocumentFromMarkdown` input shape (from `src/eve/markdown-tool.ts`)

```ts
{
  collectionSlug: "posts",
  data?: Record<string, unknown>,   // e.g. { title: string, status: "draft" | "published" }
  markdown?: Record<string, string> // e.g. { content: "<Markdown body>" }
}
```

### `generateHeroImage` output (SP-B, not yet implemented)

```ts
{ id: string, url: string }
```

The skill builds the placeholder as: `` `![media:${id}]()` ``.

---

## What to Trim from `instructions.md`

The current `instructions.md` (lines 17–25) contains the full write→approve→publish procedure
as a numbered bullet block. That detail duplicates what the skill will carry.

**Proposed trim:** Replace the full bullet block (lines 17–25) with a single sentence that points to
the skill:

```
- **Creating a post:** write it inline first, get user approval, then call
  createDocumentFromMarkdown as draft; use updateDocument to publish. Load the
  article-writing skill for the full procedure and Markdown vocabulary.
```

This keeps `instructions.md` as an always-on baseline (so the model never forgets the concept of
approval-before-create) while relocating the full vocabulary and step-by-step procedure into the
skill (loaded on demand). Avoids duplicated guidance without leaving the model completely uninformed
on unloaded turns.

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| `createDocumentFromMarkdown` fails (validation error) | Tool returns an error string; model reports it to the user and asks if they want to retry or adjust the content |
| `generateHeroImage` fails (SP-B not yet wired, image model error) | Model skips the hero, notes it in the reply, and proceeds with text-only article |
| User says "approve" before an image was generated | Model generates image then creates the document in sequence |
| User provides a raw image URL instead of a media id | Model explains the placeholder requires a Payload media id, offers to call `generateHeroImage` or `findDocuments` to find one |
| Upload placeholder has wrong `relationTo` (e.g. `![image:id]()`) | `UploadMarkdownTransformer` won't match and the node is silently dropped; spec mandates always using `media` (the slug from `src/collections/Media.ts`) |

---

## Testing Strategy

Vitest unit tests (jsdom env, no live model or image calls):

1. **Skill frontmatter**: read `agent/skills/article-writing.md`, parse YAML frontmatter, assert
   `description` is a non-empty string containing the word "article".
2. **Vocabulary completeness**: assert skill body contains all required Markdown pattern strings:
   `## `, `### `, `- [ ]`, `- [x]`, `> `, `---`, `![media:`, `createDocumentFromMarkdown`,
   `updateDocument`.
3. **No src/ import**: assert skill body does not contain `import ` or `from 'src/` (guards
   against future edits that would break Eve bundling).
4. **Body length guard**: snapshot or assert `> 500` characters (catches accidental truncation).
5. **UploadMarkdownTransformer regex** (if unit test coverage for the transformer is desired):
   `@payloadcms/richtext-lexical` does **not** publicly export `UploadMarkdownTransformer` — the deep
   dist path `./dist/features/upload/server/markdownTransformer.js` is not in the package's `exports`
   map and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime. Do **not** import it. Instead, inline
   the regex literal directly in the test file and assert it matches the expected placeholder forms:
   ```ts
   const UPLOAD_PLACEHOLDER_REGEX = /!\[([^\]:]+):([^\]]+)\]\(\)/;
   // positive: "![media:abc123]()", "![media:42]()"
   // negative: "![alt](url)"
   ```
   Copy the regex verbatim — no package import required.

---

## Cost / Credit Considerations

- The skill itself adds zero cost (no model/image call; loaded lazily on demand).
- `generateHeroImage` (SP-B) costs ~$0.02/image (Imagen 4 Fast). Exclude from unit tests.
- `createDocumentFromMarkdown` is a Payload Local API call — no AI cost.
- `updateDocument` is an MCP tool call — no AI cost.
- Token cost: skill body (~900 tokens) is only in context when an article is being written.

---

## Open Questions / Risks

1. **SP-B availability**: This skill references `generateHeroImage` by name. Until SP-B is
   implemented, the model will attempt to call a non-existent tool and receive an error. The
   error-handling section above covers the graceful fallback. This is acceptable for incremental
   rollout (skill can ship before SP-B).
2. **`relationTo` slug**: The upload placeholder hardcodes `media` as the relation slug. This
   matches `src/collections/Media.ts` (`slug: 'media'`). If the Media collection slug ever changes,
   the skill instructions must be updated.
3. **instructions.md trim scope**: The trim is conservative (one pointer sentence). If the model
   proves unable to load the skill reliably on article requests, the routing description should be
   made more specific (e.g. include "blog", "write", "draft" as explicit triggers).
4. **Heading H1 in content field**: The Posts schema has a separate `title` field. The skill
   instructs the model to put the title in `data.title`, not in the Markdown body as `#`. If a user
   asks the model to include the title in the body too, that results in a redundant H1. The skill
   guidance is clear on this; no code change needed.
5. **Image: numeric vs string id**: `UploadMarkdownTransformer` handles both numeric and string ids
   (`/^\d+$/.test(value) ? Number(value) : value`). MongoDB ids are strings; SQLite ids are
   numbers. Both work; the model should pass the id exactly as returned by the tool.

---

## Review corrections applied

- **Testing Strategy §5** (important): removed the suggested `import` of `@payloadcms/richtext-lexical/dist/features/upload/server/markdownTransformer.js` (path not in the package `exports` map; throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). Replaced with an inline regex literal and a note that no package import is needed.
