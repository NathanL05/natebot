// Today's "Since you were last here": what your agents wrote while you were away, and what
// else is waiting. NateBot builds it from what it already stores, so it never runs Claude.
import { useEffect, useState } from 'react'
import type { AgentSummary, VisitSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { duration, listTime, separatorTime } from '../lib/format'
import { Avatar } from './Avatar'
import { GroupAvatar } from './GroupAvatar'

const HOUR = 3_600_000
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export function VisitCard() {
  const agents = useStore((s) => s.agents)
  const rooms = useStore((s) => s.rooms)
  const [visit, setVisit] = useState<VisitSummary | null>(null)

  useEffect(() => {
    void api.sinceLastVisit().then(setVisit)
    return api.on('visit', setVisit)
  }, [])

  if (!visit) return null

  const byId = Object.fromEntries(agents.map((a) => [a.id, a]))
  const closedFor = visit.closedAt !== null && visit.startedAt !== null ? visit.startedAt - visit.closedAt : 0
  const waiting = [
    visit.approvals > 0 && plural(visit.approvals, 'action waiting for your OK', 'actions waiting for your OK'),
    visit.due > 0 && plural(visit.due, 'commitment due', 'commitments due'),
    visit.radar > 0 && plural(visit.radar, 'new role on the radar', 'new roles on the radar')
  ].filter(Boolean)
  const empty = visit.chats.length === 0 && waiting.length === 0

  const avatar = (chatId: string) => {
    const room = rooms.find((r) => r.id === chatId)
    if (room) return <GroupAvatar members={room.memberIds.map((id) => byId[id]).filter((a): a is AgentSummary => !!a)} size={28} backdrop="var(--elev)" />
    const a = byId[chatId]
    return <Avatar seed={a?.name ?? '?'} shape={a?.shape} color={a?.color} emoji={a?.emoji} picture={a ? agentPicture(a.id, a.avatarVersion) : null} size={28} />
  }
  const name = (chatId: string): string => rooms.find((r) => r.id === chatId)?.name ?? byId[chatId]?.name ?? 'Chat'

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[14px] font-semibold">Since you were last here</h2>
        <span className="text-[12px] text-muted">{separatorTime(visit.since)}</span>
        <button type="button" onClick={() => void api.dismissVisit()} className="ml-auto text-[12px] text-muted hover:text-fg">
          Got it
        </button>
      </div>
      {closedFor >= HOUR && (
        <p className="mb-2 text-[12px] text-muted">
          NateBot was closed for {duration(closedFor)}, so routines, reminders and watches didn't run then. Closing the window instead keeps them going.
        </p>
      )}
      {empty ? (
        <div className="rounded-2xl border border-dashed border-line p-4 text-center text-[13px] text-muted">Nothing new.</div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">
          {visit.chats.map((c) => (
            <button
              key={c.chatId}
              type="button"
              onClick={() => useStore.getState().openMessage(c.chatId, c.messageId)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-elev"
            >
              {avatar(c.chatId)}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-semibold">{name(c.chatId)}</span>
                  {c.count > 1 && <span className="shrink-0 text-[11px] text-muted">{c.count} new</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{listTime(c.at)}</span>
                </div>
                <div className="truncate text-[12px] text-muted">{c.text}</div>
              </div>
            </button>
          ))}
          {waiting.length > 0 && <div className="px-4 py-2.5 text-[12px]">{waiting.join(' · ')}, below.</div>}
        </div>
      )}
    </section>
  )
}
