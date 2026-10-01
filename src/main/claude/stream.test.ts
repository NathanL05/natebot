import { describe, expect, it } from 'vitest'
import { extractActions, hideActionsBlock, StreamState } from './stream'

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
    expect(s.result).toEqual({ isError: false, subtype: 'success', text: 'Done', permissionDenials: 2 })
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
