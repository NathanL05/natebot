import { useState } from 'react'
import { MODELS, type AgentDraft, type McpServerInfo, type ModelId } from '@shared/types'
import { Avatar } from './Avatar'
import { ChevronIcon } from './icons'
import { isValidCron, SchedulePicker } from './SchedulePicker'
import { Field, inputBase, inputClass, Segmented, Toggle } from './ui'

export const EMOJIS = ['🤖', '📧', '🗓️', '🔎', '✍️', '💡', '📈', '🧾', '🛒', '🏋️', '🎵', '🌍', '🧠', '📚', '💬', '🛠️']
export const COLORS = ['#F5A524', '#FF6B6B', '#FF5FA2', '#A06CFF', '#5E8BFF', '#2EC5FF', '#30D158', '#8E8E93']

export function blankDraft(model: ModelId): AgentDraft {
  return {
    name: '',
    icon: '🤖',
    color: COLORS[Math.floor(Math.random() * (COLORS.length - 1))] ?? '#5E8BFF',
    model,
    instructions: '',
    mcp_servers: [],
    allowed_tools: [],
    disallowed_tools: [],
    routine: null
  }
}

/** Returns a list of problems; empty means the draft can be saved. */
export function validateDraft(d: AgentDraft): string[] {
  const problems: string[] = []
  if (!d.name.trim()) problems.push('Give the agent a name.')
  if (d.routine?.enabled) {
    if (!isValidCron(d.routine.cron)) problems.push('The routine schedule is not valid.')
    if (!d.routine.prompt.trim()) problems.push('Tell the routine what to do.')
  }
  return problems
}

const splitList = (s: string): string[] =>
  s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)

export function AgentForm({
  draft,
  onChange,
  mcpServers
}: {
  draft: AgentDraft
  onChange: (d: AgentDraft) => void
  mcpServers: McpServerInfo[]
}) {
  const [advanced, setAdvanced] = useState(draft.allowed_tools.length > 0 || draft.disallowed_tools.length > 0)
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]): void => onChange({ ...draft, [key]: value })

  const routine = draft.routine ?? { enabled: false, cron: '0 8 * * 1-5', prompt: '' }
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
        <Avatar icon={draft.icon} color={draft.color} size={64} />
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
          <div className="flex flex-wrap items-center gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => set('icon', e)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-[17px] transition ${
                  draft.icon === e ? 'bg-selected ring-1 ring-accent' : 'hover:bg-hover'
                }`}
                aria-label={`Use ${e}`}
              >
                {e}
              </button>
            ))}
            <input
              className={`${inputBase} h-8 w-14 px-2 py-0 text-center`}
              value={draft.icon}
              maxLength={4}
              onChange={(e) => set('icon', e.target.value)}
              aria-label="Custom emoji"
              title="Type any emoji"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                className={`h-6 w-6 rounded-full transition ${draft.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
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

      {/* Routine */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[14px] font-medium">Routine</div>
            <div className="text-[12px] text-muted">Run this agent automatically on a schedule.</div>
          </div>
          <Toggle
            label="Routine enabled"
            checked={routine.enabled}
            onChange={(enabled) => set('routine', { ...routine, enabled })}
          />
        </div>
        {routine.enabled && (
          <div className="mt-4 space-y-3">
            <SchedulePicker cron={routine.cron} onChange={(cron) => set('routine', { ...routine, cron })} />
            <Field label="What should it do each time?">
              <textarea
                className={`${inputClass} min-h-[70px] resize-y`}
                value={routine.prompt}
                onChange={(e) => set('routine', { ...routine, prompt: e.target.value })}
                placeholder="Do my morning inbox sweep."
              />
            </Field>
          </div>
        )}
      </div>

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
            <Field label="Always allowed tools" hint="Space or comma separated, e.g. WebSearch WebFetch">
              <input
                className={`${inputClass} font-mono text-[12px]`}
                defaultValue={draft.allowed_tools.join(' ')}
                onBlur={(e) => set('allowed_tools', splitList(e.target.value))}
              />
            </Field>
            <Field label="Never allowed tools" hint="Blocked even if a server offers them, e.g. mcp__gmail__send_message">
              <input
                className={`${inputClass} font-mono text-[12px]`}
                defaultValue={draft.disallowed_tools.join(' ')}
                onBlur={(e) => set('disallowed_tools', splitList(e.target.value))}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}
