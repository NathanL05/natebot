// Turns claude's stream-json events into chat state: streamed text, compact
// tool-use lines, the session id, rate-limit info and the final result.
import { randomUUID } from 'node:crypto'
import type { ProposedAction, ToolUse } from '@shared/types'

export interface RateLimitInfo {
  status?: string
  resetsAt?: number
  rateLimitType?: string
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>
}

export interface RunResult {
  isError: boolean
  subtype: string
  text: string
  permissionDenials: number
}

type Json = Record<string, unknown>

const join = (a: string, b: string): string => (a && b ? `${a}\n\n${b}` : a || b)

/** A short, human-readable summary of a tool call's input (never the raw JSON). */
function summarizeInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const obj = input as Json
  for (const key of ['query', 'q', 'url', 'file_path', 'path', 'pattern', 'subject', 'to', 'id', 'thread_id', 'message_id', 'command']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.length > 80 ? `${v.slice(0, 77)}…` : v
  }
  const firstString = Object.values(obj).find((v): v is string => typeof v === 'string' && v.trim() !== '')
  return firstString ? (firstString.length > 80 ? `${firstString.slice(0, 77)}…` : firstString) : undefined
}

export class StreamState {
  private committed = ''
  private partial = ''
  tools: ToolUse[] = []
  sessionId: string | null = null
  rateLimit: RateLimitInfo | null = null
  result: RunResult | null = null

  get text(): string {
    return join(this.committed, this.partial)
  }

  /** Returns true when something visible changed. */
  handle(ev: Json): boolean {
    switch (ev['type']) {
      case 'system':
        if (ev['subtype'] === 'init' && typeof ev['session_id'] === 'string') this.sessionId = ev['session_id']
        return false

      case 'stream_event': {
        const e = (ev['event'] ?? {}) as Json
        if (e['type'] === 'content_block_start') {
          const block = (e['content_block'] ?? {}) as Json
          if (block['type'] === 'text') this.partial = ''
          if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
            this.upsertTool(block['id'], String(block['name'] ?? 'tool'), undefined)
            return true
          }
          return false
        }
        if (e['type'] === 'content_block_delta') {
          const delta = (e['delta'] ?? {}) as Json
          if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            this.partial += delta['text']
            return true
          }
        }
        return false
      }

      case 'assistant': {
        const content = (((ev['message'] ?? {}) as Json)['content'] ?? []) as Json[]
        let changed = false
        for (const block of content) {
          if (block['type'] === 'text' && typeof block['text'] === 'string') {
            this.committed = join(this.committed, block['text'])
            this.partial = ''
            changed = true
          } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
            this.upsertTool(block['id'], String(block['name'] ?? 'tool'), summarizeInput(block['input']))
            changed = true
          }
        }
        return changed
      }

      case 'user': {
        const content = (((ev['message'] ?? {}) as Json)['content'] ?? []) as Json[]
        let changed = false
        if (!Array.isArray(content)) return false
        for (const block of content) {
          if (block['type'] !== 'tool_result') continue
          const tool = this.tools.find((t) => t.id === block['tool_use_id'])
          if (tool) {
            tool.status = block['is_error'] === true ? 'error' : 'done'
            changed = true
          }
        }
        return changed
      }

      case 'rate_limit_event':
        this.rateLimit = (ev['rate_limit_info'] ?? null) as RateLimitInfo | null
        return false

      case 'result': {
        const denials = Array.isArray(ev['permission_denials']) ? ev['permission_denials'].length : 0
        this.result = {
          isError: ev['is_error'] === true || ev['subtype'] !== 'success',
          subtype: String(ev['subtype'] ?? ''),
          text: typeof ev['result'] === 'string' ? ev['result'] : '',
          permissionDenials: denials
        }
        if (typeof ev['session_id'] === 'string') this.sessionId = ev['session_id']
        // Anything still "running" at the end didn't report back.
        for (const t of this.tools) if (t.status === 'running') t.status = this.result.isError ? 'error' : 'done'
        return true
      }

      default:
        return false
    }
  }

  private upsertTool(id: string, name: string, summary: string | undefined): void {
    const existing = this.tools.find((t) => t.id === id)
    if (existing) {
      existing.name = name
      if (summary) existing.summary = summary
    } else {
      this.tools.push({ id, name, summary, status: 'running' })
    }
  }
}

// ---- proposed actions ----

const ACTIONS_BLOCK = /```proposed_actions\s*([\s\S]*?)```/
const ACTIONS_START = '```proposed_actions'

/** While streaming, hide a proposed_actions block (even a half-written one). */
export function hideActionsBlock(text: string): string {
  const i = text.indexOf(ACTIONS_START)
  return i === -1 ? text : text.slice(0, i).trimEnd()
}

export function extractActions(text: string): { text: string; actions: ProposedAction[]; error: string | null } {
  const match = ACTIONS_BLOCK.exec(text)
  if (!match) return { text: hideActionsBlock(text), actions: [], error: null }
  const clean = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  try {
    const parsed = JSON.parse(match[1] ?? '[]') as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const actions: ProposedAction[] = list
      .filter((a): a is Json => !!a && typeof a === 'object')
      .filter((a) => typeof a['summary'] === 'string' && a['summary'].trim() !== '')
      .map((a) => ({
        id: randomUUID(),
        type: typeof a['type'] === 'string' ? a['type'] : 'action',
        summary: String(a['summary']),
        tool: typeof a['tool'] === 'string' ? a['tool'] : undefined,
        details: a['details'] && typeof a['details'] === 'object' ? (a['details'] as Json) : {},
        status: 'pending' as const
      }))
    return { text: clean, actions, error: null }
  } catch {
    return { text: clean, actions: [], error: 'The agent proposed an action but its format was invalid, so it was ignored.' }
  }
}
