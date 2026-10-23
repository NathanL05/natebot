import { useMemo, type CSSProperties } from 'react'
import { mascotDataUrl, seededColor, type MascotShape } from '@shared/mascot'

/**
 * An agent's avatar: their uploaded picture if they have one, otherwise their emoji on
 * their shape (each picked in the agent's settings, or derived from the name).
 */
export function Avatar({
  seed,
  color,
  shape,
  emoji,
  picture,
  size = 44,
  running = false
}: {
  seed: string
  color?: string | null
  shape?: MascotShape | null
  emoji?: string | null
  picture?: string | null
  size?: number
  running?: boolean
}) {
  const mascot = useMemo(() => mascotDataUrl(seed || 'agent', { shape, color, emoji }), [seed, shape, color, emoji])
  const ring = color ?? seededColor(seed)
  const style = { width: size, height: size, '--ring': ring } as CSSProperties
  return (
    <div className={`relative shrink-0 rounded-full ${running ? 'pulse' : ''}`} style={style}>
      <img
        src={picture ?? mascot}
        alt=""
        draggable={false}
        className={`h-full w-full ${picture ? 'rounded-full object-cover' : ''}`}
      />
    </div>
  )
}
