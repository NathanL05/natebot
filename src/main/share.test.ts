import { describe, expect, it } from 'vitest'
import { parseShareLink } from './share'

describe('natebot:// links', () => {
  it('reads text and agent for the quick-capture box', () => {
    expect(parseShareLink('natebot://capture?text=Is%20this%20worth%20applying%20to%3F%20https%3A%2F%2Fx.com&agent=job-hunter')).toEqual({
      text: 'Is this worth applying to? https://x.com',
      agent: 'job-hunter'
    })
    expect(parseShareLink('natebot://share?text=hi')).toEqual({ text: 'hi' })
  })

  it('ignores other links and odd agent ids', () => {
    expect(parseShareLink('https://capture?text=x')).toBeNull()
    expect(parseShareLink('natebot://delete-everything')).toBeNull()
    expect(parseShareLink('natebot://capture?agent=../../x')).toEqual({})
  })
})
