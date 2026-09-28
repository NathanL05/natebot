import { useState, type ReactNode } from 'react'
import { MODELS, type ModelId, type Theme } from '@shared/types'
import { api, useStore } from '../lib/store'
import { clockTime } from '../lib/format'
import { RefreshIcon } from './icons'
import { Button, inputBase, inputClass, Segmented, Toggle } from './ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-[12px] font-medium tracking-wide text-muted uppercase">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl bg-elev/60">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[12px] text-muted">—</span>
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-elev-2">
        <div className={`h-full rounded-full ${value > 0.85 ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="w-9 text-right text-[12px] text-muted">{pct}%</span>
    </div>
  )
}

export function SettingsView() {
  const settings = useStore((s) => s.settings)
  const env = useStore((s) => s.env)
  const usage = useStore((s) => s.usage)
  const patch = useStore((s) => s.patchSettings)
  const [checking, setChecking] = useState(false)
  const [pathDraft, setPathDraft] = useState(settings?.claudePath ?? '')

  if (!settings) return null

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await patch({ claudePath: pathDraft.trim() || null })
      useStore.setState({ env: await api.recheckEnv() })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center border-b border-line px-6">
        <div className="text-[15px] font-semibold">Settings</div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[640px]">
          <Section title="Claude Code">
            <Row
              label="Status"
              hint={
                env?.loggedIn
                  ? `Logged in · ${env.subscriptionType ?? 'subscription'} plan · Claude Code ${env.version ?? ''}`
                  : (env?.error ?? 'Not checked yet')
              }
            >
              <span className={`text-[12px] font-semibold ${env?.loggedIn ? 'text-success' : 'text-danger'}`}>
                {env?.loggedIn ? '● Ready' : '● Needs setup'}
              </span>
            </Row>
            <div className="px-4 py-3">
              <div className="text-[13px] font-medium">Path to the claude program</div>
              <div className="mt-0.5 mb-2 text-[12px] text-muted">
                Leave empty to auto-detect{env?.claudePath ? ` (found: ${env.claudePath})` : ''}.
              </div>
              <div className="flex gap-2">
                <input
                  className={`${inputClass} font-mono text-[12px]`}
                  value={pathDraft}
                  placeholder="/Users/you/.local/bin/claude"
                  onChange={(e) => setPathDraft(e.target.value)}
                />
                <Button onClick={() => void recheck()} disabled={checking}>
                  <RefreshIcon size={13} className={checking ? 'spin' : ''} /> Re-check
                </Button>
              </div>
            </div>
          </Section>

          <Section title="Usage">
            <Row label="5-hour window" hint={usage?.resetsAt ? `Resets at ${clockTime(usage.resetsAt)}` : undefined}>
              <Meter value={usage?.fiveHourUtilization ?? null} />
            </Row>
            <Row label="This week">
              <Meter value={usage?.sevenDayUtilization ?? null} />
            </Row>
          </Section>

          <Section title="Defaults">
            <Row label="Default model for new agents" hint={MODELS.find((m) => m.id === settings.defaultModel)?.hint}>
              <Segmented<ModelId>
                value={settings.defaultModel}
                onChange={(v) => void patch({ defaultModel: v })}
                options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
              />
            </Row>
          </Section>

          <Section title="Appearance">
            <Row label="Theme">
              <Segmented<Theme>
                value={settings.theme}
                onChange={(v) => void patch({ theme: v })}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' }
                ]}
              />
            </Row>
          </Section>

          <Section title="General">
            <Row label="Your name" hint="Shown in the sidebar.">
              <input
                className={`${inputBase} w-52`}
                defaultValue={settings.userName}
                onBlur={(e) => e.target.value.trim() && void patch({ userName: e.target.value.trim() })}
              />
            </Row>
            <Row label="Launch at login" hint="Keeps routines running after a restart. NateBot starts hidden in the menu bar.">
              <Toggle label="Launch at login" checked={settings.launchAtLogin} onChange={(v) => void patch({ launchAtLogin: v })} />
            </Row>
          </Section>

          <p className="pb-6 text-center text-[12px] text-muted">
            NateBot runs everything through your local Claude Code login. No API key, and your data stays on this Mac.
          </p>
        </div>
      </div>
    </div>
  )
}
