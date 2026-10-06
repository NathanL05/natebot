import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { basename } from '../lib/format'
import { Avatar } from './Avatar'
import { ArrowUpIcon, PlusIcon, ReplyIcon, StopIcon, XIcon } from './icons'

// Unsent text survives switching between chats.
const drafts = new Map<string, string>()

/** The message box for an agent's chat or a group chat (chatId is either). */
export function Composer({
  chatId,
  name,
  running,
  queued = 0,
  mentionables = [],
  quickPrompts = []
}: {
  chatId: string
  name: string
  running: boolean
  queued?: number
  /** Group chats: members offered when typing @. */
  mentionables?: AgentSummary[]
  /** One-click messages, shown while the box is empty. */
  quickPrompts?: string[]
}) {
  const [text, setText] = useState(() => drafts.get(chatId) ?? '')
  const [attachments, setAttachments] = useState<string[]>([])
  /** The "@query" being typed before the caret, if any. */
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const replying = useStore((s) => s.replying[chatId])
  const replyWho = useStore((s) =>
    !replying ? '' : replying.role === 'user' ? 'yourself' : (s.agents.find((a) => a.id === (replying.speakerId ?? replying.agentId))?.name ?? name)
  )

  // Clicking Reply puts the caret here.
  useEffect(() => {
    if (replying) box.current?.focus()
  }, [replying])

  const q = mention?.query.toLowerCase() ?? ''
  const matches = mention
    ? mentionables
        .filter((a) => a.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    : []

  useEffect(() => {
    box.current?.focus()
  }, [chatId])

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  const update = (value: string): void => {
    setText(value)
    drafts.set(chatId, value)
  }

  /** Opens the @ picker while the caret sits right after "@something". */
  const trackMention = (value: string, caret: number): void => {
    if (!mentionables.length) return
    const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret))
    setMention(m ? { start: caret - (m[2]?.length ?? 0) - 1, query: m[2] ?? '', index: 0 } : null)
  }

  const pickMention = (agent: AgentSummary): void => {
    const el = box.current
    if (!mention || !el) return
    const caret = el.selectionStart
    const next = `${text.slice(0, mention.start)}@${agent.name} ${text.slice(caret)}`
    const at = mention.start + agent.name.length + 2
    update(next)
    setMention(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  const send = (): void => {
    const body = text.trim()
    if (!body && attachments.length === 0) return
    void api.sendMessage(chatId, body, attachments.length ? attachments : undefined, replying?.id)
    update('')
    setAttachments([])
    if (replying) useStore.getState().setReplying(chatId, null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mention && matches.length) {
      const move = (d: number): void => setMention({ ...mention, index: (mention.index + d + matches.length) % matches.length })
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        move(e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault()
        pickMention(matches[mention.index] ?? (matches[0] as AgentSummary))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && replying) {
      e.preventDefault()
      useStore.getState().setReplying(chatId, null)
    }
  }

  const attach = async (): Promise<void> => {
    const paths = await api.pickAttachments()
    setAttachments((current) => [...current, ...paths.filter((p) => !current.includes(p))])
    box.current?.focus()
  }

  const canSend = text.trim().length > 0 || attachments.length > 0

  return (
    <div className="px-6 pt-1 pb-4">
      <div className="mx-auto max-w-[860px]">
        {queued > 0 && (
          <div className="mb-1.5 text-center text-[12px] text-muted">
            {queued} message{queued > 1 ? 's' : ''} queued · will send when {name} is free
          </div>
        )}
        {replying && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-accent/60 bg-elev px-3 py-1.5 text-[12px]">
            <ReplyIcon size={12} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-muted">
              Replying to <span className="font-medium text-fg">{replyWho}</span>: {replying.text.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').slice(0, 160)}
            </span>
            <button
              type="button"
              aria-label="Cancel reply"
              title="Cancel reply (Esc)"
              className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
              onClick={() => useStore.getState().setReplying(chatId, null)}
            >
              <XIcon size={12} />
            </button>
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
        {quickPrompts.length > 0 && !text && attachments.length === 0 && !replying && (
          <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Quick prompts">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                title="Send this now"
                onClick={() => void api.sendMessage(chatId, p)}
                className="max-w-full truncate rounded-full border border-line-strong bg-elev/70 px-3 py-1 text-[12px] text-muted transition hover:border-accent/50 hover:text-fg"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {mention && matches.length > 0 && (
          <div className="relative">
            <div role="listbox" aria-label="Mention an agent" className="pop absolute bottom-2 left-0 w-64 rounded-xl border border-line-strong bg-elev p-1 shadow-2xl">
              {matches.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={i === mention.index}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(a)
                  }}
                  onMouseEnter={() => setMention({ ...mention, index: i })}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] ${i === mention.index ? 'bg-selected' : ''}`}
                >
                  <Avatar seed={a.name} shape={a.shape} color={a.color} picture={agentPicture(a.id, a.avatarVersion)} size={22} />
                  <span className="truncate font-medium">{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* One pill: + on the left, send on the right, the same 6px inset on every side. */}
        <div
          className="flex items-end gap-1.5 rounded-[23px] border border-line-strong bg-field p-1.5 transition focus-within:border-accent/50"
          style={{ boxShadow: 'var(--field-shadow)' }}
        >
          <button
            type="button"
            aria-label="Attach files"
            title="Attach files (PDFs, images, documents…)"
            onClick={() => void attach()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elev-2/70 text-muted transition hover:bg-elev-2 hover:text-fg"
          >
            <PlusIcon size={17} />
          </button>
          <textarea
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => {
              update(e.target.value)
              trackMention(e.target.value, e.target.selectionStart)
            }}
            onKeyDown={onKeyDown}
            onSelect={(e) => trackMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onBlur={() => setMention(null)}
            placeholder={mentionables.length ? `Message ${name} · @ to mention an agent` : `Message ${name}`}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-1.5 py-[6px] text-[14px] leading-[20px] text-fg outline-none placeholder:text-muted"
          />
          {running && (
            <button
              type="button"
              onClick={() => void api.stop(chatId)}
              aria-label="Stop"
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elev-2 text-fg transition hover:bg-danger hover:text-white"
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-me text-me-fg transition hover:opacity-85 disabled:opacity-30"
          >
            <ArrowUpIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
