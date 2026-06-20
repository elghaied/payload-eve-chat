'use client'

import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { EveDynamicToolPart } from 'eve/react'
import { Spinner } from '@/components/ui/spinner'
import { humanizeToolName } from './inputRequest'
import { describeToolResult, hostOf, runningLabel, type ToolResultView } from './toolResult'

function Shell({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border bg-card/60 p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

function ResultBody({ view }: { view: ToolResultView }) {
  if (view.kind === 'web_search') {
    if (!view.answer && view.results.length === 0)
      return <span className="text-muted-foreground">No web results.</span>
    return (
      <div>
        {view.answer && (
          <p className="mb-2 whitespace-pre-wrap text-foreground">{view.answer}</p>
        )}
        {view.results.length > 0 && (
          <div className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Sources
          </div>
        )}
        <ul className="space-y-1.5">
          {view.results.map((r, i) => (
            <li key={i} className="min-w-0">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate">{r.title}</span>
                <ExternalLinkIcon className="size-3 shrink-0 opacity-60" />
              </a>
              <div className="truncate text-muted-foreground text-xs">
                {hostOf(r.url)}
                {r.pageAge ? ` · ${r.pageAge}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (view.kind === 'web_fetch') {
    return (
      <div>
        <div className="mb-1 font-medium">
          Read{' '}
          <a
            href={view.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {hostOf(view.url)}
          </a>
        </div>
        {view.preview && (
          <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground text-xs">
            {view.preview}
            {view.truncated ? '…' : ''}
          </p>
        )}
      </div>
    )
  }

  if (view.kind === 'records') {
    const noun = view.collection ? view.collection.replace(/s$/, '') : 'record'
    if (view.verb === 'Found') {
      return (
        <div>
          <div className="mb-1 font-medium">
            Found {view.total ?? view.records.length} {view.collection ?? 'records'}
          </div>
          <ul className="space-y-1">
            {view.records.map((rec) => (
              <li key={rec.id} className="truncate">
                {rec.href ? (
                  <a href={rec.href} className="text-primary hover:underline">
                    {rec.label}
                  </a>
                ) : (
                  <span>{rec.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )
    }
    const rec = view.records[0]
    return (
      <div className="font-medium">
        {view.verb} {noun}{' '}
        {rec?.href ? (
          <a href={rec.href} className="text-primary hover:underline">
            {rec.label}
          </a>
        ) : (
          <span>{rec?.label}</span>
        )}
      </div>
    )
  }

  if (view.kind === 'text') {
    return <p className="whitespace-pre-wrap text-muted-foreground">{view.text}</p>
  }

  // Unknown structured output — readable, raw JSON behind a toggle (never a bare dump).
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">Tool result (details)</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs">{view.json}</pre>
    </details>
  )
}

function iconFor(view: ToolResultView): ReactNode {
  switch (view.kind) {
    case 'web_search':
      return <SearchIcon className="size-4" />
    case 'web_fetch':
      return <GlobeIcon className="size-4" />
    case 'records':
      return view.verb === 'Created' ? (
        <PlusIcon className="size-4 text-green-600" />
      ) : view.verb === 'Updated' ? (
        <PencilIcon className="size-4 text-blue-600" />
      ) : (
        <CheckCircle2Icon className="size-4 text-green-600" />
      )
    default:
      return <LinkIcon className="size-4" />
  }
}

/**
 * Render a dynamic-tool part as a purpose-built result component (clickable search links,
 * fetched-URL preview, "Created task → admin link", etc.) instead of raw JSON. Handles the
 * running / error / denied states too. HITL (approval-requested) is handled upstream.
 */
export function ToolResultCard({ part }: { part: EveDynamicToolPart }) {
  const label = humanizeToolName(part.toolMetadata?.eve?.name ?? part.toolName)

  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return (
      <Shell icon={<Spinner className="size-4" />}>
        <span className="text-muted-foreground">{runningLabel(part)}</span>
      </Shell>
    )
  }

  if (part.state === 'output-error') {
    return (
      <Shell icon={<AlertTriangleIcon className="size-4 text-destructive" />}>
        <div className="font-medium text-destructive">{label} failed</div>
        <div className="whitespace-pre-wrap break-words text-muted-foreground text-xs">
          {part.errorText}
        </div>
      </Shell>
    )
  }

  if (part.state === 'output-denied') {
    return (
      <Shell icon={<BanIcon className="size-4 text-orange-600" />}>
        <span className="text-muted-foreground">
          {label} denied{part.approval?.reason ? `: ${part.approval.reason}` : ''}
        </span>
      </Shell>
    )
  }

  const view = describeToolResult(part)
  if (!view) return null
  return <Shell icon={iconFor(view)}>{<ResultBody view={view} />}</Shell>
}
