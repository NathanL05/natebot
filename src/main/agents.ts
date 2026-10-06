// Agent configs as human-readable YAML files in ~/NateBot/agents/<id>.yaml.
// Edits made by hand are picked up automatically.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { DEFAULT_EFFORT, EFFORTS, MAX_EMAIL_TRIGGERS, MAX_QUICK_PROMPTS, MAX_READ_FOLDERS, MAX_ROUTINES, MAX_WEB_WATCHES, WATCH_INTERVALS } from '@shared/types'
import type { AgentConfig, AgentDraft, EffortLevel, EmailTrigger, MascotShape, ModelId, Routine, WebWatch } from '@shared/types'
import { MASCOT_SHAPES } from '@shared/mascot'
import { STARTER_AGENTS } from './starters'

const MODELS: ModelId[] = ['sonnet', 'haiku', 'opus']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const HEADER =
  '# NateBot agent. Edit here or in the app; changes are picked up automatically.\n' +
  '# model: sonnet | haiku | opus   effort: low | medium | high | xhigh | max\n' +
  '# routines: id, enabled, cron (minute hour day month weekday), prompt; up to 20\n' +
  '# web_watches: id, enabled, url, every (hours: 1 | 3 | 6 | 24), match (words, optional), prompt; up to 3\n' +
  '# auto_approve: approval-only tools (mcp__server__tool) approved without asking\n' +
  '# shape: blob | circle | square | hexagon | triangle | pill | cloud  (null = picked from the name)\n'

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'agent'
  )
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []

const ROUTINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * `routines` (a list), or the single `routine` older files have. Routines without a
 * usable id get one from their position, and the first is "main", so an older file's
 * routine keeps its catch-up checkpoint and run history.
 */
export function normalizeRoutines(list: unknown, legacy: unknown): Routine[] {
  const raw: unknown[] = Array.isArray(list) ? list : legacy ? [legacy] : []
  const out: Routine[] = []
  raw.forEach((v, i) => {
    if (!v || typeof v !== 'object' || out.length >= MAX_ROUTINES) return
    const r = v as Record<string, unknown>
    const cron = str(r['cron']).trim()
    if (!cron) return
    let id = typeof r['id'] === 'string' && ROUTINE_ID_RE.test(r['id']) ? r['id'] : i === 0 ? 'main' : `r${i + 1}`
    while (out.some((o) => o.id === id)) id = `${id}-2`
    out.push({ id, enabled: r['enabled'] === true, cron, prompt: str(r['prompt']) })
  })
  return out
}

/** Up to MAX_QUICK_PROMPTS distinct one-line prompts. Starter agents from before this existed get their defaults. */
function normalizeQuickPrompts(v: unknown, id: string): string[] {
  if (v === undefined) return [...(STARTER_AGENTS.find((s) => s.id === id)?.quick_prompts ?? [])]
  const list = strList(v).map((p) => p.replace(/\s+/g, ' ').slice(0, 300))
  return [...new Set(list)].slice(0, MAX_QUICK_PROMPTS)
}

export function normalizeTriggers(v: unknown): EmailTrigger[] {
  const out: EmailTrigger[] = []
  for (const [i, t] of (Array.isArray(v) ? v : []).entries()) {
    if (!t || typeof t !== 'object' || out.length >= MAX_EMAIL_TRIGGERS) continue
    const r = t as Record<string, unknown>
    const query = str(r['query']).replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!query) continue
    let id = typeof r['id'] === 'string' && ROUTINE_ID_RE.test(r['id']) ? r['id'] : `t${i + 1}`
    while (out.some((o) => o.id === id)) id = `${id}-2`
    out.push({ id, enabled: r['enabled'] === true, query, prompt: str(r['prompt']).trim().slice(0, 2000) })
  }
  return out
}

export function normalizeWatches(v: unknown): WebWatch[] {
  const out: WebWatch[] = []
  for (const [i, w] of (Array.isArray(v) ? v : []).entries()) {
    if (!w || typeof w !== 'object' || out.length >= MAX_WEB_WATCHES) continue
    const r = w as Record<string, unknown>
    const url = str(r['url']).trim().slice(0, 500)
    if (!/^https?:\/\/\S+$/i.test(url)) continue
    let id = typeof r['id'] === 'string' && ROUTINE_ID_RE.test(r['id']) ? r['id'] : `w${i + 1}`
    while (out.some((o) => o.id === id)) id = `${id}-2`
    const every = WATCH_INTERVALS.includes(r['every'] as 1) ? (r['every'] as number) : 6
    out.push({ id, enabled: r['enabled'] === true, url, every, match: str(r['match']).replace(/\s+/g, ' ').trim().slice(0, 200), prompt: str(r['prompt']).trim().slice(0, 2000) })
  }
  return out
}

/** Absolute folder paths (~ expanded), without commas (they'd split a tool rule), deduplicated. */
export function normalizeFolders(v: unknown): string[] {
  const home = process.env['HOME'] ?? ''
  const paths = strList(v)
    .map((p) => (p.startsWith('~/') && home ? `${home}${p.slice(1)}` : p).replace(/\/+$/, ''))
    .filter((p) => p.startsWith('/') && p.length > 1 && !p.includes(','))
  return [...new Set(paths)].slice(0, MAX_READ_FOLDERS)
}

function normalizeShape(v: unknown, id: string): MascotShape | null {
  if (MASCOT_SHAPES.includes(v as MascotShape)) return v as MascotShape
  // Starter agents created before shapes existed keep their designed look.
  return STARTER_AGENTS.find((s) => s.id === id)?.shape ?? null
}

/** Accepts whatever is in a YAML file and returns a valid config. */
export function normalize(raw: unknown, id: string): AgentConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const model = str(r['model']) as ModelId
  return {
    id,
    name: str(r['name']).trim() || id,
    shape: normalizeShape(r['shape'], id),
    color: /^#[0-9a-f]{6}$/i.test(str(r['color'])) ? str(r['color']) : '#5E8BFF',
    model: MODELS.includes(model) ? model : 'sonnet',
    effort: EFFORTS.some((e) => e.id === r['effort']) ? (r['effort'] as EffortLevel) : DEFAULT_EFFORT,
    instructions: str(r['instructions']).trim(),
    mcp_servers: strList(r['mcp_servers']),
    allowed_tools: strList(r['allowed_tools']),
    disallowed_tools: strList(r['disallowed_tools']),
    quick_prompts: normalizeQuickPrompts(r['quick_prompts'], id),
    routines: normalizeRoutines(r['routines'], r['routine']),
    email_triggers: normalizeTriggers(r['email_triggers']),
    read_folders: normalizeFolders(r['read_folders']),
    auto_approve: [...new Set(strList(r['auto_approve']).filter((t) => /^mcp__[^_].*__.+$/.test(t)))],
    web_watches: normalizeWatches(r['web_watches']),
    session_id: typeof r['session_id'] === 'string' && r['session_id'] ? r['session_id'] : null
  }
}

function serialize(a: AgentConfig): string {
  // Key order matches the documented format.
  const doc = {
    id: a.id,
    name: a.name,
    shape: a.shape,
    color: a.color,
    model: a.model,
    effort: a.effort,
    instructions: a.instructions.endsWith('\n') ? a.instructions : `${a.instructions}\n`,
    mcp_servers: a.mcp_servers,
    allowed_tools: a.allowed_tools,
    disallowed_tools: a.disallowed_tools,
    quick_prompts: a.quick_prompts,
    routines: a.routines,
    email_triggers: a.email_triggers,
    read_folders: a.read_folders,
    ...(a.auto_approve?.length ? { auto_approve: a.auto_approve } : {}),
    ...(a.web_watches?.length ? { web_watches: a.web_watches } : {}),
    session_id: a.session_id
  }
  return HEADER + stringify(doc, { lineWidth: 0, blockQuote: 'literal' })
}

export class AgentStore extends EventEmitter {
  private agents = new Map<string, AgentConfig>()
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | undefined

  constructor(private dir: string) {
    super()
  }

  /** Loads agents; seeds the starter agents on first launch. Returns true if seeded. */
  init(): boolean {
    const firstLaunch = !existsSync(this.dir)
    mkdirSync(this.dir, { recursive: true })
    if (firstLaunch) for (const a of STARTER_AGENTS) this.write(structuredClone(a))
    this.load()
    this.watcher = watch(this.dir, () => {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        if (this.load()) this.emit('changed')
      }, 250)
    })
    return firstLaunch
  }

  close(): void {
    this.watcher?.close()
  }

  /** Re-reads every file. Returns true if anything changed. */
  private load(): boolean {
    const next = new Map<string, AgentConfig>()
    for (const file of readdirSync(this.dir)) {
      const m = /^(.+)\.ya?ml$/.exec(file)
      if (!m || !ID_RE.test(m[1] ?? '')) continue
      const id = m[1] as string
      try {
        next.set(id, normalize(parse(readFileSync(join(this.dir, file), 'utf8')), id))
      } catch (e) {
        // Keep the last good version of a file that is mid-edit or broken.
        const prev = this.agents.get(id)
        if (prev) next.set(id, prev)
        console.warn(`[agents] could not read ${file}: ${(e as Error).message}`)
      }
    }
    const changed = JSON.stringify([...next]) !== JSON.stringify([...this.agents])
    this.agents = next
    return changed
  }

  private write(a: AgentConfig): void {
    writeFileSync(join(this.dir, `${a.id}.yaml`), serialize(a))
    this.agents.set(a.id, a)
  }

  list(): AgentConfig[] {
    return [...this.agents.values()]
  }

  get(id: string): AgentConfig | undefined {
    return this.agents.get(id)
  }

  require(id: string): AgentConfig {
    const a = this.agents.get(id)
    if (!a) throw new Error(`Unknown agent: ${id}`)
    return a
  }

  create(draft: AgentDraft): AgentConfig {
    const base = slugify(draft.name)
    let id = base
    for (let n = 2; this.agents.has(id) || existsSync(join(this.dir, `${id}.yaml`)); n++) id = `${base}-${n}`
    const agent = normalize({ ...draft, session_id: null }, id)
    this.write(agent)
    return agent
  }

  update(next: AgentConfig): AgentConfig {
    const current = this.require(next.id)
    // An update that leaves out the Always allow rules keeps them (only removing them in the form clears them).
    const agent = normalize(
      {
        ...next,
        auto_approve: next.auto_approve ?? current.auto_approve,
        web_watches: next.web_watches ?? current.web_watches,
        session_id: current.session_id
      },
      current.id
    )
    this.write(agent)
    return agent
  }

  setSession(id: string, sessionId: string | null): void {
    const a = this.agents.get(id)
    if (!a || a.session_id === sessionId) return
    this.write({ ...a, session_id: sessionId })
  }

  delete(id: string): void {
    this.require(id)
    this.agents.delete(id)
    for (const ext of ['yaml', 'yml']) {
      const file = join(this.dir, `${id}.${ext}`)
      if (existsSync(file)) unlinkSync(file)
    }
  }
}
