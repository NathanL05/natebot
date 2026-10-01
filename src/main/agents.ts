// Agent configs as human-readable YAML files in ~/NateBot/agents/<id>.yaml.
// Edits made by hand are picked up automatically.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { DEFAULT_EFFORT, EFFORTS } from '@shared/types'
import type { AgentConfig, AgentDraft, EffortLevel, MascotShape, ModelId, Routine } from '@shared/types'
import { MASCOT_SHAPES } from '@shared/mascot'
import { STARTER_AGENTS } from './starters'

const MODELS: ModelId[] = ['sonnet', 'haiku', 'opus']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const HEADER =
  '# NateBot agent. Edit here or in the app; changes are picked up automatically.\n' +
  '# model: sonnet | haiku | opus   effort: low | medium | high | xhigh | max\n' +
  '# routine.cron: minute hour day month weekday\n' +
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

function normalizeRoutine(v: unknown): Routine | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const cron = str(r['cron']).trim()
  if (!cron) return null
  return { enabled: r['enabled'] === true, cron, prompt: str(r['prompt']) }
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
    routine: normalizeRoutine(r['routine']),
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
    routine: a.routine,
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
    const agent = normalize({ ...next, session_id: current.session_id }, current.id)
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
