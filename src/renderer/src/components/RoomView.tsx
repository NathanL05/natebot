import { useMemo } from 'react'
import type { AgentSummary, RoomSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { UsageBanner } from './ChatView'
import { Composer } from './Composer'
import { GroupAvatar } from './GroupAvatar'
import { SlidersIcon } from './icons'
import { MessageList } from './MessageList'
import { IconButton } from './ui'

const STARTERS = [
  'Introduce yourselves: what can each of you do for me?',
  "What should I focus on this week? Talk it through and agree on a top 3.",
  'Pick a topic you disagree on and debate it.'
]

export function RoomView({ room }: { room: RoomSummary }) {
  const agents = useStore((s) => s.agents)
  const messages = useStore((s) => s.messages[room.id])
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents])
  const members = room.memberIds.map((id) => byId[id]).filter((a): a is AgentSummary => !!a)

  const speaking = room.speakingId ? byId[room.speakingId] : undefined
  const last = messages?.at(-1)
  // Show a typing row until the speaker's reply starts streaming in.
  const typing = speaking && !(last?.streaming && last.speakerId === speaking.id) ? speaking : undefined
  const running = room.status === 'running'

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 px-5">
        <GroupAvatar members={members} size={30} running={running} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-tight font-semibold">{room.name}</div>
          <div className={`truncate text-[12px] leading-tight ${speaking ? 'text-accent' : 'text-muted'}`}>
            {speaking ? `${speaking.name} is typing…` : members.map((m) => m.name).join(', ')}
          </div>
        </div>
        <IconButton label="Group chat settings" onClick={() => useStore.getState().setRoomEditor(room.id)}>
          <SlidersIcon size={17} />
        </IconButton>
      </header>

      <UsageBanner />

      {messages === undefined ? (
        <div className="flex-1" />
      ) : !messages.some((m) => m.role === 'user' || m.speakerId) && !running ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <GroupAvatar members={members} size={72} />
          <div className="text-[17px] font-semibold">{room.name}</div>
          <div className="max-w-[400px] text-[13px] text-muted">
            Ask anything and your agents will each weigh in, reply to each other and talk it through. @mention an agent to ask
            them directly.
          </div>
          <div className="mt-2 flex max-w-[520px] flex-wrap justify-center gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void api.sendMessage(room.id, s)}
                className="rounded-full border border-line-strong bg-elev px-3 py-1.5 text-[12px] text-fg transition hover:border-accent hover:bg-selected"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <MessageList messages={messages} agentId={room.id} speakers={byId} typing={typing} />
      )}

      <Composer key={room.id} chatId={room.id} name={room.name} running={running} mentionables={members} />
    </div>
  )
}
