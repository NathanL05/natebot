// Shared agents carry what the agent does, never what it knows about you, and arrive switched off.
import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '@shared/types'
import { draftFromShare, shareFile } from './agent-share'

const agent: AgentConfig = {
  id: 'job-scout',
  name: 'Job Scout',
  shape: 'hexagon',
  color: '#5E8BFF',
  model: 'haiku',
  effort: 'low',
  instructions: 'Find graduate cloud roles.',
  mcp_servers: ['gmail'],
  allowed_tools: ['Bash'],
  disallowed_tools: ['mcp__gmail__manage_gmail_filter'],
  quick_prompts: ['Anything new?'],
  routines: [{ id: 'main', enabled: true, cron: '0 8 * * 1-5', prompt: 'Check boards' }],
  email_triggers: [{ id: 't1', enabled: true, query: 'subject:interview', prompt: 'Tell me' }],
  web_watches: [{ id: 'w1', enabled: true, url: 'https://jobs.example.com/', every: 6, match: 'graduate', prompt: 'New roles?' }],
  read_folders: ['/Users/me/Desktop/Atlas'],
  auto_approve: ['mcp__gmail__send_gmail_message'],
  session_id: 'sess-secret'
}

describe('sharing agents', () => {
  it('leaves out memory, session, folders and anything that grants tools', () => {
    const text = shareFile(agent)
    for (const secret of ['sess-secret', 'Atlas', 'Bash', 'auto_approve', 'send_gmail_message']) expect(text).not.toContain(secret)
    expect(JSON.parse(text).agent.instructions).toBe('Find graduate cloud roles.')
  })

  it('imports as a draft with everything automatic switched off', () => {
    const d = draftFromShare(shareFile(agent))
    expect(d).toMatchObject({ name: 'Job Scout', model: 'haiku', instructions: 'Find graduate cloud roles.', allowed_tools: [], read_folders: [], auto_approve: [] })
    expect(d.disallowed_tools).toEqual(['mcp__gmail__manage_gmail_filter'])
    expect([...d.routines, ...d.email_triggers, ...(d.web_watches ?? [])].map((x) => x.enabled)).toEqual([false, false, false])
    expect(d.web_watches?.[0]?.url).toBe('https://jobs.example.com/')
  })

  it('refuses files that are not shared agents, and ignores granted tools in a tampered file', () => {
    expect(() => draftFromShare('nope')).toThrow(/valid JSON/)
    expect(() => draftFromShare('{"format":"other","agent":{}}')).toThrow(/isn't a NateBot agent/)
    expect(() => draftFromShare('{"format":"natebot-agent","version":99,"agent":{}}')).toThrow(/newer NateBot/)
    const tampered = JSON.stringify({ format: 'natebot-agent', version: 1, agent: { name: 'X', allowed_tools: ['Bash'], auto_approve: ['mcp__a__b'], read_folders: ['/'] } })
    expect(draftFromShare(tampered)).toMatchObject({ allowed_tools: [], auto_approve: [], read_folders: [] })
  })
})
