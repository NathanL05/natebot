import { describe, expect, it } from 'vitest'
import { normalize, slugify } from './agents'
import { BOARD_MEMBERS, BOARD_ROOM, BOARD_ROOM_ID } from './board'
import { MAX_MEMBERS, MIN_MEMBERS } from './rooms'

describe('career board', () => {
  it('has a valid line-up with distinct agent ids', () => {
    const ids = BOARD_MEMBERS.map((m) => slugify(m.name))
    expect(new Set(ids).size).toBe(BOARD_MEMBERS.length)
    expect(BOARD_MEMBERS.length).toBeGreaterThanOrEqual(MIN_MEMBERS)
    expect(BOARD_MEMBERS.length).toBeLessThanOrEqual(MAX_MEMBERS)
    expect(BOARD_ROOM_ID).toBe('room:career-board')
    expect(BOARD_ROOM.maxTurns).toBeGreaterThanOrEqual(BOARD_MEMBERS.length)
  })

  it('gives every member the shared honesty rules and no connectors', () => {
    for (const m of BOARD_MEMBERS) {
      const a = normalize({ ...m, read_folders: ['/Users/x/Atlas'] }, slugify(m.name))
      expect(a.instructions).toContain('Brutal honesty')
      expect(a.instructions).toContain('Agreement is earned')
      expect(a.mcp_servers).toEqual([])
      expect(a.routines).toEqual([])
      expect(a.read_folders).toEqual(['/Users/x/Atlas'])
    }
  })
})
