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
| Strikethrough | `~~text~~` | |
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
