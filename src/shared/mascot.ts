// Agent avatars: an emoji on a flat shape in a pale tint of the agent's colour, drawn as SVG.
// The shape, colour and emoji can each be picked; otherwise they follow the agent's name, so
// an agent always looks the same. The emoji comes from words in the name ("Email" → 📬)
// or, failing that, from a seeded set.

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

// ---- emoji ----

/** Words in an agent's name and the emoji they suggest, first match wins. */
const EMOJI_WORDS: [RegExp, string][] = [
  [/e-?mail|inbox|mail/, '📬'],
  [/morning|brief|daily/, '☀️'],
  [/travel|trip|holiday|flight/, '✈️'],
  [/plan|schedul|calendar|organi[sz]/, '🗓️'],
  [/research|study|learn|tutor|read/, '📚'],
  [/doctor|health|medic|nurse|gp\b/, '🩺'],
  [/sleep|dream|night/, '😴'],
  [/coach|fitness|gym|train|workout/, '💪'],
  [/skeptic|critic|devil/, '🤨'],
  [/recruit|job|career|hire|hunt/, '💼'],
  [/audit|review|inspect/, '🔍'],
  [/engineer|dev|code|build|tech/, '🛠️'],
  [/evidence|fact|science|check/, '🔬'],
  [/talk|mentor|honest|straight/, '🎯'],
  [/budget|money|financ|spend|bank/, '💰'],
  [/cook|chef|recipe|food|meal/, '🍳'],
  [/news|press/, '📰'],
  [/writ|editor|blog/, '✍️'],
  [/shop|buy|deal/, '🛍️'],
  [/music|song/, '🎵'],
  [/home|house/, '🏡'],
  [/garden|plant/, '🪴']
]
const EMOJI_FALLBACK = ['✨', '🌱', '🧠', '🧩', '🔮', '🎈', '🌟', '🦉', '🐺', '🦊', '🐝', '🍀']
/** Emoji suggested in the agent form. */
export const EMOJI_CHOICES = ['🎯', '📬', '🗓️', '📚', '🩺', '😴', '💪', '🤨', '💼', '🔍', '🛠️', '💰', '✈️', '🍳', '☀️', '🧠', '🐺', '🦊']

export function seededEmoji(seed: string): string {
  const name = seed.toLowerCase()
  const hit = EMOJI_WORDS.find(([re]) => re.test(name))
  if (hit) return hit[1]
  const r = rng(hash(seed) ^ 0x51ed270b)
  return pick(EMOJI_FALLBACK, r())
}

/** One emoji (or other single character) from user input, or null when there's none. */
export function cleanEmoji(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v.trim())][0]?.segment ?? ''
  return first && first.length <= 16 && !/[<>&"]/.test(first) ? first : null
}

/** The colour mixed with white: the shape behind the emoji. */
export function tint(color: string, amount = 0.75): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return color
  const mix = (i: number): string =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(2)}${mix(4)}`
}

// ---- shapes ----

interface Body {
  svg: string
  /** Where the emoji sits, and its size relative to the circle's. */
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

function body(shape: MascotShape, color: string, r: () => number): Body {
  const fill = `fill="${color}"`
  // Rounded polygons: fill plus a thick round-joined stroke in the same colour.
  const rounded = (d: string, w: number): string =>
    `<path d="${d}" ${fill} stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`
  switch (shape) {
    case 'circle':
      return { svg: `<circle cx="50" cy="52" r="40" ${fill}/>`, fx: 50, fy: 52, scale: 1 }
    case 'square':
      return { svg: `<rect x="12" y="14" width="76" height="76" rx="24" ${fill}/>`, fx: 50, fy: 52, scale: 1 }
    case 'pill':
      return { svg: `<rect x="6" y="27" width="88" height="50" rx="25" ${fill}/>`, fx: 50, fy: 52, scale: 0.86 }
    case 'triangle':
      return { svg: rounded('M50 20 L86 80 L14 80 Z', 16), fx: 50, fy: 61, scale: 0.76 }
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = ((-90 + i * 60) * Math.PI) / 180
        return `${f(50 + Math.cos(a) * 36)} ${f(53 + Math.sin(a) * 36)}`
      })
      return { svg: rounded(`M${pts.join(' L')} Z`, 12), fx: 50, fy: 53, scale: 0.92 }
    }
    case 'cloud':
      return {
        svg: `<g ${fill}><circle cx="31" cy="60" r="21"/><circle cx="53" cy="45" r="26"/><circle cx="73" cy="60" r="19"/><rect x="20" y="58" width="62" height="23" rx="11"/></g>`,
        fx: 51,
        fy: 60,
        scale: 0.86
      }
    case 'blob':
      return { svg: `<path d="${blobPath(r)}" ${fill}/>`, fx: 50, fy: 53, scale: 0.95 }
  }
}

/** Returns the SVG markup for an avatar. `shape`/`color`/`emoji` override the ones from the name. */
export function mascotSvg(seed: string, opts: { shape?: MascotShape | null; color?: string | null; emoji?: string | null } = {}): string {
  const r = rng(hash(seed) ^ 0x9e3779b9)
  const shape = opts.shape ?? seededShape(seed)
  const color = opts.color ?? seededColor(seed)
  const emoji = cleanEmoji(opts.emoji) ?? seededEmoji(seed)
  const b = body(shape, tint(color), r)
  const size = 50 * b.scale
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${b.svg}` +
    `<text x="${f(b.fx)}" y="${f(b.fy + 1)}" font-size="${f(size)}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${emoji}</text></svg>`
  )
}

export function mascotDataUrl(seed: string, opts: { shape?: MascotShape | null; color?: string | null; emoji?: string | null } = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg(seed, opts))}`
}
