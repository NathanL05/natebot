import type { CSSProperties } from 'react'

export function Avatar({
  icon,
  color,
  size = 44,
  running = false
}: {
  icon: string
  color: string
  size?: number
  running?: boolean
}) {
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.48,
    background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 70%, black))`,
    '--ring': color
  } as CSSProperties
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full leading-none ${running ? 'pulse' : ''}`}
      style={style}
    >
      <span aria-hidden="true">{icon || '🤖'}</span>
    </div>
  )
}
