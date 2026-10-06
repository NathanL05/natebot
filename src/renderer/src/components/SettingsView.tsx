import { useEffect, useState, type ReactNode } from 'react'
import { EFFORTS, MAX_ABOUT_ME, MODELS, PAUSE_LEVELS, QUICK_CAPTURE_SHORTCUTS, SPOKEN_CONTENT_SETTINGS, VOICE_RATES, type EffortLevel, type ModelId, type Theme, type UsageBreakdown, type UsageWindow } from '@shared/types'
import { DELETED_AGENT_ID, formatTokens, rankUsage } from '@shared/usage'
import { ACCENTS, accentById, onFill } from '@shared/accents'
import { api, useStore } from '../lib/store'
import { goodVoices, loadVoices, speak, stopSpeaking } from '../lib/voice'
import { countdown, LEVEL_COLOR, pct, resetTime, usageLevel } from '../lib/usage'
import { CheckIcon, RefreshIcon } from './icons'
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

function Meter({ window: w, limited }: { window: UsageWindow; limited: boolean }) {
  const level = usageLevel(w, limited)
  const color = LEVEL_COLOR[level]
  const value = limited ? 1 : (w.utilization ?? 0)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-elev-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="w-12 text-right text-[12px] tabular-nums" style={{ color: level === 'ok' || level === 'none' ? 'var(--muted)' : color }}>
        {limited ? '100%' : pct(w.utilization, 1)}
      </span>
    </div>
  )
}

type Period = 'fiveHour' | 'sevenDay'

/** Which agents used what over the current 5-hour window or week (NateBot's own runs only). */
function AgentUsageRows() {
  const agents = useStore((s) => s.agents)
  const usage = useStore((s) => s.usage)
  const [period, setPeriod] = useState<Period>('sevenDay')
  const [data, setData] = useState<UsageBreakdown | null>(null)
  // Changes whenever an agent starts or finishes a run, so the list never lags behind.
  const activity = agents.map((a) => a.status).join()

  // Reload on open, when a run starts or finishes, and when the usage numbers refresh.
  useEffect(() => {
    let live = true
    void api.usageBreakdown().then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [usage?.updatedAt, activity])

  const rows = rankUsage(data?.[period] ?? [])
  const unmeasured = rows.reduce((n, r) => n + r.unmeasuredRuns, 0)
  const nameOf = (id: string): string => (id === DELETED_AGENT_ID ? 'Deleted agents' : (agents.find((a) => a.id === id)?.name ?? 'Unknown agent'))
  const since = data ? (period === 'fiveHour' ? data.fiveHourSince : data.sevenDaySince) : null

  return (
    <>
      <Row
        label="By agent"
        hint={`Share of what NateBot's own runs used${since ? ` since ${new Date(since).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}. Claude Code and claude.ai aren't included.`}
      >
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'fiveHour', label: '5 hours' },
            { value: 'sevenDay', label: 'Week' }
          ]}
        />
      </Row>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-[12px] text-muted">{data ? 'No runs in this period yet.' : 'Loading…'}</div>
      ) : (
        rows.map((r) => (
          <div key={r.agentId} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{nameOf(r.agentId)}</div>
              <div className="text-[11px] text-muted tabular-nums">
                {r.runs} run{r.runs === 1 ? '' : 's'} · {formatTokens(r.inputTokens)} in · {formatTokens(r.outputTokens)} out
              </div>
            </div>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-elev-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(r.share * 100)}%` }} />
            </div>
            <span className="w-10 text-right text-[12px] text-muted tabular-nums">{Math.round(r.share * 100)}%</span>
          </div>
        ))
      )}
      {unmeasured > 0 && (
        <div className="px-4 py-2 text-[11px] text-muted">
          {unmeasured} run{unmeasured === 1 ? '' : 's'} had no token report (stopped, timed out, or before tracking) and aren't counted.
        </div>
      )}
    </>
  )
}

const resetHint = (w: UsageWindow): string | undefined =>
  w.resetsAt ? `Resets ${resetTime(w.resetsAt)} (in ${countdown(w.resetsAt)})` : undefined

const RATE_LABELS: Record<number, string> = { 0.9: 'Slower', 1: 'Normal', 1.15: 'Faster', 1.3: 'Fast' }
const SAMPLE = "Hi, I'm reading your agents' replies in this voice. Here's your plan for today, in three steps."

/** The voice and speed for Listen, with a preview. Lists natural English voices only (no novelty voices). */
function VoiceRows({ voice, rate, onChange }: { voice: string | null; rate: number; onChange: (p: { voice?: string | null; voiceRate?: number }) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    void loadVoices().then((all) => setVoices(goodVoices(all)))
    return stopSpeaking
  }, [])
  const best = voices[0]?.name
  const premium = voices.some((v) => /premium|enhanced/i.test(v.name))
  const preview = (next: { voice?: string | null; rate?: number } = {}): void => {
    setPlaying(true)
    void speak(SAMPLE, { voice: next.voice !== undefined ? next.voice : voice, rate: next.rate ?? rate, onEnd: () => setPlaying(false) })
  }
  return (
    <>
      <Row label="Voice" hint="Used by Listen under each reply.">
        <div className="flex items-center gap-2">
          <select
            className={`${inputBase} h-9 w-60 py-0`}
            value={voice && voices.some((v) => v.name === voice) ? voice : ''}
            onChange={(e) => {
              const next = e.target.value || null
              onChange({ voice: next })
              preview({ voice: next })
            }}
          >
            <option value="">Automatic{best ? ` (${best})` : ''}</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} · {v.lang}
              </option>
            ))}
          </select>
          <Button onClick={() => (playing ? stopSpeaking() : preview())}>{playing ? 'Stop' : 'Preview'}</Button>
        </div>
      </Row>
      <Row label="Speed">
        <Segmented
          value={String(rate)}
          options={VOICE_RATES.map((r) => ({ value: String(r), label: RATE_LABELS[r] ?? String(r) }))}
          onChange={(v) => {
            onChange({ voiceRate: Number(v) })
            preview({ rate: Number(v) })
          }}
        />
      </Row>
      <Row
        label={premium ? 'More voices' : 'Get a more natural voice'}
        hint={
          premium
            ? 'Download more voices in System Settings → Accessibility → Read & Speak → System voice → Manage Voices.'
            : "The voices built into macOS sound robotic. Free Premium voices sound far more natural: in Read & Speak, open System voice → Manage Voices, pick English, and download one marked Premium (e.g. Jamie, Serena or Ava). It appears here and is picked automatically."
        }
      >
        <Button onClick={() => void api.openExternal(SPOKEN_CONTENT_SETTINGS)}>Open Read & Speak</Button>
      </Row>
    </>
  )
}

export function SettingsView() {
  const settings = useStore((s) => s.settings)
  const env = useStore((s) => s.env)
  const usage = useStore((s) => s.usage)
  const patch = useStore((s) => s.patchSettings)
  const gmail = useStore((s) => s.mcpServers.find((m) => m.name === 'gmail'))
  const calendar = useStore((s) => s.mcpServers.find((m) => m.name === 'gcal'))
  const tasks = useStore((s) => s.mcpServers.find((m) => m.name === 'gtasks'))
  const drive = useStore((s) => s.mcpServers.find((m) => m.name === 'gdrive'))
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

          <Section title="Connected tools">
            <Row label="Gmail" hint={gmail?.configured ? gmail.description : 'Not connected. Lets agents read, search and draft email.'}>
              <Button onClick={() => useStore.getState().setGmailOpen(true)}>{gmail?.configured ? 'Reconnect…' : 'Connect Gmail…'}</Button>
            </Row>
            <Row
              label="Google Calendar"
              hint={calendar?.configured ? calendar.description : 'Not connected. Lets agents read events and find free time; changes need approval.'}
            >
              <Button onClick={() => useStore.getState().setCalendarOpen(true)}>{calendar?.configured ? 'Reconnect…' : 'Connect Calendar…'}</Button>
            </Row>
            <Row label="Google Tasks" hint={tasks?.configured ? tasks.description : 'Not connected. Lets agents read your tasks (synced to your phone); changes need approval.'}>
              <Button onClick={() => useStore.getState().setGoogleOpen('gtasks')}>{tasks?.configured ? 'Reconnect…' : 'Connect Tasks…'}</Button>
            </Row>
            <Row label="Google Drive & Docs" hint={drive?.configured ? drive.description : 'Not connected. Lets agents search and read your files; creating or editing needs approval.'}>
              <Button onClick={() => useStore.getState().setGoogleOpen('gdrive')}>{drive?.configured ? 'Reconnect…' : 'Connect Drive…'}</Button>
            </Row>
            <AppleRow />
            <Row label="Other MCP servers" hint="Add them to ~/NateBot/mcp.json (see README). They appear in each agent's settings.">
              <Button onClick={() => void api.openExternal('https://github.com/NathanL05/natebot#adding-mcp-servers')}>How-to</Button>
            </Row>
          </Section>

          <Section title="Usage">
            <Row label="Light routines" hint="Routines and reminder tasks run on Haiku at low effort, in a short fresh session. Uses far less of your limit.">
              <Toggle label="Light routines" checked={settings.lightRuns} onChange={(v) => void patch({ lightRuns: v })} />
            </Row>
            <Row label="Pause routines when the week reaches" hint="Routines and reminder tasks are skipped above this, so they can't use up your week. Message reminders still arrive.">
              <Segmented<string>
                value={settings.pauseRoutinesAt === null ? 'never' : String(settings.pauseRoutinesAt)}
                onChange={(v) => void patch({ pauseRoutinesAt: v === 'never' ? null : Number(v) })}
                options={[...PAUSE_LEVELS.map((l) => ({ value: String(l), label: `${Math.round(l * 100)}%` })), { value: 'never', label: 'Never' }]}
              />
            </Row>
            <Row label="5-hour session window" hint={resetHint(usage?.fiveHour ?? { utilization: null, resetsAt: null }) ?? 'Checking…'}>
              <Meter
                window={usage?.fiveHour ?? { utilization: null, resetsAt: null }}
                limited={usage?.status === 'rejected' && usage.limitedWindow !== 'seven_day'}
              />
            </Row>
            <Row label="Weekly limit" hint={resetHint(usage?.sevenDay ?? { utilization: null, resetsAt: null })}>
              <Meter window={usage?.sevenDay ?? { utilization: null, resetsAt: null }} limited={usage?.status === 'rejected' && usage.limitedWindow === 'seven_day'} />
            </Row>
            <AgentUsageRows />
          </Section>

          <Section title="Defaults">
            <Row label="Default model for new agents" hint={MODELS.find((m) => m.id === settings.defaultModel)?.hint}>
              <Segmented<ModelId>
                value={settings.defaultModel}
                onChange={(v) => void patch({ defaultModel: v })}
                options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
              />
            </Row>
            <Row label="Default effort for new agents" hint={EFFORTS.find((e) => e.id === settings.defaultEffort)?.hint}>
              <Segmented<EffortLevel>
                value={settings.defaultEffort}
                onChange={(v) => void patch({ defaultEffort: v })}
                options={EFFORTS.map((e) => ({ value: e.id, label: e.label }))}
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
            <div className="px-4 py-3">
              <div className="text-[13px] font-medium">Accent colour</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {accentById(settings.accent).label} · used for your messages, buttons and highlights.
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour">
                {ACCENTS.map((a) => {
                  const fill = a[settings.theme].fill
                  const on = settings.accent === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={a.label}
                      title={a.label}
                      onClick={() => void patch({ accent: a.id })}
                      className={`flex h-8 w-8 items-center justify-center rounded-full transition hover:scale-110 ${
                        on ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''
                      }`}
                      style={{ background: fill, color: onFill(fill) }}
                    >
                      {on && <CheckIcon size={14} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section title="Voice">
            <VoiceRows voice={settings.voice} rate={settings.voiceRate} onChange={(p) => void patch(p)} />
          </Section>

          <Section title="General">
            <Row label="Your name" hint="Shown in the sidebar.">
              <input
                className={`${inputBase} w-52`}
                defaultValue={settings.userName}
                onBlur={(e) => e.target.value.trim() && void patch({ userName: e.target.value.trim() })}
              />
            </Row>
            <div className="px-4 py-3">
              <div className="text-[13px] font-medium">About you</div>
              <div className="mt-0.5 mb-2 text-[12px] text-muted">
                Every agent reads this, so you don't have to repeat yourself: what you study or do, where you live, goals, how
                you like answers. Keep it short ({MAX_ABOUT_ME} characters at most); it's sent with every message.
              </div>
              <textarea
                className={`${inputClass} min-h-[90px] resize-y`}
                defaultValue={settings.aboutMe}
                maxLength={MAX_ABOUT_ME}
                onBlur={(e) => e.target.value.trim() !== settings.aboutMe && void patch({ aboutMe: e.target.value })}
                placeholder="e.g. Final-year student in Galway, applying for 2027 software graduate roles. Gym Mon/Wed/Fri evenings. Prefer short, direct answers."
              />
            </div>
            <Row
              label="Quiet hours"
              hint={
                settings.quietHours
                  ? 'Notifications wait until the end, then one summary arrives. Reminders you set still ring.'
                  : 'Hold notifications overnight and get one summary in the morning.'
              }
            >
              <div className="flex items-center gap-2">
                {settings.quietHours && (
                  <>
                    <input
                      type="time"
                      aria-label="Quiet from"
                      className={`${inputBase} h-8 w-[100px] py-0 text-[12px]`}
                      value={settings.quietHours.start}
                      onChange={(e) => e.target.value && void patch({ quietHours: { ...settings.quietHours!, start: e.target.value } })}
                    />
                    <span className="text-[12px] text-muted">to</span>
                    <input
                      type="time"
                      aria-label="Quiet until"
                      className={`${inputBase} h-8 w-[100px] py-0 text-[12px]`}
                      value={settings.quietHours.end}
                      onChange={(e) => e.target.value && void patch({ quietHours: { ...settings.quietHours!, end: e.target.value } })}
                    />
                  </>
                )}
                <Toggle
                  label="Quiet hours"
                  checked={!!settings.quietHours}
                  onChange={(v) => void patch({ quietHours: v ? { start: '22:30', end: '07:30' } : null })}
                />
              </div>
            </Row>
            <PhoneRow topic={settings.pushTopic} details={settings.pushDetails} inbox={settings.phoneInbox} onChange={(p) => void patch(p)} />
            <QuickCaptureRow value={settings.quickCapture} onChange={(quickCapture) => void patch({ quickCapture })} />
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

/** The global shortcut that opens the quick-capture box from any app. */
function QuickCaptureRow({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    void api.captureShortcutOk().then(setOk)
  }, [value])
  const label = QUICK_CAPTURE_SHORTCUTS.find((s) => s.id === value)?.label
  return (
    <Row
      label="Quick capture"
      hint={
        !value ? (
          'Off. Turn on a shortcut to message an agent from any app.'
        ) : ok ? (
          `Press ${label} in any app to message an agent. The reply arrives as a notification.`
        ) : (
          <span className="text-warn">Another app already uses {label}. Pick a different shortcut.</span>
        )
      }
    >
      <Segmented<string>
        value={value ?? 'off'}
        onChange={(v) => onChange(v === 'off' ? null : v)}
        options={[{ value: 'off', label: 'Off' }, ...QUICK_CAPTURE_SHORTCUTS.map((s) => ({ value: s.id, label: s.label }))]}
      />
    </Row>
  )
}

/** Phone notifications through ntfy: the app subscribes to a private topic name. */
function PhoneRow({
  topic,
  details,
  inbox,
  onChange
}: {
  topic: string | null
  details: boolean
  inbox: boolean
  onChange: (p: { pushTopic?: string | null; pushDetails?: boolean; phoneInbox?: boolean }) => void
}) {
  const [result, setResult] = useState('')
  const generate = (): void => onChange({ pushTopic: `natebot-${Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}` })
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Phone notifications</div>
          <div className="mt-0.5 text-[12px] text-muted">
            Get NateBot's notifications on your phone with the free ntfy app: install it, then subscribe to this topic. The topic name is
            the only key, so keep it private. They go through ntfy.sh; by default only titles are sent.
          </div>
        </div>
        {topic ? (
          <Button variant="ghost" onClick={() => onChange({ pushTopic: null })}>
            Turn off
          </Button>
        ) : (
          <Button onClick={generate}>Set up</Button>
        )}
      </div>
      {topic && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="selectable rounded-lg bg-elev px-2.5 py-1.5 text-[12px]">{topic}</code>
          <Button
            variant="ghost"
            onClick={() => void api.testPush().then((r) => setResult(r.ok ? 'Sent. Check your phone.' : `Didn't send: ${r.error ?? 'unknown error'}`))}
          >
            Send test
          </Button>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <Toggle label="Include message text" checked={details} onChange={(v) => onChange({ pushDetails: v })} /> Include message text
          </label>
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <Toggle label="Message agents from your phone" checked={inbox} onChange={(v) => onChange({ phoneInbox: v, ...(v ? { pushDetails: true } : {}) })} /> Message
            agents from your phone
          </label>
          {result && <span className="text-[12px] text-muted">{result}</span>}
          {inbox && (
            <div className="w-full text-[12px] text-muted">
              In the ntfy app, also subscribe to <code className="selectable">{topic}-in</code> and send messages there: “@planner move gym to 8”, or just
              text for your most recent agent. Replies arrive as notifications with their text, and approval requests get Approve and
              Reject buttons (each works once, for 24 hours).
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Apple Reminders & Notes: one click, then macOS asks for permission. */
function AppleRow() {
  const apple = useStore((s) => s.mcpServers.find((m) => m.name === 'apple'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const res = await api.connectApple()
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Something went wrong.')
  }
  return (
    <Row
      label="Apple Reminders & Notes"
      hint={
        error ? (
          <span className="text-danger">{error}</span>
        ) : apple?.configured ? (
          apple.description
        ) : (
          'Not connected. Lets agents read your reminders and notes (synced to your iPhone); adding or completing needs approval. macOS asks for permission once.'
        )
      }
    >
      <Button disabled={busy} onClick={() => void connect()}>
        {busy ? 'Waiting for macOS…' : apple?.configured ? 'Reconnect' : 'Connect…'}
      </Button>
    </Row>
  )
}
