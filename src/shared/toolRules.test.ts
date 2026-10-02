import { describe, expect, it } from 'vitest'
import { splitToolRules } from './toolRules'

describe('splitToolRules', () => {
  it('splits on spaces and commas', () => {
    expect(splitToolRules('WebSearch WebFetch,  Read\nmcp__gmail__search')).toEqual(['WebSearch', 'WebFetch', 'Read', 'mcp__gmail__search'])
  })

  it('keeps rules with spaces inside parentheses whole', () => {
    expect(splitToolRules('Bash(git commit:*) Bash(npm run build:*), WebSearch')).toEqual(['Bash(git commit:*)', 'Bash(npm run build:*)', 'WebSearch'])
  })

  it('round-trips what the form shows (rules joined by spaces)', () => {
    const rules = ['Bash(git status:*)', 'Bash(git add:*)', 'Read']
    expect(splitToolRules(rules.join(' '))).toEqual(rules)
  })

  it('copes with empty input and unbalanced parentheses', () => {
    expect(splitToolRules('  ')).toEqual([])
    expect(splitToolRules('Bash(git log')).toEqual(['Bash(git log'])
    expect(splitToolRules('Read) Write')).toEqual(['Read)', 'Write'])
  })
})
