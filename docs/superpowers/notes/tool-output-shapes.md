# Tool output shapes (for chat tool-result components)

> Runtime shapes of `EveDynamicToolPart.input` / `.output` per tool. Derived from installed
> `eve@0.11.7` + `@payloadcms/plugin-mcp`. `output` only exists on state `output-available`.

## web_search (Anthropic native via gateway — default model is anthropic/*)
- `part.input`: **undefined/{}** — provider-native; the query is NOT exposed to us.
- `part.output`: an **ARRAY** (not wrapped): `Array<{ type:'web_search_result', url:string,
  title:string|null, pageAge:string|null, encryptedContent:string }>`. `encryptedContent` is
  Anthropic-encrypted (NOT readable) → render `title` + `url` (+ pageAge) as clickable links only.

## web_fetch
- `part.input`: `{ url:string, format?:'html'|'markdown'|'text', timeout?:number }`.
- `part.output`: `{ content:string, contentType:string, url:string, truncated:boolean }` (all present).

## Payload MCP tools (@payloadcms/plugin-mcp) — output = raw MCP CallToolResult + a `doc` extension
All four put the full Payload document on the NON-standard top-level `part.output.doc`:
`part.output = { content:[{type:'text', text}], doc?, isError?, structuredContent? }`.
`doc` is absent on error. Collection slug: read `part.input.collectionSlug` (fallback: infer from
doc fields — `priority`/`done` ⇒ tasks; `status`/`content` ⇒ posts). Admin link:
`/admin/collections/<slug>/<doc.id>`.

- **createDocument** (tasks): input `{ collectionSlug, data:{title,done?,priority?,dueDate?}, ... }`;
  output `doc = { id, title, done, priority, dueDate?, ... }`.
- **createDocumentFromMarkdown** (posts only): input `{ collectionSlug:'posts',
  data:{title,status,author?}, markdown:{content} }`; output `doc = { id, title, status, content(Lexical), ... }`.
- **findDocuments**: input `{ collectionSlug, id?|where?, limit?, ... }`; output by-id ⇒ `doc = <document>`;
  list ⇒ `doc = { docs:[...], totalDocs, page, totalPages, ... }`.
- **updateDocument**: input `{ collectionSlug, id?|where?, data, ... }`; by-id ⇒ `doc = <updated doc>`;
  bulk ⇒ `doc = { docs:[...], errors:[...] }`, `isError` if errors.

## EveDynamicToolPart fields
`toolName`, `toolMetadata.eve.{name,kind}` (kind 'tool-call' for these), `input`, `output`,
`state` ('input-streaming'|'input-available'|'approval-requested'|'approval-responded'|
'output-available'|'output-error'|'output-denied'), `errorText` (on output-error).

## Rendering plan
- Narrow on `state`. Running (input-*) → spinner + humanized verb (+ title from input.data when present).
- output-available → tool-specific component (web_search links / web_fetch url+preview /
  MCP "Created/Updated/Found … →" with admin link). Generic fallback: show `content[0].text` or a
  compact summary, raw JSON only behind a details toggle.
- output-error/denied → error/denial line.
