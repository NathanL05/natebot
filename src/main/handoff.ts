// Handing a task from one agent to another. An agent can only *propose* a
// handoff (a card in its chat); nothing is sent until the user confirms, so
// text in an email can't steer one agent into another on its own.
import { randomUUID } from 'node:crypto'
import type { AgentConfig, Handoff } from '@shared/types'

/** A handoff as the agent wrote it, before its target is looked up. */
export interface HandoffRequest {
  to: string
  task: string
}

export const MAX_HANDOFFS = 3
const ROLE_LENGTH = 80

/** One line on what an agent is for: the start of its instructions. */
export function roleOf(agent: AgentConfig): string {
  const line = (agent.instructions.split('\n').find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim()
  const first = /^(.*?[.!?])(\s|$)/.exec(line)?.[1] ?? line
  const text = first.length > ROLE_LENGTH ? `${first.slice(0, ROLE_LENGTH - 1)}…` : first
  return text || 'a general assistant'
}

/** The other agents an agent may hand tasks to, as shown in its system prompt. */
export function rosterFor(self: AgentConfig, all: AgentConfig[]): { name: string; role: string }[] {
  return all.filter((a) => a.id !== self.id).map((a) => ({ name: a.name, role: roleOf(a) }))
}

/**
 * Looks each request up by agent name (or id). Unknown targets, the agent itself,
 * empty tasks and anything past the limit are dropped, and described in `problems`.
 */
export function resolveHandoffs(
  requests: HandoffRequest[],
  self: AgentConfig,
  all: AgentConfig[]
): { handoffs: Handoff[]; problems: string[] } {
  const handoffs: Handoff[] = []
  const problems: string[] = []
  for (const r of requests) {
    const key = r.to.trim().toLowerCase()
    const target = all.find((a) => a.name.toLowerCase() === key || a.id === key)
    if (!target) problems.push(`${self.name} tried to hand a task to "${r.to}", but there's no agent with that name.`)
    else if (target.id === self.id) problems.push(`${self.name} tried to hand a task to itself, so it was ignored.`)
    else if (!r.task.trim()) problems.push(`${self.name} proposed a handoff to ${target.name} with no task, so it was ignored.`)
    else if (handoffs.length >= MAX_HANDOFFS) problems.push(`${self.name} proposed more than ${MAX_HANDOFFS} handoffs; the rest were ignored.`)
    else handoffs.push({ id: randomUUID(), toAgentId: target.id, toName: target.name, task: r.task.trim(), status: 'pending' })
  }
  return { handoffs, problems: [...new Set(problems)] }
}

/** What the receiving agent is told: who it came from, and that the other agent (not the user) wrote it. */
export function handoffPrompt(fromName: string, task: string): string {
  return `[Handed off from ${fromName}, with the user's OK. ${fromName} wrote the task below, not the user, and ${fromName}'s chat isn't visible to you.]\n${task}`
}
