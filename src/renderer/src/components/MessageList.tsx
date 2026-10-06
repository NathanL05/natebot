import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { promptLabel, type AgentSummary, type ChatMessage } from '@shared/types'
import { agentPicture } from '../lib/avatars'
import { basename, clockTime, separatorTime } from '../lib/format'
import { ActionCard } from './ActionCard'
import { Avatar } from './Avatar'
import { HandoffCard } from './HandoffCard'
import { ReminderCard } from './ReminderCard'
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, NoteIcon, PaperclipIcon, PinIcon, ReplyIcon, SpeakerIcon } from './icons'
import { Markdown } from './Markdown'
import { api, useStore } from '../lib/store'
import { speak, stopSpeaking } from '../lib/voice'
import { ToolLines } from './ToolLines'

const GAP = 30 * 60_000

function Typing() {
  return (
    <div className="typing inline-flex gap-1 rounded-2xl rounded-bl-md bg-agent px-4 py-3" aria-label="Agent is typing">
      <span className="h-2 w-2 rounded-full bg-muted" />
      <span className="h-2 w-2 rounded-full bg-muted" />
      <span className="h-2 w-2 rounded-full bg-muted" />
    </div>
  )
}

/** Your message text with group members' @mentions in bold. */
function withMentions(text: string, names: string[]): ReactNode {
  if (!names.length) return text
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))(?![\\w-])`, 'gi'))
  return parts.map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part))
}

/** Group chats: an agent's avatar and name beside the first of their consecutive messages. */
function Speaker({ agent, showName, children }: { agent: AgentSummary | undefined; showName: boolean; children: ReactNode }) {
  const name = agent?.name ?? 'Former member'
  return (
    <div className={`flex items-start gap-2.5 ${showName ? 'mt-2' : ''}`}>
      <div className="w-8 shrink-0">
        {showName && (
          <Avatar seed={name} shape={agent?.shape} color={agent?.color} picture={agent ? agentPicture(agent.id, agent.avatarVersion) : null} size={32} />
        )}
      </div>
      <div className="flex max-w-[75%] min-w-0 flex-col items-start">
        {showName && (
          <div className="mb-1 ml-1 text-[12px] font-semibold" style={{ color: agent?.color }}>
            {name}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** Copy, Listen, Save, Notes and Pin, shown under an agent reply on hover (Pin stays visible once pinned). */
function MessageTools({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [note, setNote] = useState('')
  const appleOn = useStore((s) => s.mcpServers.some((m) => m.name === 'apple' && m.configured))
  const title = (msg.text.split('\n').find((l) => l.trim()) ?? 'Reply').replace(/[*_`#>]/g, '').trim().slice(0, 60)

  const listen = (): void => {
    if (speaking) return stopSpeaking()
    const { voice = null, voiceRate = 1 } = useStore.getState().settings ?? {}
    setSpeaking(true)
    void speak(msg.text, { voice, rate: voiceRate, onEnd: () => setSpeaking(false) })
  }
  const flash = (text: string): void => {
    setNote(text)
    setTimeout(() => setNote(''), 1800)
  }
  const btn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition hover:bg-hover hover:text-fg'
  return (
    <div className={`mt-0.5 ml-1 flex gap-0.5 transition-opacity ${msg.pinned ? '' : 'opacity-0 group-hover:opacity-100'}`}>
      <button type="button" className={btn} onClick={() => useStore.getState().setReplying(msg.agentId, msg)}>
        <ReplyIcon size={11} /> Reply
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => {
          void navigator.clipboard.writeText(msg.text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />} {copied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" className={`${btn} ${speaking ? 'text-accent' : ''}`} onClick={listen}>
        <SpeakerIcon size={11} /> {speaking ? 'Stop' : 'Listen'}
      </button>
      <button type="button" className={btn} onClick={() => void api.saveText(title, msg.text).then((r) => r.ok && flash('Saved'))}>
        <DownloadIcon size={11} /> Save…
      </button>
      {appleOn && (
        <button type="button" className={btn} onClick={() => void api.saveToNotes(title, msg.text).then((r) => flash(r.ok ? 'Added to Notes' : (r.error ?? 'Not saved')))}>
          <NoteIcon size={11} /> Notes
        </button>
      )}
      <button type="button" className={`${btn} ${msg.pinned ? 'text-accent' : ''}`} onClick={() => void api.setPinned(msg.id, !msg.pinned)}>
        <PinIcon size={11} /> {msg.pinned ? 'Pinned' : 'Pin'}
      </button>
      {note && <span className="px-1.5 py-0.5 text-[11px] text-muted">{note}</span>}
    </div>
  )
}

function Message({
  msg,
  speaker,
  showName = false,
  spaced = false,
  memberNames = []
}: {
  msg: ChatMessage
  speaker?: AgentSummary
  /** Group chats: names to highlight when @mentioned. */
  memberNames?: string[]
  showName?: boolean
  /** Extra space above: matches the gap above a speaker's name in group chats. */
  spaced?: boolean
}) {
  if (msg.role === 'system') {
    return <div className="selectable my-2 text-center text-[12px] text-muted">{msg.text}</div>
  }

  if (msg.role === 'error') {
    return (
      <div className="my-2 flex justify-center">
        <div className="selectable flex max-w-[560px] items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger">
          <AlertIcon size={15} className="mt-0.5 shrink-0" />
          <span>{msg.text}</span>
        </div>
      </div>
    )
  }

  if (msg.role === 'user') {
    const shown = promptLabel(msg.text)
    return (
      <div className={`flex flex-col items-end ${spaced ? 'mt-2' : ''}`} title={clockTime(msg.createdAt)}>
        {msg.attachments?.map((a) => (
          <div key={a} className="mb-1 inline-flex items-center gap-1.5 rounded-lg bg-elev px-2.5 py-1 text-[12px] text-muted">
            <PaperclipIcon size={12} /> {basename(a)}
          </div>
        ))}
        {msg.replyTo && (
          <button
            type="button"
            onClick={() => useStore.getState().openMessage(msg.agentId, msg.replyTo!.id)}
            className="mb-1 max-w-[60%] truncate rounded-lg border-l-2 border-accent/60 bg-elev px-2.5 py-1 text-left text-[12px] text-muted hover:text-fg"
            title="Show the message this replies to"
          >
            <span className="font-medium">{msg.replyTo.who}:</span> {msg.replyTo.excerpt}
          </button>
        )}
        {shown.attached.map((label) => (
          <div key={label} className="mb-1 inline-flex items-center gap-1.5 rounded-lg bg-elev px-2.5 py-1 text-[12px] text-muted" title="Filled in by NateBot when sent">
            + {label}
          </div>
        ))}
        {shown.text && (
          <div className="selectable max-w-[70%] rounded-2xl rounded-br-md bg-me px-3.5 py-2 text-[14px] whitespace-pre-wrap text-me-fg">
            {withMentions(shown.text, memberNames)}
          </div>
        )}
      </div>
    )
  }

  // Agent message
  const waiting = msg.streaming && !msg.text
  const body = (
    <div className="group flex flex-col items-start" title={clockTime(msg.createdAt)}>
      {msg.tools && msg.tools.length > 0 && <ToolLines tools={msg.tools} />}
      {waiting ? (
        <Typing />
      ) : (
        msg.text && (
          <div className={`selectable rounded-2xl bg-agent px-3.5 py-2 text-[14px] ${msg.speakerId ? 'rounded-tl-md' : 'max-w-[75%] rounded-bl-md'}`}>
            <Markdown text={msg.text} />
          </div>
        )
      )}
      {msg.text && !msg.streaming && <MessageTools msg={msg} />}
      {msg.actions?.map((a) => <ActionCard key={a.id} messageId={msg.id} agentId={msg.agentId} action={a} />)}
      {msg.handoffs?.map((h) => <HandoffCard key={h.id} messageId={msg.id} handoff={h} />)}
      {msg.reminders?.map((r) => <ReminderCard key={r.id} reminder={r} />)}
    </div>
  )
  if (!msg.speakerId) return body
  return (
    <Speaker agent={speaker} showName={showName}>
      {body}
    </Speaker>
  )
}

export function MessageList({
  messages,
  agentId,
  speakers,
  typing
}: {
  messages: ChatMessage[]
  /** The open chat: an agent or a group chat. */
  agentId: string
  /** Group chats: members by id, for names and avatars. */
  speakers?: Record<string, AgentSummary>
  /** Group chats: a member who is about to reply. */
  typing?: AgentSummary
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const more = useStore((s) => !!s.moreHistory[agentId])
  const [loadingOlder, setLoadingOlder] = useState(false)
  /** First message and scroll height before the last render, to keep the view still when older ones are added above. */
  const top = useRef<{ id: string | undefined; height: number }>({ id: undefined, height: 0 })

  // Jump to the bottom when switching chats.
  useLayoutEffect(() => {
    pinned.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agentId])

  // Older messages added above: keep what you were looking at in place.
  useLayoutEffect(() => {
    const el = scroller.current
    const firstId = messages[0]?.id
    if (el && top.current.id && firstId !== top.current.id && messages.some((m) => m.id === top.current.id)) {
      el.scrollTop += el.scrollHeight - top.current.height
    }
    top.current = { id: firstId, height: el?.scrollHeight ?? 0 }
  }, [messages])

  const loadOlder = (): void => {
    setLoadingOlder(true)
    void useStore.getState().loadOlder(agentId).finally(() => setLoadingOlder(false))
  }

  // Follow new content only if the user hasn't scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  // Jump to a message opened from search, once it has loaded, and flash it.
  const focusId = useStore((s) => s.focusMessageId)
  useEffect(() => {
    if (!focusId) return
    const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(focusId)}"]`)
    if (!el) return
    pinned.current = false
    el.scrollIntoView({ block: 'center' })
    el.classList.add('nb-flash')
    const t = setTimeout(() => el.classList.remove('nb-flash'), 1800)
    useStore.setState({ focusMessageId: null })
    return () => clearTimeout(t)
  }, [focusId, messages])

  const memberNames = useMemo(() => Object.values(speakers ?? {}).map((a) => a.name), [speakers])

  const onScroll = (): void => {
    const el = scroller.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 pt-2 pb-4 [overflow-anchor:none]">
      <div className="mx-auto flex max-w-[860px] flex-col gap-1.5">
        {more && (
          <button
            type="button"
            disabled={loadingOlder}
            onClick={loadOlder}
            className="mx-auto mt-2 rounded-full border border-line-strong px-3 py-1 text-[12px] text-muted transition hover:text-fg disabled:opacity-60"
          >
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        )}
        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const showTime = !prev || msg.createdAt - prev.createdAt > GAP
          const showName = !!msg.speakerId && (showTime || prev?.speakerId !== msg.speakerId)
          // In group chats, your message gets the same space above it as the next speaker gets below it.
          const spaced = !!speakers && msg.role === 'user' && !!prev && prev.role !== 'user' && !showTime
          return (
            <Fragment key={msg.id}>
              {showTime && (
                <div className="mt-4 mb-1 text-center text-[11px] font-medium text-muted">{separatorTime(msg.createdAt)}</div>
              )}
              <div data-mid={msg.id} className="rounded-2xl transition-colors duration-700">
                <Message msg={msg} speaker={msg.speakerId ? speakers?.[msg.speakerId] : undefined} showName={showName} spaced={spaced} memberNames={memberNames} />
              </div>
            </Fragment>
          )
        })}
        {typing && (
          <Speaker agent={typing} showName={messages.at(-1)?.speakerId !== typing.id}>
            <Typing />
          </Speaker>
        )}
      </div>
    </div>
  )
}
