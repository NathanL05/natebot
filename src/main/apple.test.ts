import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const apple = createRequire(import.meta.url)('../../resources/apple-mcp.cjs') as {
  TOOLS: { name: string }[]
  SCRIPTS: Record<string, string>
  argsFor: (name: string, a: unknown) => Record<string, unknown>
}

describe('Apple connector', () => {
  it('has a script for every tool', () => {
    expect(apple.TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(apple.SCRIPTS).sort())
  })

  it('checks arguments before they reach a script', () => {
    expect(() => apple.argsFor('create_reminder', {})).toThrow(/title/)
    expect(() => apple.argsFor('create_reminder', { title: 'x', due: 'whenever' })).toThrow(/due/)
    expect(apple.argsFor('create_reminder', { title: 'Call Mum', due: '2026-10-05T09:00' })).toEqual({ title: 'Call Mum', due: '2026-10-05T09:00', list: null, notes: null })
    expect(apple.argsFor('list_reminders', { limit: 5000 })).toMatchObject({ limit: 200, include_completed: false })
    expect(() => apple.argsFor('read_note', {})).toThrow(/id/)
  })
})
