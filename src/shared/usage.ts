// Turning per-agent run totals into "who used what" for the Usage settings.

import type { AgentUsage } from './types'

export interface UsageShare extends AgentUsage {
  /** 0–1 of NateBot's usage in the period. */
  share: number
}

/** Runs of deleted agents are kept under this id (it can't clash: agent ids never contain ":"). */
export const DELETED_AGENT_ID = 'deleted:'

const tokens = (u: AgentUsage): number => u.inputTokens + u.outputTokens

/**
 * Each agent's share, biggest first. Shares use the API-price estimate, which
 * weighs Opus above Haiku and cached reads below fresh input; if no run in the
 * period reported a price, raw tokens are used instead.
 */
export function rankUsage(rows: AgentUsage[]): UsageShare[] {
  const byCost = rows.some((r) => r.costUsd > 0)
  const weight = (u: AgentUsage): number => (byCost ? u.costUsd : tokens(u))
  const total = rows.reduce((n, r) => n + weight(r), 0)
  return rows
    .map((r) => ({ ...r, share: total > 0 ? weight(r) / total : 0 }))
    .sort((a, b) => b.share - a.share || b.runs - a.runs)
}

/** 950 → "950", 12_345 → "12.3k", 4_200_000 → "4.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
