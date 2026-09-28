// Discord-style mascot avatars: a coloured shape with a minimal face, drawn as
// SVG and fully determined by a seed (the agent's name), so an agent always
// looks the same.

export const MASCOT_SHAPES = ['blob', 'circle', 'square', 'hexagon', 'triangle', 'pill', 'cloud'] as const
export type MascotShape = (typeof MASCOT_SHAPES)[number]

export const MASCOT_COLORS = [
  '#F5A524', // amber
  '#A06CFF', // violet
  '#FF4D94', // pink
  '#22C55E', // green
  '#5E8BFF', // blue
  '#2EC5FF', // sky
  '#FF6B4A', // coral
  '#14B8A6' // teal
]

type Eyes = 'dot' | 'oval' | 'happy' | 'wide'

/** 32-bit FNV-1a hash of the seed. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (const ch of seed.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length] as T

export function seededShape(seed: string): MascotShape {
  return pick(MASCOT_SHAPES, rng(hash(seed))())
}

export function seededColor(seed: string): string {
  const r = rng(hash(seed))
  r()
  return pick(MASCOT_COLORS, r())
}

// ---- colour helpers ----

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1] as string, 16) : 0x5e8bff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(hex: string, target: number, amount: number): string {
  const [r, g, b] = parseHex(hex).map((c) => Math.round(c + (target - c) * amount)) as [number, number, number]
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ---- shapes ----

interface Body {
  svg: string
  /** Face centre and scale. */
  fx: number
  fy: number
  scale: number
}

const f = (n: number): string => n.toFixed(1)

/** A smooth organic blob through 8 seeded points (Catmull-Rom → Bézier). */
function blobPath(r: () => number): string {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2
    const radius = 36 + r() * 8
    return [50 + Math.cos(angle) * radius, 53 + Math.sin(angle) * radius] as const
  })
  const at = (i: number) => pts[(i + pts.length) % pts.length] as readonly [number, number]
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`
  for (let i = 0; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0] as number)} ${f(c1[1] as number)} ${f(c2[0] as number)} ${f(c2[1] as number)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d} Z`
}

function body(shape: MascotShape, r: () => number): Body {
  const fill = 'fill="url(#g)"'
  // Rounded polygons: fill plus a thick round-joined stroke in the same paint.
  const rounded = (d: string, w: number): string =>
    `<path d="${d}" ${fill} stroke="url(#g)" stroke-width="${w}" stroke-linejoin="round"/>`
  switch (shape) {
    case 'circle':
      return { svg: `<circle cx="50" cy="52" r="40" ${fill}/>`, fx: 50, fy: 52, scale: 1 }
    case 'square':
      return { svg: `<rect x="12" y="14" width="76" height="76" rx="24" ${fill}/>`, fx: 50, fy: 53, scale: 1 }
    case 'pill':
      return { svg: `<rect x="6" y="27" width="88" height="50" rx="25" ${fill}/>`, fx: 50, fy: 52, scale: 0.95 }
    case 'triangle':
      return { svg: rounded('M50 20 L86 80 L14 80 Z', 16), fx: 50, fy: 62, scale: 0.85 }
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = ((-90 + i * 60) * Math.PI) / 180
        return `${f(50 + Math.cos(a) * 36)} ${f(53 + Math.sin(a) * 36)}`
      })
      return { svg: rounded(`M${pts.join(' L')} Z`, 12), fx: 50, fy: 54, scale: 0.95 }
    }
    case 'cloud':
      return {
        svg: `<g ${fill}><circle cx="31" cy="60" r="21"/><circle cx="53" cy="45" r="26"/><circle cx="73" cy="60" r="19"/><rect x="20" y="58" width="62" height="23" rx="11"/></g>`,
        fx: 51,
        fy: 58,
        scale: 0.9
      }
    case 'blob':
      return { svg: `<path d="${blobPath(r)}" ${fill}/>`, fx: 50, fy: 53, scale: 1 }
  }
}

function face(eyes: Eyes, x: number, y: number, s: number, ink: string, blush: boolean, smile: boolean): string {
  const gap = 12.5 * s
  const out: string[] = []
  for (const dx of [-gap, gap]) {
    const cx = x + dx
    switch (eyes) {
      case 'dot':
        out.push(`<circle cx="${f(cx)}" cy="${f(y)}" r="${f(5.2 * s)}" fill="${ink}"/>`)
        break
      case 'oval':
        out.push(`<ellipse cx="${f(cx)}" cy="${f(y)}" rx="${f(4.2 * s)}" ry="${f(6.8 * s)}" fill="${ink}"/>`)
        break
      case 'happy':
        out.push(
          `<path d="M${f(cx - 5 * s)} ${f(y + 2 * s)} Q${f(cx)} ${f(y - 5 * s)} ${f(cx + 5 * s)} ${f(y + 2 * s)}" fill="none" stroke="${ink}" stroke-width="${f(3.4 * s)}" stroke-linecap="round"/>`
        )
        break
      case 'wide':
        out.push(`<circle cx="${f(cx)}" cy="${f(y)}" r="${f(7 * s)}" fill="#fff"/>`)
        out.push(`<circle cx="${f(cx + 1.2 * s)}" cy="${f(y + 1 * s)}" r="${f(3.6 * s)}" fill="#1D2250"/>`)
        break
    }
  }
  if (blush) {
    for (const dx of [-gap - 5 * s, gap + 5 * s]) {
      out.push(`<ellipse cx="${f(x + dx)}" cy="${f(y + 9 * s)}" rx="${f(4.5 * s)}" ry="${f(2.6 * s)}" fill="#FF7AA8" opacity="0.45"/>`)
    }
  }
  if (smile) {
    out.push(
      `<path d="M${f(x - 5 * s)} ${f(y + 10 * s)} Q${f(x)} ${f(y + 14.5 * s)} ${f(x + 5 * s)} ${f(y + 10 * s)}" fill="none" stroke="${ink}" stroke-width="${f(2.8 * s)}" stroke-linecap="round"/>`
    )
  }
  return out.join('')
}

/** Returns the SVG markup for a mascot. `shape`/`color` override the seeded ones. */
export function mascotSvg(seed: string, opts: { shape?: MascotShape | null; color?: string | null } = {}): string {
  const r = rng(hash(seed) ^ 0x9e3779b9)
  const shape = opts.shape ?? seededShape(seed)
  const color = opts.color ?? seededColor(seed)
  const eyes = pick<Eyes>(['dot', 'oval', 'dot', 'happy', 'wide'], r())
  const blush = r() < 0.35
  const smile = eyes !== 'wide' && r() < 0.3
  const b = body(shape, r)
  const light = luminance(color) > 0.6
  const ink = light ? '#1D2250' : '#FFFFFF'
  // Depth: a soft top-left highlight and darkening towards the rim, drawn
  // through a mask of the body so overlapping parts (cloud) don't show seams.
  const layer = (paint: string): string => `<rect width="100" height="100" fill="url(#${paint})" mask="url(#body)"/>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>` +
    `<linearGradient id="g" x1="0" y1="12" x2="0" y2="92" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${mix(color, 255, 0.28)}"/><stop offset="1" stop-color="${mix(color, 0, 0.16)}"/>` +
    `</linearGradient>` +
    `<radialGradient id="hl" cx="36" cy="28" r="42" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="rim" cx="46" cy="44" r="52" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/>` +
    `</radialGradient>` +
    `<mask id="body">${b.svg.replaceAll('url(#g)', '#fff')}</mask>` +
    `</defs>` +
    b.svg +
    layer('rim') +
    layer('hl') +
    face(eyes, b.fx, b.fy, b.scale, ink, blush, smile) +
    `</svg>`
  )
}

export function mascotDataUrl(seed: string, opts: { shape?: MascotShape | null; color?: string | null } = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg(seed, opts))}`
}
