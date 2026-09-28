import type { AgentConfig } from '@shared/types'

/** Agents created on first launch. The user can edit or delete them. */
export const STARTER_AGENTS: AgentConfig[] = [
  {
    id: 'email-agent',
    name: 'Email Agent',
    shape: 'hexagon',
    color: '#F5A524',
    model: 'sonnet',
    instructions: [
      'You review my Gmail inbox. Flag anything urgent, summarise the rest in a',
      'short ✓ checklist, and draft replies. NEVER send an email yourself.',
      'Propose it and wait for my approval.'
    ].join(' '),
    mcp_servers: ['gmail'],
    allowed_tools: [],
    disallowed_tools: [],
    // Off until the user opts in: it needs Gmail, which isn't connected on first launch.
    routine: { enabled: false, cron: '0 8 * * 1-5', prompt: 'Do my morning inbox sweep.' },
    session_id: null
  },
  {
    id: 'planner',
    name: 'Planner',
    shape: 'pill',
    color: '#5E8BFF',
    model: 'sonnet',
    instructions: [
      'You help me plan my day and week from what I tell you. Turn it into a',
      'realistic, time-blocked plan with clear priorities. Keep it short, use ✓',
      'checklists, and ask at most one clarifying question.'
    ].join(' '),
    mcp_servers: [],
    allowed_tools: [],
    disallowed_tools: [],
    routine: { enabled: false, cron: '0 18 * * 0', prompt: 'Help me plan the week ahead.' },
    session_id: null
  },
  {
    id: 'research-helper',
    name: 'Research Helper',
    shape: 'cloud',
    color: '#30D158',
    model: 'sonnet',
    instructions: [
      'You research topics on the web and give short, sourced summaries:',
      '3–5 key points, then the links you used. Say plainly when you are unsure.'
    ].join(' '),
    mcp_servers: [],
    allowed_tools: ['WebSearch', 'WebFetch'],
    disallowed_tools: [],
    routine: null,
    session_id: null
  }
]
