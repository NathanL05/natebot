import { describe, expect, it } from 'vitest'
import { GUIDE, GUIDE_FEATURES, searchGuide } from './guide'

describe('guide', () => {
  it('gives every feature a unique id and a few short steps', () => {
    const ids = GUIDE_FEATURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of GUIDE_FEATURES) {
      expect(f.steps.length, f.id).toBeGreaterThan(0)
      expect(f.steps.length, f.id).toBeLessThanOrEqual(5)
      for (const s of f.steps) expect(s.length, `${f.id}: ${s}`).toBeLessThanOrEqual(140)
    }
  })

  it('has no empty categories and balanced markup', () => {
    for (const c of GUIDE) expect(c.features.length, c.id).toBeGreaterThan(0)
    for (const f of GUIDE_FEATURES) {
      for (const text of [...f.steps, f.tip ?? '']) {
        expect(text.split('**').length % 2, `${f.id}: ${text}`).toBe(1)
        expect(text.split('`').length % 2, `${f.id}: ${text}`).toBe(1)
      }
    }
  })

  it('searches titles, keywords and steps, ignoring markup', () => {
    expect(searchGuide('')).toBe(GUIDE)
    const ids = (q: string): string[] => searchGuide(q).flatMap((c) => c.features.map((f) => f.id))
    expect(ids('reminder')).toContain('reminders')
    expect(ids('hamburger')).toEqual(['launcher'])
    expect(ids('create agent')).toContain('new-agent')
    expect(ids('Load older')).toEqual(['older'])
    expect(ids('zzzz')).toEqual([])
  })
})
