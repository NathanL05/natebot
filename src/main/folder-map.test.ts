import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describe as about, folderMap, formatMap, scanFolder } from './folder-map'

function plan(): string {
  const dir = mkdtempSync(join(tmpdir(), 'natebot-map-'))
  const write = (path: string, text: string, daysAgo: number): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
    const t = new Date(Date.now() - daysAgo * 86_400_000)
    utimesSync(join(dir, path), t, t)
  }
  write('README.md', '# Atlas\n\nA career operating system.\n', 30)
  write('CLAUDE.md', '# Rules\n\nThe markdown decides.\n', 30)
  write('strategy/thesis.md', '---\ntags: [plan]\n---\n# Career thesis\n\nRewritten 27 Sept: **Hong Kong** first, via [cold applications](x.md).\n', 20)
  write('execution/weekly-log.md', '# Weekly log\n\n| Week | Hours |\n|---|---|\n| 1 | 10 |\n', 2)
  write('projects/results.csv', 'date,trial,prefix_tokens\n2026-10-18,1,512\n', 5)
  write('projects/diagram.png', 'png', 5)
  write('.claude/worktrees/x/strategy/thesis.md', '# Old copy\n', 1)
  write('tools/tests/fixtures/thesis.md', '# Fixture\n', 1)
  write('node_modules/pkg/README.md', '# Package\n', 1)
  return dir
}

describe('describe', () => {
  it('takes the first heading as the title and the first prose line as what it is about', () => {
    expect(about('---\ntitle: x\n---\n# Career thesis\n\n> **Rewritten** 27 Sept, see [the plan](p.md).\n')).toEqual({
      title: 'Career thesis',
      description: 'Rewritten 27 Sept, see the plan.'
    })
    expect(about('# Log\n\n| a | b |\n|---|---|\n- 1. first entry')).toEqual({ title: 'Log', description: '| a | b |' })
    expect(about('', '.md')).toEqual({ title: null, description: null })
  })

  it("uses a data file's first line as is", () => {
    expect(about('date,trial,prefix_tokens\n1,2,3', '.csv')).toEqual({ title: null, description: 'date,trial,prefix_tokens' })
  })
})

describe('folderMap', () => {
  it('lists the notes newest first, skipping copies, fixtures and packages, with README and CLAUDE in full', () => {
    const dir = plan()
    const scan = scanFolder(dir)
    expect(scan.entries.map((e) => e.path)).toEqual(['execution/weekly-log.md', 'projects/results.csv', 'strategy/thesis.md', 'CLAUDE.md', 'README.md'])
    expect(scan.others).toBe(1)

    const map = folderMap(dir)
    expect(map).toContain(`## Map of ${dir}`)
    expect(map).toContain('### README.md (in full)\n# Atlas\n\nA career operating system.')
    expect(map).toContain('### CLAUDE.md (in full)\n# Rules\n\nThe markdown decides.')
    expect(map).toMatch(/- strategy\/thesis\.md \(\d+ B, edited \d+ \w+ \d{4}\) Career thesis: Rewritten 27 Sept: Hong Kong first, via cold applications\./)
    expect(map).toContain('projects/results.csv')
    expect(map).toContain('(and 1 other file: code, images, data)')
    expect(map).not.toContain('Old copy')
    expect(map).not.toContain('Fixture')
    expect(map).not.toContain('Package')
    // README and CLAUDE aren't listed again under Notes.
    expect(map.split('### Notes')[1]).not.toContain('README.md')
  })

  it('stays within its size cap, dropping descriptions of the oldest notes first', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      path: `notes/note-${i}.md`,
      bytes: 2048,
      modified: Date.now() - i * 60_000,
      title: `Note ${i}`,
      description: 'x'.repeat(100)
    }))
    const map = formatMap('/plan', { entries, others: 0 }, [{ name: 'README.md', text: 'y'.repeat(10_000) }])
    expect(map.length).toBeLessThanOrEqual(18_100)
    expect(map).toContain('…(cut short: read the file for the rest)')
    expect(map).toContain('- notes/note-0.md (2 KB, edited')
    expect(map).toMatch(/- …and \d+ more notes/)
  })
})
