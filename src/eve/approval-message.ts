export type PostDraft = { title: string; status: 'draft' | 'published'; markdown: string }

/**
 * The follow-up message the client sends when the user approves a proposed post.
 * It instructs the agent to create the post via the MCP `createDocumentFromMarkdown`
 * tool using the approved content verbatim. Sent through the normal chat flow.
 */
export function buildApprovalMessage(draft: PostDraft): string {
  return [
    'Approved — create this post now with createDocumentFromMarkdown, using this content exactly (do not change it):',
    `- title: ${draft.title}`,
    `- status: ${draft.status}`,
    '- markdown (content):',
    draft.markdown,
  ].join('\n')
}
