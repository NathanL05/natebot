// Agent avatars: a small faceted animal head in the agent's colour, in the same folded-paper
// style as the wolf app icon, drawn as SVG. The animal and colour can each be picked;
// otherwise they follow the agent's name, so an agent always looks the same.
//
// Each head is drawn on a 100×100 grid from facets on the left half, mirrored to the right,
// in four shades of the agent's colour plus white and ink.

/** Avatar shapes from before animals. Still read from agent files, no longer drawn. */
export const MASCOT_SHAPES = ['blob', 'circle', 'square', 'hexagon', 'triangle', 'pill', 'cloud'] as const
export type MascotShape = (typeof MASCOT_SHAPES)[number]

export const ANIMALS = [
  'wolf',
  'fox',
  'cat',
  'bear',
  'panda',
  'koala',
  'owl',
  'rabbit',
  'lion',
  'tiger',
  'deer',
  'penguin',
  'frog',
  'monkey',
  'raccoon',
  'mouse',
  'pig',
  'elephant',
  'dog'
] as const
export type Animal = (typeof ANIMALS)[number]

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

export function seededColor(seed: string): string {
  const r = rng(hash(seed))
  r()
  return pick(MASCOT_COLORS, r())
}

/** An animal named in the agent's name ("Night Owl"), or else one picked from it. */
export function seededAnimal(seed: string): Animal {
  const name = seed.toLowerCase()
  const named = ANIMALS.find((a) => new RegExp(`\\b${a}`).test(name))
  return named ?? pick(ANIMALS, rng(hash(seed) ^ 0x2545f491)())
}

export const isAnimal = (v: unknown): v is Animal => ANIMALS.includes(v as Animal)

// ---- colour ----

function rgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  return hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number] : null
}

const toHex = (c: number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** amount > 0 mixes toward white, < 0 toward black. */
export function shade(color: string, amount: number): string {
  const c = rgb(color)
  if (!c) return color
  return toHex(c.map((v) => (amount >= 0 ? v + (255 - v) * amount : v * (1 + amount))))
}

// ---- drawing ----

type Pt = [number, number]
interface Ink {
  base: string
  dark: string
  deep: string
  light: string
  pale: string
}
const WHITE = '#FFFFFF'
const INK = '#1B1630'

const f = (n: number): string => (Math.round(n * 10) / 10).toString()
const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [100 - x, y])
/** A facet, stroked in its own colour so neighbours meet without hairline gaps. */
const facet = (pts: Pt[], fill: string): string =>
  `<path d="M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z" fill="${fill}" stroke="${fill}" stroke-width="0.6" stroke-linejoin="round"/>`
/** Left-half facets and their mirror images. */
const both = (parts: [Pt[], string][]): string => parts.map(([p, c]) => facet(p, c) + facet(mirror(p), c)).join('')
const circle = (x: number, y: number, r: number, fill: string): string => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"/>`
const pair = (x: number, y: number, r: number, fill: string): string => circle(x, y, r, fill) + circle(100 - x, y, r, fill)
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string): string =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"/>`
const nose = (y: number, w = 3.5, h = 5): string => both([[[[50 - w, y], [50, y - 1], [50, y + h], [50 - w / 2, y + h - 0.5]], INK]])

/** A pointed-eared head: wolf, fox, cat, tiger and dog share it, with their own ears and colours. */
function pointed(k: Ink, o: { ear: Pt[]; inner: Pt[]; innerFill: string; ruff: string; muzzle: string; chin: string }): string {
  return both([
    [o.ear, k.dark],
    [o.inner, o.innerFill],
    [[[42, 32], [50, 29], [50, 52], [38, 48]], k.light],
    [[[23, 44], [42, 32], [38, 48]], k.base],
    [[[23, 44], [38, 48], [33, 64], [20, 57]], o.ruff],
    [[[33, 64], [38, 48], [44, 60]], k.dark],
    [[[44, 60], [50, 56], [50, 82], [44, 74]], o.muzzle],
    [[[33, 64], [44, 60], [44, 74]], o.chin]
  ])
}

const HEADS: Record<Animal, (k: Ink) => string> = {
  wolf: (k) =>
    pointed(k, { ear: [[27, 12], [23, 44], [42, 32]], inner: [[29, 20], [27, 40], [38, 33]], innerFill: k.deep, ruff: k.pale, muzzle: WHITE, chin: k.pale }) +
    nose(69),
  fox: (k) =>
    pointed(k, { ear: [[24, 16], [22, 44], [43, 31]], inner: [[27, 23], [26, 40], [38, 33]], innerFill: WHITE, ruff: WHITE, muzzle: WHITE, chin: '#F1ECE6' }) +
    nose(72, 3, 4),
  cat: (k) =>
    both([
      [[[25, 22], [24, 46], [42, 34]], k.dark],
      [[[28, 28], [27, 42], [38, 36]], k.pale],
      [[[42, 34], [50, 31], [50, 54], [36, 50]], k.light],
      [[[24, 46], [42, 34], [36, 50], [22, 60]], k.base],
      [[[22, 60], [36, 50], [44, 62], [36, 74]], k.dark],
      [[[44, 62], [50, 58], [50, 78], [36, 74]], k.pale]
    ]) +
    both([[[[47, 62], [50, 61.5], [50, 65], [48.5, 64.5]], '#FF8FB1']]) +
    `<path d="M40 66 L22 63 M40 69 L23 71 M60 66 L78 63 M60 69 L77 71" stroke="${WHITE}" stroke-opacity="0.8" stroke-width="1.4" stroke-linecap="round"/>`,
  tiger: (k) =>
    HEADS.cat(k) +
    both([
      [[[50, 33], [45, 35], [48, 41]], INK],
      [[[42, 38], [38, 40], [41, 44]], INK],
      [[[23, 52], [30, 53], [24, 56]], INK],
      [[[24, 60], [31, 60], [26, 63]], INK]
    ]),
  dog: (k) =>
    both([
      [[[42, 30], [50, 28], [50, 54], [36, 50]], k.light],
      [[[30, 34], [42, 30], [36, 50], [28, 56]], k.base],
      [[[28, 56], [36, 50], [44, 62], [36, 74]], k.dark],
      [[[44, 62], [50, 58], [50, 80], [38, 74]], k.pale],
      [[[30, 30], [16, 38], [14, 62], [22, 66], [30, 48]], k.deep]
    ]) + nose(64, 5, 5),
  bear: (k) =>
    pair(27, 27, 11, k.dark) +
    pair(27, 27, 5.5, k.pale) +
    both([
      [[[26, 34], [50, 28], [50, 56], [22, 52]], k.base],
      [[[22, 52], [50, 56], [50, 82], [31, 76]], k.dark],
      [[[40, 60], [50, 57], [50, 78], [41, 73]], k.pale]
    ]) +
    nose(61, 4, 5),
  panda: (k) =>
    pair(26, 26, 11, k.deep) +
    both([
      [[[25, 34], [50, 28], [50, 56], [21, 52]], WHITE],
      [[[21, 52], [50, 56], [50, 81], [31, 75]], '#ECEBF2']
    ]) +
    `<ellipse cx="36" cy="48" rx="6" ry="8.5" transform="rotate(-30 36 48)" fill="${k.base}"/><ellipse cx="64" cy="48" rx="6" ry="8.5" transform="rotate(30 64 48)" fill="${k.base}"/>` +
    nose(62, 4, 4.5),
  koala: (k) =>
    pair(21, 34, 15, k.dark) +
    pair(22, 35, 8, k.pale) +
    both([
      [[[30, 30], [50, 26], [50, 56], [26, 54]], k.light],
      [[[26, 54], [50, 56], [50, 80], [33, 74]], k.base]
    ]) +
    ellipse(50, 58, 7, 10, INK),
  owl: (k) =>
    both([
      [[[26, 18], [30, 38], [44, 28]], k.dark],
      [[[30, 38], [44, 28], [50, 27], [50, 84], [34, 76], [24, 58]], k.base],
      [[[36, 60], [50, 64], [50, 84], [40, 78]], k.pale]
    ]) +
    pair(38, 46, 9.5, k.pale) +
    pair(38, 46, 4, INK) +
    facet([[46.5, 54], [53.5, 54], [50, 61]], '#F5B524'),
  rabbit: (k) =>
    both([
      [[[33, 6], [27, 10], [30, 38], [40, 36], [39, 10]], k.dark],
      [[[32, 12], [31, 34], [37, 33], [36, 12]], k.pale],
      [[[30, 38], [50, 34], [50, 58], [26, 56]], k.base],
      [[[26, 56], [50, 58], [50, 82], [33, 76]], k.light]
    ]) +
    both([[[[47, 61], [50, 60.5], [50, 64], [48.5, 63.5]], '#FF8FB1']]) +
    `<path d="M50 64 V68" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`,
  lion: (k) =>
    both([
      [[[50, 10], [32, 16], [20, 30], [14, 50], [20, 70], [32, 84], [50, 90]], k.deep],
      [[[50, 10], [38, 14], [32, 26]], k.dark],
      [[[14, 50], [20, 34], [24, 52]], k.dark],
      [[[20, 70], [26, 62], [32, 82]], k.dark]
    ]) +
    pair(33, 30, 6, k.base) +
    both([
      [[[34, 32], [50, 28], [50, 52], [30, 50]], k.light],
      [[[30, 50], [50, 52], [50, 76], [36, 70]], k.base],
      [[[42, 58], [50, 55], [50, 74], [42, 70]], k.pale]
    ]) +
    nose(58, 4, 5),
  deer: (k) =>
    `<path d="M38 26 L30 8 M33 15 L24 10 M31 11 L33 4 M62 26 L70 8 M67 15 L76 10 M69 11 L67 4" stroke="${k.deep}" stroke-width="3" stroke-linecap="round" fill="none"/>` +
    both([
      [[[36, 32], [18, 30], [14, 38], [32, 40]], k.dark],
      [[[34, 30], [50, 28], [50, 56], [32, 48]], k.base],
      [[[32, 48], [50, 56], [50, 86], [41, 80]], k.light],
      [[[44, 70], [50, 68], [50, 86], [44, 82]], k.pale]
    ]) +
    nose(76, 3.5, 4.5),
  penguin: (k) =>
    both([
      [[[50, 16], [30, 22], [20, 44], [24, 72], [38, 84], [50, 86]], k.deep],
      [[[50, 30], [38, 30], [30, 44], [32, 66], [42, 78], [50, 80]], WHITE],
      [[[38, 30], [50, 34], [50, 42], [40, 40]], k.deep]
    ]) +
    facet([[44, 52], [56, 52], [50, 62]], '#F5B524'),
  frog: (k) =>
    pair(32, 32, 12, k.base) +
    pair(32, 32, 7, k.pale) +
    pair(32, 32, 3, INK) +
    both([
      [[[20, 44], [50, 38], [50, 74], [26, 70], [14, 58]], k.base],
      [[[14, 58], [26, 70], [50, 74], [50, 78], [24, 74]], k.dark]
    ]) +
    `<path d="M32 60 Q50 68 68 60" stroke="${k.deep}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  monkey: (k) =>
    pair(18, 48, 10, k.base) +
    pair(18, 48, 5, k.pale) +
    both([
      [[[26, 28], [50, 22], [50, 50], [22, 52]], k.dark],
      [[[22, 52], [50, 50], [50, 84], [32, 78]], k.deep],
      [[[34, 40], [48, 42], [50, 48], [50, 80], [36, 74], [30, 56]], k.pale]
    ]) +
    pair(45, 62, 1.6, INK),
  raccoon: (k) =>
    both([
      [[[24, 14], [22, 40], [40, 30]], k.dark],
      [[[27, 21], [26, 36], [36, 31]], WHITE],
      [[[40, 30], [50, 28], [50, 50], [22, 44]], k.base],
      [[[22, 44], [50, 50], [46, 58], [18, 56]], k.deep],
      [[[18, 56], [46, 58], [50, 58], [50, 82], [30, 74]], k.pale]
    ]) +
    nose(68, 3.5, 4.5),
  mouse: (k) =>
    pair(24, 32, 15, k.dark) +
    pair(24, 32, 8.5, '#FFB3C7') +
    both([
      [[[34, 34], [50, 30], [50, 56], [28, 56]], k.base],
      [[[28, 56], [50, 56], [50, 84], [38, 72]], k.light]
    ]) +
    circle(50, 82, 3.4, INK) +
    `<path d="M44 74 L26 70 M44 77 L27 80 M56 74 L74 70 M56 77 L73 80" stroke="${WHITE}" stroke-opacity="0.8" stroke-width="1.3" stroke-linecap="round"/>`,
  pig: (k) =>
    both([
      [[[24, 22], [22, 42], [38, 32]], k.dark],
      [[[38, 32], [50, 30], [50, 56], [22, 54], [22, 42]], k.light],
      [[[22, 54], [50, 56], [50, 82], [30, 76]], k.base]
    ]) +
    ellipse(50, 62, 12, 8.5, k.dark) +
    pair(45.5, 62, 2.2, INK),
  elephant: (k) =>
    both([
      [[[30, 30], [8, 26], [6, 52], [16, 66], [30, 60]], k.dark],
      [[[30, 26], [50, 22], [50, 50], [30, 56]], k.base],
      [[[30, 56], [50, 50], [50, 62], [36, 64]], k.light]
    ]) +
    `<path d="M44 52 L44 82 Q44 90 52 90 L56 90 L56 84 L52 84 Q50 84 50 80 L56 52 Z" fill="${k.base}"/>`
}

/** Returns the SVG markup for an avatar. `animal`/`color` override the ones from the name. */
export function mascotSvg(seed: string, opts: { animal?: Animal | null; color?: string | null } = {}): string {
  const animal = isAnimal(opts.animal) ? opts.animal : seededAnimal(seed)
  const base = opts.color ?? seededColor(seed)
  const k: Ink = { base, dark: shade(base, -0.28), deep: shade(base, -0.5), light: shade(base, 0.3), pale: shade(base, 0.72) }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${HEADS[animal](k)}</svg>`
}

export function mascotDataUrl(seed: string, opts: { animal?: Animal | null; color?: string | null } = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg(seed, opts))}`
}
