import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EFFORT } from '@shared/types'
import { AgentStore, normalize, slugify } from './agents'

describe('agent YAML normalisation', () => {
  it('fills every field from an empty or broken file', () => {
    for (const raw of [null, undefined, 'just a string', 42, []]) {
      expect(normalize(raw, 'my-agent')).toEqual({
        id: 'my-agent',
        name: 'my-agent',
        shape: null,
        color: '#5E8BFF',
        model: 'sonnet',
        effort: DEFAULT_EFFORT,
        instructions: '',
        mcp_servers: [],
        allowed_tools: [],
        disallowed_tools: [],
        quick_prompts: [],
        routines: [],
        email_triggers: [],
        read_folders: [],
        auto_approve: [],
        session_id: null
      })
    }
  })

  it('keeps only MCP tool names as Always allow rules, once each', () => {
    const a = normalize({ auto_approve: ['mcp__gtasks__create_task', 'mcp__gtasks__create_task', 'Bash', 'mcp____x', '', 3] }, 'p')
    expect(a.auto_approve).toEqual(['mcp__gtasks__create_task'])
  })

  it('keeps valid values', () => {
    const a = normalize(
      {
        name: '  Planner  ',
        shape: 'hexagon',
        color: '#aabbcc',
        model: 'haiku',
        effort: 'high',
        instructions: '  Plan my week.\n',
        mcp_servers: ['gmail'],
        allowed_tools: ['WebSearch'],
        disallowed_tools: ['Bash'],
        routine: { enabled: true, cron: '0 8 * * 1-5', prompt: 'Plan today' },
        session_id: 'abc'
      },
      'planner'
    )
    expect(a).toMatchObject({
      name: 'Planner',
      shape: 'hexagon',
      color: '#aabbcc',
      model: 'haiku',
      effort: 'high',
      instructions: 'Plan my week.',
      mcp_servers: ['gmail'],
      routines: [{ id: 'main', enabled: true, cron: '0 8 * * 1-5', prompt: 'Plan today' }],
      session_id: 'abc'
    })
  })

  it('replaces invalid values with defaults', () => {
    const a = normalize({ model: 'gpt-4', effort: 'extreme', color: 'red', shape: 'star', session_id: '' }, 'x')
    expect(a.model).toBe('sonnet')
    expect(a.effort).toBe(DEFAULT_EFFORT)
    expect(a.color).toBe('#5E8BFF')
    expect(a.shape).toBeNull()
    expect(a.session_id).toBeNull()
  })

  it('cleans tool lists', () => {
    const a = normalize({ allowed_tools: [' WebFetch ', '', '   ', 7, null, 'Read'], mcp_servers: 'gmail' }, 'x')
    expect(a.allowed_tools).toEqual(['WebFetch', 'Read'])
    expect(a.mcp_servers).toEqual([])
  })

  it('only enables a routine that says enabled: true and has a cron', () => {
    expect(normalize({ routine: { enabled: 'yes', cron: '0 8 * * *' } }, 'x').routines).toEqual([
      { id: 'main', enabled: false, cron: '0 8 * * *', prompt: '' }
    ])
    expect(normalize({ routine: { enabled: true, cron: '  ' } }, 'x').routines).toEqual([])
  })

  it('reads a list of routines, giving each a unique id and capping the count', () => {
    const routines = normalize(
      {
        routines: [
          { cron: '0 8 * * *', prompt: 'Morning' },
          { id: 'evening', enabled: true, cron: '0 19 * * *', prompt: 'Evening' },
          { id: 'evening', cron: '0 12 * * *' },
          { id: 'Bad Id!', cron: '0 13 * * *' },
          { cron: '' },
          { cron: '0 14 * * *' },
          { cron: '0 15 * * *' },
          { cron: '0 16 * * *' }
        ]
      },
      'x'
    ).routines
    expect(routines.map((r) => r.id)).toEqual(['main', 'evening', 'evening-2', 'r4', 'r6'])
    expect(routines[1]).toEqual({ id: 'evening', enabled: true, cron: '0 19 * * *', prompt: 'Evening' })
  })

  it('cleans quick prompts, and gives starter agents from before they existed their defaults', () => {
    expect(normalize({ quick_prompts: ['  Sum  up\n my inbox ', 'Sum up my inbox', '', 3, 'a', 'b', 'c', 'd', 'e', 'f'] }, 'x').quick_prompts).toEqual([
      'Sum up my inbox',
      'a',
      'b',
      'c',
      'd',
      'e'
    ])
    expect(normalize({}, 'email-agent').quick_prompts).toContain('Give me a summary of my emails')
    expect(normalize({ quick_prompts: [] }, 'email-agent').quick_prompts).toEqual([])
  })

  it('keeps absolute, comma-free folder paths', () => {
    process.env['HOME'] = '/Users/me'
    expect(normalize({ read_folders: ['~/Desktop/Atlas/', 'relative/path', '/a,b', '/Users/me/Desktop/Atlas', 5] }, 'x').read_folders).toEqual(['/Users/me/Desktop/Atlas'])
  })

  it('keeps the designed shape of starter agents created before shapes existed', () => {
    expect(normalize({}, 'email-agent').shape).not.toBeNull()
  })
})

describe('slugify', () => {
  it('makes file-safe ids', () => {
    expect(slugify('Email Agent')).toBe('email-agent')
    expect(slugify('  Café — Planner!! ')).toBe('cafe-planner')
    expect(slugify('***')).toBe('agent')
    expect(slugify('a'.repeat(100))).toHaveLength(48)
  })
})

describe('AgentStore', () => {
  it('keeps Always allow rules through an update that leaves them out', () => {
    const store = new AgentStore(mkdtempSync(join(tmpdir(), 'agents-')))
    store.init()
    const a = store.create({ ...store.list()[0]!, name: 'Rules', auto_approve: ['mcp__gtasks__create_task'] })
    const { auto_approve: _omit, ...withoutRules } = a
    expect(store.update({ ...withoutRules, instructions: 'New' }).auto_approve).toEqual(['mcp__gtasks__create_task'])
    expect(store.update({ ...a, auto_approve: [] }).auto_approve).toEqual([])
    store.close()
  })
})
