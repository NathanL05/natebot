import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = join(tmpdir(), `natebot-memory-${process.pid}`)
vi.mock(import('./paths'), async (importOriginal) => ({
  ...(await importOriginal()),
  workspaceOf: (id: string) => join(root, id)
}))

const { memoryBlock, readMemory, writeMemory } = await import('./memory')

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('lasting notes', () => {
  it('reads nothing before there are notes, and round-trips what is written', () => {
    mkdirSync(join(root, 'planner'), { recursive: true })
    expect(readMemory('planner')).toBe('')
    expect(memoryBlock('planner')).toBeNull()
    writeMemory('planner', '  - Gym on Mon/Wed at 7pm\n- Codeword: KIWI  \n')
    expect(readMemory('planner')).toBe('- Gym on Mon/Wed at 7pm\n- Codeword: KIWI')
    expect(memoryBlock('planner')).toMatch(/^\[Your lasting notes from memory\.md.*\]\n- Gym/)
  })

  it('shows a fresh session only the start of very long notes', () => {
    mkdirSync(join(root, 'planner'), { recursive: true })
    writeMemory('planner', 'x'.repeat(20_000))
    const block = memoryBlock('planner') ?? ''
    expect(block.length).toBeLessThan(8_200)
    expect(block).toContain('read memory.md for the rest')
  })
})
