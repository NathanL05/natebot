import { useMemo, type CSSProperties } from 'react'
import { mascotDataUrl, seededColor, type MascotShape } from '@shared/mascot'

/**
 * An agent's avatar: their uploaded picture if they have one, otherwise the
 * mascot generated from their name.
 */
export function Avatar({
  seed,
  color,
  shape,
  picture,
  size = 44,
  running = false
}: {
  seed: string
  color?: string | null
  shape?: MascotShape | null
  picture?: string | null
  size?: number
  running?: boolean
}) {
  const mascot = useMemo(() => mascotDataUrl(seed || 'agent', { shape, color }), [seed, shape, color])
  const ring = color ?? seededColor(seed)
  const style = { width: size, height: size, '--ring': ring } as CSSProperties
  return (
    <div className={`relative shrink-0 rounded-full ${running ? 'pulse' : ''}`} style={style}>
      <img
        src={picture ?? mascot}
        alt=""
        draggable={false}
        className={`h-full w-full ${picture ? 'rounded-full object-cover shadow-[0_2px_5px_rgb(0_0_0/0.22)]' : 'drop-shadow-[0_2px_2.5px_rgb(0_0_0/0.28)]'}`}
      />
    </div>
  )
}
