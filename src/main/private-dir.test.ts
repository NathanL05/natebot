import { chmodSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makePrivate } from './private-dir'

const modeOf = (dir: string): number => statSync(dir).mode & 0o777

describe('makePrivate', () => {
  it('locks an existing folder that others could read, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'natebot-private-'))
    chmodSync(dir, 0o755)
    expect(makePrivate(dir)).toBe(true)
    expect(modeOf(dir)).toBe(0o700)
    expect(makePrivate(dir)).toBe(false)
  })

  it('creates a missing folder already private', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'natebot-private-')), 'NateBot')
    expect(makePrivate(dir)).toBe(false)
    expect(modeOf(dir)).toBe(0o700)
  })
})
