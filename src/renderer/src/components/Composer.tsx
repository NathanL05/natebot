import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentSummary } from '@shared/types'
import { api } from '../lib/store'
import { basename } from '../lib/format'
import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from './icons'

// Unsent text survives switching between chats.
const drafts = new Map<string, string>()

export function Composer({ agent }: { agent: AgentSummary }) {
  const [text, setText] = useState(() => drafts.get(agent.id) ?? '')
  const [attachments, setAttachments] = useState<string[]>([])
  const box = useRef<HTMLTextAreaElement>(null)
  const running = agent.status === 'running'

  useEffect(() => {
    box.current?.focus()
  }, [agent.id])

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  const update = (value: string): void => {
    setText(value)
    drafts.set(agent.id, value)
  }

  const send = (): void => {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    void api.sendMessage(agent.id, body, attachments.length ? attachments : undefined)
    update('')
    setAttachments([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const attach = async (): Promise<void> => {
    const path = await api.pickAttachment(agent.id)
    if (path && !attachments.includes(path)) setAttachments([...attachments, path])
    box.current?.focus()
  }

  const canSend = text.trim().length > 0 || attachments.length > 0

  return (
    <div className="px-6 pt-1 pb-4">
      <div className="mx-auto max-w-[860px]">
        {agent.queued > 0 && (
          <div className="mb-1.5 text-center text-[12px] text-muted">
            {agent.queued} message{agent.queued > 1 ? 's' : ''} queued · will send when {agent.name} is free
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-lg bg-elev py-1 pr-1 pl-2.5 text-[12px]">
                {basename(p)}
                <button
                  type="button"
                  aria-label={`Remove ${basename(p)}`}
                  className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
                  onClick={() => setAttachments(attachments.filter((a) => a !== p))}
                >
                  <XIcon size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Attach a file"
            title="Attach a file"
            onClick={() => void attach()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elev text-muted transition hover:text-fg"
          >
            <PlusIcon size={17} />
          </button>
          <div className="flex min-h-[36px] flex-1 items-end rounded-[18px] border border-line bg-bg pr-1 focus-within:border-accent/60">
            <textarea
              ref={box}
              rows={1}
              value={text}
              onChange={(e) => update(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${agent.name}`}
              className="max-h-[200px] flex-1 resize-none bg-transparent px-3.5 py-[7px] text-[14px] leading-[20px] text-fg outline-none placeholder:text-muted"
            />
            {running && (
              <button
                type="button"
                onClick={() => void api.stop(agent.id)}
                aria-label="Stop"
                title="Stop"
                className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-elev-2 text-fg transition hover:bg-danger hover:text-white"
              >
                <StopIcon size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
              title="Send (Enter)"
              className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white transition disabled:bg-elev-2 disabled:text-muted"
            >
              <ArrowUpIcon size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
