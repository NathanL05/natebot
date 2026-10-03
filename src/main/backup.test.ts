import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prune } from './backup'

describe('backups', () => {
  it('keeps the newest dated folders only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'natebot-backups-'))
    for (const d of ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', 'notes']) mkdirSync(join(dir, d))
    prune(dir, 2)
    expect(readdirSync(dir).sort()).toEqual(['2026-09-27', '2026-09-28', 'notes'])
  })
})
