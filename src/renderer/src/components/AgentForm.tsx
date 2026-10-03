import { useMemo, useState, type ReactNode } from 'react'
import { EFFORTS, MAX_ROUTINES, MODELS, type AgentDraft, type EffortLevel, type McpServerInfo, type ModelId, type Routine } from '@shared/types'
import { splitToolRules } from '@shared/toolRules'
import { MASCOT_COLORS, MASCOT_SHAPES, mascotDataUrl, seededColor, seededShape } from '@shared/mascot'
import { Avatar } from './Avatar'
import { ChevronIcon, PlusIcon, TrashIcon } from './icons'
import { isValidCron, SchedulePicker } from './SchedulePicker'
import { Button, Field, IconButton, inputBase, inputClass, Segmented, Toggle } from './ui'

export function blankDraft(model: ModelId, effort: EffortLevel): AgentDraft {
  return {
    name: '',
    shape: null,
    color: seededColor(''),
    model,
    effort,
    instructions: '',
    mcp_servers: [],
    allowed_tools: [],
    disallowed_tools: [],
    routines: []
  }
}

/** Returns a list of problems; empty means the draft can be saved. */
export function validateDraft(d: AgentDraft): string[] {
  const problems: string[] = []
  if (!d.name.trim()) problems.push('Give the agent a name.')
  const on = d.routines.filter((r) => r.enabled)
  if (on.some((r) => !isValidCron(r.cron))) problems.push('A routine schedule is not valid.')
  if (on.some((r) => !r.prompt.trim())) problems.push('Tell each routine what to do.')
  return problems
}


export function AgentForm({
  draft,
  onChange,
  mcpServers,
  avatar
}: {
  draft: AgentDraft
  onChange: (d: AgentDraft) => void
  mcpServers: McpServerInfo[]
  /** Replaces the plain avatar preview (e.g. with an uploadable one). */
  avatar?: ReactNode
}) {
  const [advanced, setAdvanced] = useState(draft.allowed_tools.length > 0 || draft.disallowed_tools.length > 0)
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]): void => onChange({ ...draft, [key]: value })

  const unconfigured = draft.mcp_servers.filter((name) => !mcpServers.find((s) => s.name === name)?.configured)
  const knownNames = new Set(mcpServers.map((s) => s.name))
  const allServers: McpServerInfo[] = [
    ...mcpServers,
    ...draft.mcp_servers.filter((n) => !knownNames.has(n)).map((name) => ({ name, configured: false }))
  ]

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="flex items-start gap-4">
        {avatar ?? <Avatar seed={draft.name} shape={draft.shape} color={draft.color} size={64} />}
        <div className="flex-1 space-y-3">
          <Field label="Name">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Email Agent"
              autoFocus
            />
          </Field>
          <ShapePicker draft={draft} onPick={(shape) => set('shape', shape)} />
          <div className="flex items-center gap-1.5">
            {MASCOT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                className={`h-6 w-6 rounded-full transition ${draft.color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      <Field label="Model" hint={MODELS.find((m) => m.id === draft.model)?.hint}>
        <Segmented
          value={draft.model}
          onChange={(v) => set('model', v)}
          options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </Field>

      <Field label="Effort" hint={EFFORTS.find((e) => e.id === draft.effort)?.hint}>
        <Segmented<EffortLevel>
          value={draft.effort}
          onChange={(v) => set('effort', v)}
          options={EFFORTS.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Field>

      <Field label="Instructions" hint="What this agent does and how. NateBot's house style is added automatically.">
        <textarea
          className={`${inputClass} min-h-[150px] resize-y leading-relaxed`}
          value={draft.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          placeholder="You review my inbox every morning and…"
        />
      </Field>

      <Field label="Connected tools (MCP servers)">
        {allServers.length === 0 ? (
          <div className="text-[13px] text-muted">No MCP servers in ~/NateBot/mcp.json yet.</div>
        ) : (
          <div className="space-y-1.5">
            {allServers.map((s) => {
              const on = draft.mcp_servers.includes(s.name)
              return (
                <label key={s.name} className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-elev px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={on}
                    onChange={() =>
                      set('mcp_servers', on ? draft.mcp_servers.filter((n) => n !== s.name) : [...draft.mcp_servers, s.name])
                    }
                  />
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="truncate text-[12px] text-muted">{s.description}</span>
                  {!s.configured && <span className="ml-auto shrink-0 text-[11px] font-medium text-warn">Not set up</span>}
                </label>
              )
            })}
          </div>
        )}
        {unconfigured.length > 0 && (
          <div className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
            {unconfigured.includes('gmail') ? 'Connect Gmail' : `Set up ${unconfigured.join(', ')}`} to use this. See “Connecting Gmail” in the
            README. Until then the agent runs without it.
          </div>
        )}
      </Field>

      <RoutinesEditor routines={draft.routines} onChange={(routines) => set('routines', routines)} />

      {/* Advanced */}
      <div>
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg"
        >
          <ChevronIcon size={12} className={`transition-transform ${advanced ? 'rotate-90' : ''}`} />
          Advanced tool permissions
        </button>
        {advanced && (
          <div className="mt-3 space-y-3">
            <Field label="Always allowed tools" hint="Space or comma separated, e.g. WebSearch Bash(git status:*)">
              <input
                className={`${inputClass} font-mono text-[12px]`}
                defaultValue={draft.allowed_tools.join(' ')}
                onBlur={(e) => set('allowed_tools', splitToolRules(e.target.value))}
              />
            </Field>
            <Field label="Never allowed tools" hint="Blocked even if a server offers them, e.g. mcp__gmail__send_message">
              <input
                className={`${inputClass} font-mono text-[12px]`}
                defaultValue={draft.disallowed_tools.join(' ')}
                onBlur={(e) => set('disallowed_tools', splitToolRules(e.target.value))}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Auto" (derived from the name) plus one preview per mascot shape. */
function ShapePicker({ draft, onPick }: { draft: AgentDraft; onPick: (shape: AgentDraft['shape']) => void }) {
  const previews = useMemo(
    () => MASCOT_SHAPES.map((shape) => ({ shape, src: mascotDataUrl(draft.name, { shape, color: draft.color }) })),
    [draft.name, draft.color]
  )
  const auto = seededShape(draft.name)
  const tile = (active: boolean): string =>
    `flex h-9 w-9 items-center justify-center rounded-lg transition ${active ? 'bg-selected ring-1 ring-accent' : 'hover:bg-hover'}`
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Avatar shape">
      <button
        type="button"
        role="radio"
        aria-checked={draft.shape === null}
        onClick={() => onPick(null)}
        className={`${tile(draft.shape === null)} w-auto px-2 text-[11px] font-medium text-muted`}
        title={`Auto: picked from the name (currently ${auto})`}
      >
        Auto
      </button>
      {previews.map(({ shape, src }) => (
        <button
          key={shape}
          type="button"
          role="radio"
          aria-checked={draft.shape === shape}
          onClick={() => onPick(shape)}
          className={tile(draft.shape === shape)}
          title={shape}
        >
          <img src={src} alt={shape} className="h-7 w-7" draggable={false} />
        </button>
      ))}
    </div>
  )
}

/** A fresh id, never reused, so a new routine doesn't inherit a removed one's run history. */
function newRoutineId(routines: Routine[]): string {
  for (;;) {
    const id = `r${Math.random().toString(36).slice(2, 8)}`
    if (!routines.some((r) => r.id === id)) return id
  }
}

/** An agent's scheduled runs: several are fine, e.g. a morning and an evening inbox sweep. */
function RoutinesEditor({ routines, onChange }: { routines: Routine[]; onChange: (routines: Routine[]) => void }) {
  const update = (id: string, patch: Partial<Routine>): void => onChange(routines.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = (): void => onChange([...routines, { id: newRoutineId(routines), enabled: true, cron: '0 8 * * 1-5', prompt: '' }])

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[14px] font-medium">Routines</div>
          <div className="text-[12px] text-muted">Run this agent automatically on a schedule. Add several for different times.</div>
        </div>
        {routines.length < MAX_ROUTINES && (
          <Button variant="ghost" onClick={add}>
            <PlusIcon size={13} /> Add
          </Button>
        )}
      </div>
      {routines.map((r, i) => (
        <div key={r.id} className={`mt-4 space-y-3 ${i > 0 ? 'border-t border-line pt-4' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-[13px] font-medium">{routines.length > 1 ? `Routine ${i + 1}` : 'Routine'}</div>
            <Toggle label={`Routine ${i + 1} enabled`} checked={r.enabled} onChange={(enabled) => update(r.id, { enabled })} />
            <IconButton label={`Remove routine ${i + 1}`} onClick={() => onChange(routines.filter((x) => x.id !== r.id))}>
              <TrashIcon size={14} />
            </IconButton>
          </div>
          <div className={r.enabled ? 'space-y-3' : 'space-y-3 opacity-60'}>
            <SchedulePicker cron={r.cron} onChange={(cron) => update(r.id, { cron })} />
            <Field label="What should it do each time?">
              <textarea
                className={`${inputClass} min-h-[70px] resize-y`}
                value={r.prompt}
                onChange={(e) => update(r.id, { prompt: e.target.value })}
                placeholder="Do my morning inbox sweep."
              />
            </Field>
          </div>
        </div>
      ))}
    </div>
  )
}
