import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import type { ChatMessage } from '@shared/types'
import { basename, clockTime, separatorTime } from '../lib/format'
import { ActionCard } from './ActionCard'
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

function Message({ msg }: { msg: ChatMessage }) {
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
  return (
    <div className="flex flex-col items-start" title={clockTime(msg.createdAt)}>
      {msg.tools && msg.tools.length > 0 && <ToolLines tools={msg.tools} />}
      {waiting ? (
        <Typing />
      ) : (
        msg.text && (
          <div className="selectable max-w-[75%] rounded-2xl rounded-bl-md bg-agent px-3.5 py-2 text-[14px]">
            <Markdown text={msg.text} />
          </div>
        )
      )}
      {msg.actions?.map((a) => <ActionCard key={a.id} messageId={msg.id} action={a} />)}
    </div>
  )
}

export function MessageList({ messages, agentId }: { messages: ChatMessage[]; agentId: string }) {
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
  }, [messages])

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
          return (
            <Fragment key={msg.id}>
              {showTime && (
                <div className="mt-4 mb-1 text-center text-[11px] font-medium text-muted">{separatorTime(msg.createdAt)}</div>
              )}
              <Message msg={msg} />
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
