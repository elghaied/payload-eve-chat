'use client'
import React, { useCallback, useRef, useState } from 'react'
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

// Drag-to-resize the panel width. Persisted so it sticks across opens (the panel
// remounts per draft). The panel is docked on the right, so dragging the left-edge
// handle leftward (smaller clientX) widens it.
const WIDTH_STORAGE_KEY = 'eve:postPreviewWidth'
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 448 // 28rem

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY))
  return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH
}

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

  const [width, setWidth] = useState(readStoredWidth)
  const widthRef = useRef(width)
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)
  // Holds the listeners for the active drag; aborting it detaches both at once
  // (avoids a handler referencing itself to remove its own listener).
  const dragAbortRef = useRef<AbortController | null>(null)

  const onResizeMove = useCallback((e: PointerEvent) => {
    const start = dragStartRef.current
    if (!start) return
    const max = Math.min(960, window.innerWidth * 0.7)
    const next = Math.max(MIN_WIDTH, Math.min(max, start.width + (start.x - e.clientX)))
    widthRef.current = next
    setWidth(next)
  }, [])

  const onResizeEnd = useCallback(() => {
    dragAbortRef.current?.abort()
    dragAbortRef.current = null
    dragStartRef.current = null
    document.body.style.userSelect = ''
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(widthRef.current)))
  }, [])

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragStartRef.current = { x: e.clientX, width: widthRef.current }
      document.body.style.userSelect = 'none'
      const controller = new AbortController()
      dragAbortRef.current = controller
      window.addEventListener('pointermove', onResizeMove, { signal: controller.signal })
      window.addEventListener('pointerup', onResizeEnd, { signal: controller.signal })
    },
    [onResizeMove, onResizeEnd],
  )

  const canCreate = title.trim().length > 0 && markdown.trim().length > 0

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-border bg-card"
      style={{ width }}
    >
      <div
        aria-label="Resize preview panel"
        aria-orientation="vertical"
        className="absolute top-0 left-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border"
        onPointerDown={onResizeStart}
        role="separator"
      />
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
