import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { AgentSummary, ChatMessage } from '@shared/types'
import { agentPicture } from '../lib/avatars'
import { basename, clockTime, separatorTime } from '../lib/format'
import { ActionCard } from './ActionCard'
import { Avatar } from './Avatar'
import { AlertIcon, PaperclipIcon } from './icons'
import { Markdown } from './Markdown'
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

function Message({ msg, speaker, showName = false }: { msg: ChatMessage; speaker?: AgentSummary; showName?: boolean }) {
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
    return (
      <div className="flex flex-col items-end" title={clockTime(msg.createdAt)}>
        {msg.attachments?.map((a) => (
          <div key={a} className="mb-1 inline-flex items-center gap-1.5 rounded-lg bg-elev px-2.5 py-1 text-[12px] text-muted">
            <PaperclipIcon size={12} /> {basename(a)}
          </div>
        ))}
        {msg.text && (
          <div className="selectable max-w-[70%] rounded-2xl rounded-br-md bg-me px-3.5 py-2 text-[14px] whitespace-pre-wrap text-me-fg">
            {msg.text}
          </div>
        )}
      </div>
    )
  }

  // Agent message
  const waiting = msg.streaming && !msg.text
  const body = (
    <div className="flex flex-col items-start" title={clockTime(msg.createdAt)}>
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
      {msg.actions?.map((a) => <ActionCard key={a.id} messageId={msg.id} action={a} />)}
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

  // Jump to the bottom when switching chats.
  useLayoutEffect(() => {
    pinned.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agentId])

  // Follow new content only if the user hasn't scrolled up.
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  const onScroll = (): void => {
    const el = scroller.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-6 pt-2 pb-4">
      <div className="mx-auto flex max-w-[860px] flex-col gap-1.5">
        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const showTime = !prev || msg.createdAt - prev.createdAt > GAP
          const showName = !!msg.speakerId && (showTime || prev?.speakerId !== msg.speakerId)
          return (
            <Fragment key={msg.id}>
              {showTime && (
                <div className="mt-4 mb-1 text-center text-[11px] font-medium text-muted">{separatorTime(msg.createdAt)}</div>
              )}
              <Message msg={msg} speaker={msg.speakerId ? speakers?.[msg.speakerId] : undefined} showName={showName} />
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
