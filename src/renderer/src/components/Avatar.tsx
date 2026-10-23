import { useMemo, type CSSProperties } from 'react'
import { mascotDataUrl, seededColor, type Animal } from '@shared/mascot'

/**
 * An agent's avatar: their uploaded picture if they have one, otherwise their animal in
 * their colour (each picked in the agent's settings, or derived from the name).
 */
export function Avatar({
  seed,
  color,
  animal,
  picture,
  size = 44,
  running = false
}: {
  seed: string
  color?: string | null
  animal?: Animal | null
  picture?: string | null
  size?: number
  running?: boolean
}) {
  const mascot = useMemo(() => mascotDataUrl(seed || 'agent', { animal, color }), [seed, animal, color])
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
