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

## connection_search (Eve built-in — auto-injected when a connection is declared)
- `toolName` / `toolMetadata.eve.name`: **`connection__search`** (slug `connection`, tool `search`).
- `part.input`: `{ keywords:string, connection?:string, limit?:number }`.
- `part.output`: an **ARRAY** of `{ connection:string, description:string, tool?:string,
  qualifiedName?:string, inputSchema?:object, outputSchema?:object, needsAuthorization?:boolean,
  error?:string }`. This is Eve discovering callable MCP tools — render a quiet "Found N tools"
  summary, NEVER the schema dump (it WAS the raw-JSON card the user reported).

## todo (Eve built-in durable per-session checklist — ACTIVE, not disabled)
- `toolName` / `eve.name`: **`todo`**. `part.input`: `{ todos:[{content,status,priority}] }`.
- `part.output`: `{ counts:{pending,in_progress,completed,cancelled,total}, todos:[{content,
  status:'pending'|'in_progress'|'completed'|'cancelled', priority:'high'|'medium'|'low'}] }`.
  Render as a checklist with per-status icons (strike-through completed/cancelled).

## Name-qualified tool calls (IMPORTANT)
With a connection declared, Eve calls MCP tools by their **qualified** name
`connection__<connectionName>__<tool>` (e.g. `connection__payload-mcp__createDocument`), NOT the
bare tool name. Use `bareToolName()` to strip the prefix before matching/labeling. The bare names
below are what survives stripping.

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

## Built-in tool coverage (eve@0.11.7 `ALL_FRAMEWORK_TOOLS`)
ask_question (HITL → InputRequestCard) · web_search ✓ · web_fetch ✓ · todo ✓ · connection__search ✓
· connection__<conn>__* MCP ✓ · bash/glob/grep/read_file/write_file = `disableTool()` (never appear)
· load_skill = only with skills declared (we have none). No `agent` tool in this version.

## Rendering plan
- Narrow on `state`. Running (input-*) → spinner + humanized verb (+ title from input.data when present).
- output-available → tool-specific component (web_search links / web_fetch url+preview /
  discovery "Found N tools" / todo checklist / MCP "Created/Updated/Found … →" with admin link).
  **Generic fallback NEVER dumps JSON** — it renders a clean "✓ <tool> completed" line. (The user
  explicitly rejected raw JSON in cards.) Inspect real payloads in devtools/network, not the chat.
- output-error/denied → error/denial line.
