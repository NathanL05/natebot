import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanTmp } from './tmp'

describe('cleanTmp', () => {
  it('removes leftover MCP configs and day-old clipboard images, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'natebot-tmp-'))
    for (const name of ['mcp-email-1234.json', 'clipboard-1.png', 'clipboard-2.png', 'notes.txt']) writeFileSync(join(dir, name), 'x')
    const twoDaysAgo = (Date.now() - 2 * 86_400_000) / 1000
    utimesSync(join(dir, 'clipboard-1.png'), twoDaysAgo, twoDaysAgo)
    expect(cleanTmp(dir)).toBe(2)
    expect(readdirSync(dir).sort()).toEqual(['clipboard-2.png', 'notes.txt'])
  })

  it('does nothing when the folder does not exist yet', () => {
    const dir = join(tmpdir(), 'natebot-tmp-missing-xyz')
    expect(existsSync(dir)).toBe(false)
    expect(cleanTmp(dir)).toBe(0)
  })
})
