import { describe, expect, it } from 'vitest'
import { AGENT_TEMPLATES } from './templates'
import { MAX_QUICK_PROMPTS } from './types'

describe('agent templates', () => {
  it('have distinct ids and allowed quick prompts', () => {
    expect(new Set(AGENT_TEMPLATES.map((t) => t.id)).size).toBe(AGENT_TEMPLATES.length)
    for (const t of AGENT_TEMPLATES) expect(t.draft.quick_prompts.length).toBeLessThanOrEqual(MAX_QUICK_PROMPTS)
  })

  it('keeps the mentor blunt but safe', () => {
    const mentor = AGENT_TEMPLATES.find((t) => t.id === 'mentor')!
    expect(mentor.readsPlan).toBe(true)
    expect(mentor.draft.mcp_servers).toEqual([])
    expect(mentor.draft.instructions).toContain('Verdict first')
    expect(mentor.draft.instructions).toContain('never about my worth')
    expect(mentor.draft.instructions).toContain('116 123')
  })
})
