import { describe, expect, it } from 'vitest'
import { extractActions, extractHandoffs, hideActionsBlock, StreamState } from './stream'

const block = (json: string): string => `Here's a draft.\n\n\`\`\`proposed_actions\n${json}\n\`\`\``

describe('proposed actions', () => {
  it('parses a valid block and removes it from the text', () => {
    const { text, actions, error } = extractActions(
      block('[{"type":"send_email","summary":"Reply to Sarah","tool":"mcp__gmail__send_gmail_message","details":{"to":"s@x.com"}}]')
    )
    expect(text).toBe("Here's a draft.")
    expect(error).toBeNull()
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'send_email',
      summary: 'Reply to Sarah',
      tool: 'mcp__gmail__send_gmail_message',
      details: { to: 's@x.com' },
      status: 'pending'
    })
  })

  it('accepts a single object instead of a list', () => {
    expect(extractActions(block('{"summary":"Archive it"}')).actions).toHaveLength(1)
  })

  it('drops actions without a summary and fills safe defaults', () => {
    const { actions } = extractActions(block('[{"type":"x"},{"summary":"  "},{"summary":"Do it","details":"nope","tool":5}]'))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'action', summary: 'Do it', details: {} })
    expect(actions[0]?.tool).toBeUndefined()
  })

  it('reports invalid JSON instead of guessing', () => {
    const { text, actions, error } = extractActions(block('[{"summary": oops}]'))
    expect(actions).toEqual([])
    expect(error).toMatch(/invalid/)
    expect(text).toBe("Here's a draft.")
  })

  it('hides a half-written block while streaming', () => {
    expect(hideActionsBlock('Draft ready.\n```proposed_actions\n[{"summ')).toBe('Draft ready.')
    expect(extractActions('Draft ready.\n```proposed_actions\n[{"summ').text).toBe('Draft ready.')
  })
})

describe('StreamState', () => {
  it('tracks the session, streamed text, tool calls and the result', () => {
    const s = new StreamState()
    s.handle({ type: 'system', subtype: 'init', session_id: 'sess-1' })
    expect(s.sessionId).toBe('sess-1')

    s.handle({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } })
    s.handle({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Look' } } })
    s.handle({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ing…' } } })
    expect(s.text).toBe('Looking…')

    s.handle({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Looking…' },
          { type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'weather' } },
          { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'notes.md' } }
        ]
      }
    })
    expect(s.text).toBe('Looking…')
    expect(s.tools.map((t) => [t.name, t.summary, t.status])).toEqual([
      ['WebSearch', 'weather', 'running'],
      ['Read', 'notes.md', 'running']
    ])

    s.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } })
    expect(s.tools[0]?.status).toBe('error')

    s.handle({ type: 'result', subtype: 'success', result: 'Done', session_id: 'sess-2', permission_denials: [{}, {}] })
    expect(s.result).toEqual({ isError: false, subtype: 'success', text: 'Done', permissionDenials: 2, tokens: null })
    expect(s.sessionId).toBe('sess-2')
    // A tool that never reported back is closed out with the run.
    expect(s.tools[1]?.status).toBe('done')
  })

  it('treats a non-success result as an error', () => {
    const s = new StreamState()
    s.handle({ type: 'result', subtype: 'error_max_turns', is_error: false })
    expect(s.result?.isError).toBe(true)
  })

  it('keeps rate-limit info', () => {
    const s = new StreamState()
    s.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 123 } })
    expect(s.rateLimit).toEqual({ status: 'rejected', resetsAt: 123 })
  })
})

describe('run tokens', () => {
  const result = (extra: Record<string, unknown>): Record<string, unknown> => ({ type: 'result', subtype: 'success', is_error: false, result: 'ok', ...extra })

  it('reads the token counts and estimated cost from the result event', () => {
    const state = new StreamState()
    state.handle(
      result({
        usage: { input_tokens: 10, cache_creation_input_tokens: 5000, cache_read_input_tokens: 6000, output_tokens: 300 },
        total_cost_usd: 0.0421
      })
    )
    expect(state.result?.tokens).toEqual({ input: 10, cacheWrite: 5000, cacheRead: 6000, output: 300, costUsd: 0.0421 })
  })

  it('matches a real two-call run: the result totals every API call', () => {
    // Captured from `claude -p` (Haiku, one Read tool call = two API calls).
    const state = new StreamState()
    state.handle(
      result({
        num_turns: 2,
        usage: { input_tokens: 18, cache_creation_input_tokens: 34161, cache_read_input_tokens: 33942, output_tokens: 215 },
        total_cost_usd: 0.0728092
      })
    )
    expect(state.result?.tokens).toEqual({ input: 18, cacheWrite: 34161, cacheRead: 33942, output: 215, costUsd: 0.0728092 })
  })

  it('is null when claude reports no usage, and ignores bad numbers', () => {
    const none = new StreamState()
    none.handle(result({}))
    expect(none.result?.tokens).toBeNull()

    const odd = new StreamState()
    odd.handle(result({ usage: { input_tokens: 'many', output_tokens: -5 }, total_cost_usd: 'free' }))
    expect(odd.result?.tokens).toEqual({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0, costUsd: null })
  })
})

describe('handoff blocks', () => {
  const handoff = '```handoff\n[{"to":"Planner","task":"Plan Friday"}]\n```'

  it('parses a handoff and removes it from the text', () => {
    const r = extractHandoffs(`Sarah needs it Friday.\n\n${handoff}`)
    expect(r.text).toBe('Sarah needs it Friday.')
    expect(r.handoffs).toEqual([{ to: 'Planner', task: 'Plan Friday' }])
    expect(r.error).toBeNull()
  })

  it('reports a block it cannot read, and still removes it', () => {
    const r = extractHandoffs('Hi\n\n```handoff\nnot json\n```')
    expect(r.text).toBe('Hi')
    expect(r.handoffs).toEqual([])
    expect(r.error).toContain('invalid')
  })

  it('works alongside proposed actions, in either order', () => {
    const actions = '```proposed_actions\n[{"type":"send_email","summary":"Reply","details":{}}]\n```'
    for (const text of [`Done.\n\n${actions}\n\n${handoff}`, `Done.\n\n${handoff}\n\n${actions}`]) {
      const a = extractActions(text)
      const h = extractHandoffs(a.text)
      expect(a.actions).toHaveLength(1)
      expect(h.handoffs).toHaveLength(1)
      expect(h.text).toBe('Done.')
    }
  })

  it('hides either block while streaming, even half-written', () => {
    expect(hideActionsBlock('Hello\n\n```handoff\n[{"to":"Pla')).toBe('Hello')
    expect(hideActionsBlock('Hello\n\n```proposed_actions\n[')).toBe('Hello')
    expect(hideActionsBlock('Hello')).toBe('Hello')
  })

  it('does not lose a handoff when extracting actions from a reply that has none', () => {
    expect(extractActions(`Hi\n\n${handoff}`).text).toContain('```handoff')
  })
})
