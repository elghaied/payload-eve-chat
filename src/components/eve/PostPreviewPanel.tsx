'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MessageResponse } from '@/components/ai-elements/message'
import { XIcon } from 'lucide-react'
import type { PostDraft } from '@/eve/approval-message'

/**
 * Editable side-panel artifact for a proposed post. Holds local edits to title,
 * status, and Markdown; "Add it" hands the final draft back to the parent (which
 * re-engages the agent to create it via MCP). The panel itself writes nothing.
 */
export const PostPreviewPanel: React.FC<{
  draft: PostDraft
  onApprove: (final: PostDraft) => void
  onClose: () => void
}> = ({ draft, onApprove, onClose }) => {
  const [title, setTitle] = useState(draft.title)
  const [status, setStatus] = useState<PostDraft['status']>(draft.status)
  const [markdown, setMarkdown] = useState(draft.markdown)

  const canCreate = title.trim().length > 0 && markdown.trim().length > 0

  return (
    <aside className="flex w-[28rem] shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between border-b border-border p-3">
        <h2 className="font-medium text-sm">Post preview</h2>
        <Button aria-label="Close preview" onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-2 p-3">
        <Input
          aria-label="Post title"
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Post title"
          value={title}
        />
        <Select onValueChange={(v) => setStatus(v as PostDraft['status'])} value={status}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs className="flex min-h-0 flex-1 flex-col px-3" defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent className="min-h-0 flex-1" value="edit">
          <Textarea
            aria-label="Post Markdown body"
            className="h-full min-h-64 resize-none font-mono text-sm"
            onChange={(e) => setMarkdown(e.currentTarget.value)}
            placeholder="Write the post in Markdown…"
            value={markdown}
          />
        </TabsContent>
        <TabsContent className="min-h-0 flex-1 overflow-auto" value="preview">
          <MessageResponse>{markdown}</MessageResponse>
        </TabsContent>
      </Tabs>

      <footer className="flex justify-end gap-2 border-t border-border p-3">
        <Button onClick={onClose} variant="ghost">
          Discard
        </Button>
        <Button
          disabled={!canCreate}
          onClick={() => onApprove({ title: title.trim(), status, markdown })}
        >
          Add it
        </Button>
      </footer>
    </aside>
  )
}
