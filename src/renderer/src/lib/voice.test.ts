import { describe, expect, it } from 'vitest'
import { chunks, goodVoices, isNovelty, pickVoice, speakable } from './voice'

const v = (name: string, lang = 'en-US') => ({ name, lang })
const mac = [
  v('Albert'),
  v('Grandpa (English (United Kingdom))', 'en-GB'),
  v('Samantha'),
  v('Moira', 'en-IE'),
  v('Daniel', 'en-GB'),
  v('Zarvox'),
  v('Thomas', 'fr-FR')
]

describe('voice choice', () => {
  it('never picks a novelty or elderly character voice', () => {
    expect(isNovelty(v('Albert'))).toBe(true)
    expect(isNovelty(v('Grandma (English (United States))'))).toBe(true)
    expect(goodVoices(mac).map((x) => x.name)).toEqual(['Daniel', 'Moira', 'Samantha'])
  })

  it('prefers downloaded Premium, then Enhanced voices', () => {
    const all = [...mac, v('Serena (Enhanced)', 'en-GB'), v('Jamie (Premium)', 'en-GB')]
    expect(goodVoices(all).slice(0, 2).map((x) => x.name)).toEqual(['Jamie (Premium)', 'Serena (Enhanced)'])
  })

  it('uses the saved voice while it is installed', () => {
    expect(pickVoice(mac, 'Moira')?.name).toBe('Moira')
    expect(pickVoice(mac, 'Ava (Premium)')?.name).toBe('Daniel')
    expect(pickVoice(mac, null)?.name).toBe('Daniel')
    expect(pickVoice([v('Albert')], null)).toBeNull()
  })
})

describe('reading text', () => {
  it('drops Markdown, emoji, checkmarks and code', () => {
    const text = '**Done** ✓ Gmail → 42 emails 📬\n- [Plan](https://x.y/z)\n```js\nx()\n```\nSee https://a.b'
    expect(speakable(text)).toBe('Done Gmail, 42 emails\nPlan\nSee a link')
  })

  it('keeps file names, times and decimals inside one piece', () => {
    expect(chunks('See CLAUDE.md at 5:30, about 58.9 ms. Then stop.', 30)).toEqual(['See CLAUDE.md at 5:30, about', '58.9 ms. Then stop.'])
    expect(chunks('See CLAUDE.md at 5:30. Then stop.')).toEqual(['See CLAUDE.md at 5:30. Then stop.'])
  })

  it('splits long text into sentences and keeps lines apart', () => {
    const long = `${'word '.repeat(60).trim()}. Short one.`
    const parts = chunks(`First line\n${long}`, 120)
    expect(parts[0]).toBe('First line')
    expect(parts.every((p) => p.length <= 120)).toBe(true)
    expect(parts.at(-1)?.endsWith('. Short one.')).toBe(true)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(`First line ${long}`)
  })
})
