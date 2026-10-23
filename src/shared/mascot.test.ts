import { describe, expect, it } from 'vitest'
import { cleanEmoji, MASCOT_SHAPES, mascotSvg, seededEmoji, tint } from './mascot'

describe('avatar emoji', () => {
  it('follows words in the name, else a stable pick', () => {
    expect(seededEmoji('Email Agent')).toBe('📬')
    expect(seededEmoji('Travel Planner')).toBe('✈️')
    expect(seededEmoji('Sleep Specialist')).toBe('😴')
    expect(seededEmoji('Straight Talk')).toBe('🎯')
    expect(seededEmoji('Zorblax')).toBe(seededEmoji('zorblax '))
  })

  it('keeps one character from input', () => {
    expect(cleanEmoji('🐺🦊')).toBe('🐺')
    expect(cleanEmoji('👍🏽')).toBe('👍🏽')
    expect(cleanEmoji('  ')).toBeNull()
    expect(cleanEmoji('&')).toBeNull()
  })

  it('mixes a colour with white', () => {
    expect(tint('#000000', 0.75)).toBe('#bfbfbf')
    expect(tint('#FF4D94', 0)).toBe('#ff4d94')
    expect(tint('red')).toBe('red')
  })

  it('draws the emoji on a tinted shape, with no face', () => {
    for (const shape of MASCOT_SHAPES) {
      const svg = mascotSvg('Email Agent', { shape, color: '#F5A524' })
      expect(svg).toContain('>📬</text>')
      expect(svg).toContain(tint('#F5A524'))
      expect(svg).not.toContain('#FFFFFF')
    }
    expect(mascotSvg('Email Agent', { emoji: '🦉' })).toContain('>🦉</text>')
  })
})
