import { describe, expect, it } from 'vitest'
import type { AgentUsage } from './types'
import { formatTokens, rankUsage } from './usage'

const row = (agentId: string, over: Partial<AgentUsage> = {}): AgentUsage => ({
  agentId,
  runs: 1,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unmeasuredRuns: 0,
  ...over
})

describe('rankUsage', () => {
  it('shares by API-price estimate, biggest first', () => {
    const ranked = rankUsage([row('planner', { costUsd: 0.25, inputTokens: 90_000 }), row('email', { costUsd: 0.75, inputTokens: 10_000 })])
    expect(ranked.map((r) => [r.agentId, r.share])).toEqual([
      ['email', 0.75],
      ['planner', 0.25]
    ])
  })

  it('falls back to tokens when no run reported a price', () => {
    const ranked = rankUsage([row('a', { inputTokens: 1000 }), row('b', { inputTokens: 2500, outputTokens: 500 })])
    expect(ranked[0]).toMatchObject({ agentId: 'b', share: 0.75 })
  })

  it('handles a period with nothing measured', () => {
    expect(rankUsage([row('a', { unmeasuredRuns: 1 })])[0]?.share).toBe(0)
    expect(rankUsage([])).toEqual([])
  })
})

describe('formatTokens', () => {
  it('keeps numbers short', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(4_200_000)).toBe('4.2M')
  })
})
