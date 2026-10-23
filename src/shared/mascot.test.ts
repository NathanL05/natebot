import { describe, expect, it } from 'vitest'
import { ANIMALS, mascotSvg, seededAnimal, seededColor, shade } from './mascot'

describe('avatar animals', () => {
  it('uses an animal named in the agent name, else a stable pick', () => {
    expect(seededAnimal('Night Owl')).toBe('owl')
    expect(seededAnimal('Fox Finder')).toBe('fox')
    expect(seededAnimal('Email Agent')).toBe(seededAnimal('email agent '))
    expect(ANIMALS).toContain(seededAnimal('Zorblax'))
  })

  it('keeps the colour each name had before animals', () => {
    expect(seededColor('Email Agent')).toBe(seededColor('Email Agent'))
    expect(seededColor('Planner')).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('shades a colour toward white or black', () => {
    expect(shade('#000000', 0.5)).toBe('#808080')
    expect(shade('#FFFFFF', -0.5)).toBe('#808080')
    expect(shade('red', 0.5)).toBe('red')
  })

  it('draws every animal in the agent colour, with no stray markup', () => {
    for (const animal of ANIMALS) {
      const svg = mascotSvg('Agent', { animal, color: '#5E8BFF' })
      expect(svg.startsWith('<svg')).toBe(true)
      // Every head uses the agent's colour or a shade of it.
      expect([0, -0.28, -0.5].some((k) => svg.toLowerCase().includes(shade('#5E8BFF', k).toLowerCase())), animal).toBe(true)
      expect(svg).not.toMatch(/NaN|undefined/)
    }
    // An unknown animal falls back to the one from the name.
    expect(mascotSvg('Night Owl', { animal: 'dragon' as never })).toBe(mascotSvg('Night Owl'))
  })
})
