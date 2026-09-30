import type { CSSProperties } from 'react'
import type { AgentSummary } from '@shared/types'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'

/** A group chat's avatar: its first two members' avatars, overlapped diagonally. */
export function GroupAvatar({
  members,
  size = 44,
  running = false,
  backdrop = 'var(--bg)'
}: {
  members: AgentSummary[]
  size?: number
  running?: boolean
  /** Colour behind the avatar: outlines the front member so flat shapes don't merge. */
  backdrop?: string
}) {
  const [a, b] = members
  const inner = Math.round(size * 0.66)
  const style = { width: size, height: size, '--ring': 'var(--accent-strong)' } as CSSProperties
  return (
    <div className={`relative shrink-0 rounded-full ${running ? 'pulse' : ''}`} style={style}>
      {a && (
        <div className="absolute top-0 left-0">
          <Avatar seed={a.name} shape={a.shape} color={a.color} picture={agentPicture(a.id, a.avatarVersion)} size={inner} />
        </div>
      )}
      {b && (
        <div
          className="absolute right-0 bottom-0"
          style={{
            filter: [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([x, y]) => `drop-shadow(${x}px ${y}px 0 ${backdrop})`).join(' ')
          }}
        >
          <Avatar seed={b.name} shape={b.shape} color={b.color} picture={agentPicture(b.id, b.avatarVersion)} size={inner} />
        </div>
      )}
      {members.length > 2 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-strong px-1 text-[10px] font-bold text-on-accent">
          {members.length}
        </span>
      )}
    </div>
  )
}
