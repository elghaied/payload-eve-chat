'use client'
import React from 'react'

export type ConversationSummary = { id: string; title: string }

export const ConversationSidebar: React.FC<{
  conversations: ConversationSummary[]
  activeId?: string
  onSelect: (id: string) => void
  onNew: () => void
}> = ({ conversations, activeId, onSelect, onNew }) => (
  <aside className="eve-scope flex w-64 shrink-0 flex-col gap-2 border-r border-[var(--border)] p-3">
    <button
      type="button"
      onClick={onNew}
      className="rounded-[var(--radius)] bg-[var(--primary)] px-3 py-2 text-sm text-[var(--primary-foreground)]"
    >
      + New chat
    </button>
    <nav className="flex flex-col gap-1 overflow-y-auto">
      {conversations.length === 0 ? (
        <p className="px-2 py-1 text-sm text-[var(--muted-foreground)]">No conversations yet.</p>
      ) : (
        conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`truncate rounded-[var(--radius)] px-3 py-2 text-left text-sm ${
              c.id === activeId ? 'bg-[var(--muted)]' : 'hover:bg-[var(--muted)]'
            }`}
          >
            {c.title || 'Untitled'}
          </button>
        ))
      )}
    </nav>
  </aside>
)
