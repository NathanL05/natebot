// Accent colours the user can pick in Settings. Each has a shade per theme:
// `text` for links, indicators and highlighted text (readable on the theme's
// background) and `fill` for solid surfaces: your bubbles, the send button,
// primary buttons. Text on a fill is white when it's readable, otherwise near-black.

export interface AccentShades {
  text: string
  fill: string
}

export interface Accent {
  id: string
  label: string
  dark: AccentShades
  light: AccentShades
}

export const ACCENTS = [
  { id: 'violet', label: 'Violet', dark: { text: '#9B82FF', fill: '#6C4DFF' }, light: { text: '#5B3DF5', fill: '#5B3DF5' } },
  { id: 'indigo', label: 'Indigo', dark: { text: '#8E98FF', fill: '#4F46E5' }, light: { text: '#4338CA', fill: '#4F46E5' } },
  { id: 'blue', label: 'Blue', dark: { text: '#60A5FA', fill: '#2563EB' }, light: { text: '#1D4ED8', fill: '#2563EB' } },
  { id: 'sky', label: 'Sky', dark: { text: '#38BDF8', fill: '#0EA5E9' }, light: { text: '#0369A1', fill: '#0284C7' } },
  { id: 'cyan', label: 'Cyan', dark: { text: '#22D3EE', fill: '#06B6D4' }, light: { text: '#0E7490', fill: '#0891B2' } },
  { id: 'teal', label: 'Teal', dark: { text: '#2DD4BF', fill: '#14B8A6' }, light: { text: '#0F766E', fill: '#0D9488' } },
  { id: 'emerald', label: 'Emerald', dark: { text: '#34D399', fill: '#10B981' }, light: { text: '#047857', fill: '#059669' } },
  { id: 'green', label: 'Green', dark: { text: '#4ADE80', fill: '#22C55E' }, light: { text: '#15803D', fill: '#16A34A' } },
  { id: 'lime', label: 'Lime', dark: { text: '#A3E635', fill: '#84CC16' }, light: { text: '#4D7C0F', fill: '#65A30D' } },
  { id: 'yellow', label: 'Yellow', dark: { text: '#FACC15', fill: '#FACC15' }, light: { text: '#A16207', fill: '#EAB308' } },
  { id: 'amber', label: 'Amber', dark: { text: '#FBBF24', fill: '#F59E0B' }, light: { text: '#B45309', fill: '#D97706' } },
  { id: 'orange', label: 'Orange', dark: { text: '#FB923C', fill: '#F97316' }, light: { text: '#C2410C', fill: '#EA580C' } },
  { id: 'red', label: 'Red', dark: { text: '#F87171', fill: '#DC2626' }, light: { text: '#B91C1C', fill: '#DC2626' } },
  { id: 'rose', label: 'Rose', dark: { text: '#FB7185', fill: '#E11D48' }, light: { text: '#BE123C', fill: '#E11D48' } },
  { id: 'pink', label: 'Pink', dark: { text: '#F472B6', fill: '#DB2777' }, light: { text: '#BE185D', fill: '#DB2777' } },
  { id: 'fuchsia', label: 'Fuchsia', dark: { text: '#E879F9', fill: '#C026D3' }, light: { text: '#A21CAF', fill: '#C026D3' } },
  { id: 'purple', label: 'Purple', dark: { text: '#C084FC', fill: '#9333EA' }, light: { text: '#7E22CE', fill: '#9333EA' } },
  { id: 'graphite', label: 'Graphite', dark: { text: '#E4E4EA', fill: '#ECECF1' }, light: { text: '#1A1A22', fill: '#16161D' } }
] as const satisfies readonly Accent[]

export type AccentId = (typeof ACCENTS)[number]['id']
export const DEFAULT_ACCENT: AccentId = 'violet'

export const isAccentId = (v: unknown): v is AccentId => ACCENTS.some((a) => a.id === v)

export function accentById(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Text colour for a solid fill: white when it meets 4.5:1, otherwise whichever reads better. */
export function onFill(fill: string): string {
  const white = contrast(fill, '#FFFFFF')
  return white >= 4.5 || white >= contrast(fill, '#0B0B12') ? '#FFFFFF' : '#0B0B12'
}
