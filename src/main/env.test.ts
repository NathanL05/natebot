import { afterEach, describe, expect, it, vi } from 'vitest'
import { childEnv } from './env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('childEnv', () => {
  it('removes API keys and parent Claude Code variables so claude uses the subscription login', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://example.com')
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli')
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/Users/me/.claude')
    vi.stubEnv('LANG', 'en_GB.UTF-8')

    const env = childEnv()
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE']) {
      expect(env).not.toHaveProperty(k)
    }
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/Users/me/.claude')
    expect(env['LANG']).toBe('en_GB.UTF-8')
    expect(env['PATH']).toBeTruthy()
  })
})
