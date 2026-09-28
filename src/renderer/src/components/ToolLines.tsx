import { useState } from 'react'
import type { ToolUse } from '@shared/types'
import { describeTool } from '../lib/format'
import { ChevronIcon, SpinnerIcon, ToolIcon } from './icons'

function label(t: ToolUse): string {
  const { source, action } = describeTool(t.name)
  return action ? `${source} · ${action}` : source
}

/** Compact "Used Gmail · search_threads" line; expands to show each call. */
export function ToolLines({ tools }: { tools: ToolUse[] }) {
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null

  const running = tools.find((t) => t.status === 'running')
  const sources = [...new Set(tools.map((t) => describeTool(t.name).source))]
  const first = tools[0] as ToolUse
  const headline = running
    ? `Using ${label(running)}…`
    : tools.length === 1
      ? `Used ${label(first)}`
      : `Used ${sources.join(', ')} · ${tools.length} steps`

  return (
    <div className="mb-1 max-w-[560px] text-[12px] text-muted">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-hover hover:text-fg"
        aria-expanded={open}
      >
        {running ? <SpinnerIcon size={12} /> : <ToolIcon size={12} />}
        <span>{headline}</span>
        <ChevronIcon size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1 ml-2 space-y-0.5 border-l border-line pl-3">
          {tools.map((t) => (
            <li key={t.id} className="flex items-baseline gap-2">
              <span className={t.status === 'error' ? 'text-danger' : t.status === 'running' ? 'text-accent' : 'text-success'}>
                {t.status === 'error' ? '✗' : t.status === 'running' ? '•' : '✓'}
              </span>
              <span className="text-fg/80">{label(t)}</span>
              {t.summary && <span className="selectable truncate font-mono text-[11px]">{t.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
