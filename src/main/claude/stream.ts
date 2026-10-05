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
  /** What the run used, from the result event; null if claude didn't report it. */
  tokens: RunTokens | null
}

/** Token counts for one claude run (all API calls in it), plus claude's API-price estimate. */
export interface RunTokens {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  /** What the run would cost at API prices: a model-aware weight, not a bill. */
  costUsd: number | null
}

type Json = Record<string, unknown>

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function tokensOf(ev: Json): RunTokens | null {
  const u = ev['usage']
  if (!u || typeof u !== 'object') return null
  const usage = u as Json
  const cost = ev['total_cost_usd']
  return {
    input: count(usage['input_tokens']),
    cacheWrite: count(usage['cache_creation_input_tokens']),
    cacheRead: count(usage['cache_read_input_tokens']),
    output: count(usage['output_tokens']),
    costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null
  }
}

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
  /** How much the latest API call read (the conversation's current size), from its usage report. */
  contextTokens = 0

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
        const usage = ((ev['message'] ?? {}) as Json)['usage'] as Json | undefined
        if (usage) this.contextTokens = count(usage['input_tokens']) + count(usage['cache_read_input_tokens']) + count(usage['cache_creation_input_tokens'])
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
          permissionDenials: denials,
          tokens: tokensOf(ev)
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

// The closing fence is the one on its own line: a JSON string can't contain a raw newline,
// so a code fence written inside a task or an email body never ends the block early. The loose form is a fallback.
const ACTIONS_BLOCKS = [/```proposed_actions\s*([\s\S]*?)\n[ \t]*```/, /```proposed_actions\s*([\s\S]*?)```/]
const ACTIONS_START = '```proposed_actions'
const HANDOFF_BLOCKS = [/```handoff\s*([\s\S]*?)\n[ \t]*```/, /```handoff\s*([\s\S]*?)```/]
const HANDOFF_START = '```handoff'
const REMINDER_BLOCKS = [/```reminders\s*([\s\S]*?)\n[ \t]*```/, /```reminders\s*([\s\S]*?)```/]
const REMINDER_START = '```reminders'
const JOBS_BLOCKS = [/```jobs\s*([\s\S]*?)\n[ \t]*```/, /```jobs\s*([\s\S]*?)```/]
const JOBS_START = '```jobs'

/** Cuts the text at a block's opening fence, even a half-written one. */
function cutAt(text: string, ...starts: string[]): string {
  const found = starts.map((s) => text.indexOf(s)).filter((i) => i !== -1)
  return found.length ? text.slice(0, Math.min(...found)).trimEnd() : text
}

/** While streaming, hide proposed_actions, handoff and reminders blocks (even half-written ones). */
export function hideActionsBlock(text: string): string {
  return cutAt(text, ACTIONS_START, HANDOFF_START, REMINDER_START, JOBS_START)
}

const QUIET = '[quiet]'

/**
 * Routine and reminder runs start their reply with "[quiet]" when nothing needs the user,
 * so NateBot can skip the notification. Also hides a half-written marker while streaming.
 */
export function quietMarker(text: string): { quiet: boolean; text: string } {
  const lead = text.trimStart()
  if (lead.toLowerCase().startsWith(QUIET)) return { quiet: true, text: lead.slice(QUIET.length).trimStart() }
  if (lead && QUIET.startsWith(lead.toLowerCase())) return { quiet: false, text: '' }
  return { quiet: false, text }
}

/** Removes every NateBot block from a finished reply (group chats, which use none of them). */
export function stripBlocks(text: string): string {
  return extractJobs(extractReminders(extractHandoffs(extractActions(text).text).text).text).text
}

/** A handoff block as written by the agent. Targets are looked up by the caller. */
export interface ParsedHandoff {
  to: string
  task: string
}

export function extractHandoffs(text: string): { text: string; handoffs: ParsedHandoff[]; error: string | null } {
  const match = HANDOFF_BLOCKS.map((re) => re.exec(text)).find((m) => m !== null)
  if (!match) return { text: cutAt(text, HANDOFF_START), handoffs: [], error: null }
  const clean = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  try {
    const parsed = JSON.parse(match[1] ?? '[]') as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const handoffs = list
      .filter((h): h is Json => !!h && typeof h === 'object')
      .filter((h) => typeof h['to'] === 'string' && typeof h['task'] === 'string')
      .map((h) => ({ to: String(h['to']), task: String(h['task']) }))
    return { text: clean, handoffs, error: null }
  } catch {
    return { text: clean, handoffs: [], error: 'The agent proposed a handoff but its format was invalid, so it was ignored.' }
  }
}

/** A reminders block entry as written by the agent. Times are checked by the caller. */
export interface ParsedReminder {
  at: string
  kind: 'message' | 'task'
  text: string
  repeat?: string
}

export function extractReminders(text: string): { text: string; reminders: ParsedReminder[]; error: string | null } {
  const match = REMINDER_BLOCKS.map((re) => re.exec(text)).find((m) => m !== null)
  if (!match) return { text: cutAt(text, REMINDER_START), reminders: [], error: null }
  const clean = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  try {
    const parsed = JSON.parse(match[1] ?? '[]') as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const reminders = list
      .filter((r): r is Json => !!r && typeof r === 'object' && typeof r['at'] === 'string')
      .flatMap((r): ParsedReminder[] => {
        const at = String(r['at'])
        const repeat = typeof r['repeat'] === 'string' ? { repeat: r['repeat'] } : {}
        if (typeof r['task'] === 'string' && r['task'].trim()) return [{ at, kind: 'task', text: r['task'].trim(), ...repeat }]
        if (typeof r['message'] === 'string' && r['message'].trim()) return [{ at, kind: 'message', text: r['message'].trim(), ...repeat }]
        return []
      })
    return { text: clean, reminders, error: null }
  } catch {
    return { text: clean, reminders: [], error: 'The agent tried to set a reminder but its format was invalid, so it was ignored.' }
  }
}

/** A ```jobs block: job-tracker entries as the agent wrote them (checked by the caller). */
export function extractJobs(text: string): { text: string; jobs: Json[]; error: string | null } {
  const match = JOBS_BLOCKS.map((re) => re.exec(text)).find((m) => m !== null)
  if (!match) return { text: cutAt(text, JOBS_START), jobs: [], error: null }
  const clean = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  try {
    const parsed = JSON.parse(match[1] ?? '[]') as unknown
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return { text: clean, jobs: list.filter((j): j is Json => !!j && typeof j === 'object'), error: null }
  } catch {
    return { text: clean, jobs: [], error: 'The agent tried to update the job tracker but its format was invalid, so it was ignored.' }
  }
}

export function extractActions(text: string): { text: string; actions: ProposedAction[]; error: string | null } {
  const match = ACTIONS_BLOCKS.map((re) => re.exec(text)).find((m) => m !== null)
  if (!match) return { text: cutAt(text, ACTIONS_START), actions: [], error: null }
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
