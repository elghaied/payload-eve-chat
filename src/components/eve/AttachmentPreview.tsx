'use client'
import React from 'react'
import type { FileUIPart } from 'ai'
import { FileIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AttachmentPreviewProps {
  file: FileUIPart
  onRemove?: (file: FileUIPart) => void
  className?: string
}

/**
 * Pure presentational component that renders a single attached file as:
 * - An image thumbnail (for image/* MIME types)
 * - A filename chip with a document icon (for everything else, e.g. application/pdf)
 *
 * When onRemove is provided (pre-send strip), an X button appears.
 * Without onRemove (post-send bubble), the X button is absent.
 */
export function AttachmentPreview({ file, onRemove, className }: AttachmentPreviewProps): React.ReactElement {
  const isImage = file.mediaType.startsWith('image/')

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      {isImage ? (
        <img
          src={file.url}
          alt={file.filename ?? 'attachment'}
          className="max-h-24 max-w-[120px] rounded object-cover"
        />
      ) : (
        <div className="flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-muted-foreground text-xs">
          <FileIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="max-w-[100px] truncate">{file.filename ?? 'file'}</span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove attachment"
          onClick={() => onRemove(file)}
          className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:bg-destructive hover:text-destructive-foreground"
        >
          <XIcon className="size-2.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
