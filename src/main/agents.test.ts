import { describe, expect, it } from 'vitest'
import { DEFAULT_EFFORT } from '@shared/types'
import { normalize, slugify } from './agents'

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
        routine: null,
        session_id: null
      })
    }
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
      routine: { enabled: true, cron: '0 8 * * 1-5', prompt: 'Plan today' },
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
    expect(normalize({ routine: { enabled: 'yes', cron: '0 8 * * *' } }, 'x').routine).toEqual({
      enabled: false,
      cron: '0 8 * * *',
      prompt: ''
    })
    expect(normalize({ routine: { enabled: true, cron: '  ' } }, 'x').routine).toBeNull()
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
