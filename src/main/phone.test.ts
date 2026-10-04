import { describe, expect, it } from 'vitest'
import { parsePhoneMessage } from './phone'

describe('phone messages', () => {
  it('reads an @agent prefix, or none', () => {
    expect(parsePhoneMessage('@Planner move gym to 8')).toEqual({ agent: 'planner', text: 'move gym to 8' })
    expect(parsePhoneMessage('  anything urgent?  ')).toEqual({ agent: null, text: 'anything urgent?' })
    expect(parsePhoneMessage('@planner')).toEqual({ agent: null, text: '@planner' })
  })
})
