import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '@shared/types'
import { handoffPrompt, MAX_HANDOFFS, resolveHandoffs, roleOf, rosterFor } from './handoff'

const agent = (id: string, name: string, instructions = ''): AgentConfig => ({
  id,
  name,
  shape: null,
  color: '#5E8BFF',
  model: 'sonnet',
  effort: 'medium',
  instructions,
  mcp_servers: [],
  allowed_tools: [],
  disallowed_tools: [],
  quick_prompts: [],
  routines: [],
  email_triggers: [],
  session_id: null
})

const email = agent('email-agent', 'Email Agent', 'You review my Gmail inbox. Flag anything urgent.')
const planner = agent('planner', 'Planner', 'You help me plan my day and week.\nKeep it short.')
const all = [email, planner]

describe('roles and roster', () => {
  it('uses the first sentence of the instructions, shortened', () => {
    expect(roleOf(email)).toBe('You review my Gmail inbox.')
    expect(roleOf(agent('a', 'A'))).toBe('a general assistant')
    expect(roleOf(agent('a', 'A', 'x'.repeat(200))).length).toBe(80)
  })

  it('lists the other agents, not the agent itself', () => {
    expect(rosterFor(email, all)).toEqual([{ name: 'Planner', role: 'You help me plan my day and week.' }])
  })
})

describe('resolveHandoffs', () => {
  it('finds the target by name, ignoring case, or by id', () => {
    const { handoffs } = resolveHandoffs([{ to: 'PLANNER', task: ' Plan Friday ' }, { to: 'planner', task: 'Again' }], email, all)
    expect(handoffs.map((h) => [h.toAgentId, h.toName, h.task, h.status])).toEqual([
      ['planner', 'Planner', 'Plan Friday', 'pending'],
      ['planner', 'Planner', 'Again', 'pending']
    ])
  })

  it('drops unknown targets, itself and empty tasks, saying why', () => {
    const { handoffs, problems } = resolveHandoffs(
      [{ to: 'Accountant', task: 'x' }, { to: 'Email Agent', task: 'x' }, { to: 'Planner', task: '  ' }],
      email,
      all
    )
    expect(handoffs).toEqual([])
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('"Accountant"')
  })

  it('caps how many an agent can propose at once', () => {
    const many = Array.from({ length: MAX_HANDOFFS + 2 }, (_, i) => ({ to: 'Planner', task: `t${i}` }))
    const { handoffs, problems } = resolveHandoffs(many, email, all)
    expect(handoffs).toHaveLength(MAX_HANDOFFS)
    expect(problems).toHaveLength(1)
  })
})

describe('handoffPrompt', () => {
  it('says who wrote the task and that the user confirmed it', () => {
    const p = handoffPrompt('Email Agent', 'Plan Friday')
    expect(p).toContain('Handed off from Email Agent')
    expect(p).toContain('not the user')
    expect(p.endsWith('Plan Friday')).toBe(true)
  })
})
