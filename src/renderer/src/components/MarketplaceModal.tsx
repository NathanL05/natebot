import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketplaceData, MarketplaceSkill } from '@shared/types'
import { seededColor } from '@shared/mascot'
import { api, useStore } from '../lib/store'
import { CheckIcon, PlusIcon, RefreshIcon, SearchIcon, SpinnerIcon, XIcon } from './icons'
import { Button, IconButton, inputBase, Modal } from './ui'

type Filter = 'all' | 'installed' | string

function SkillTile({ name }: { name: string }) {
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[17px] font-bold text-white"
      style={{ background: `linear-gradient(145deg, ${seededColor(name)}, color-mix(in srgb, ${seededColor(name)} 70%, black))` }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function SkillCard({
  skill,
  busy,
  onToggle
}: {
  skill: MarketplaceSkill
  busy: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-hover">
      <SkillTile name={skill.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold">{skill.name}</span>
          {skill.hasScripts && (
            <span
              className="shrink-0 rounded-full bg-elev-2 px-1.5 py-px text-[10px] font-medium text-muted"
              title="Ships helper scripts. Agents can read them but can't run them unless you allow Bash for that agent."
            >
              scripts
            </span>
          )}
        </div>
        <div className="line-clamp-2 text-[12px] leading-snug text-muted">{skill.description || 'No description.'}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted/70">{skill.source}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`group mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition ${
          skill.installed ? 'text-success hover:bg-danger/15 hover:text-danger' : 'bg-elev-2 text-fg hover:brightness-110'
        }`}
      >
        {busy ? (
          <SpinnerIcon size={12} />
        ) : skill.installed ? (
          <>
            <CheckIcon size={12} className="group-hover:hidden" />
            <span className="group-hover:hidden">Added</span>
            <span className="hidden group-hover:inline">Remove</span>
          </>
        ) : (
          'Add'
        )}
      </button>
    </div>
  )
}

export function MarketplaceModal() {
  const close = (): void => useStore.getState().setMarketplaceOpen(false)
  const [data, setData] = useState<MarketplaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [repo, setRepo] = useState('')

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      setData(await api.marketplace(refresh))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (skill: MarketplaceSkill): Promise<void> => {
    setBusy(skill.id)
    setError(null)
    const res = skill.installed && skill.installedName ? await api.uninstallSkill(skill.installedName) : await api.installSkill(skill.id)
    if (!res.ok) setError(res.error ?? 'Something went wrong.')
    await load()
    setBusy(null)
  }

  const addSource = async (): Promise<void> => {
    const res = await api.addSkillSource(repo)
    if (!res.ok) {
      setError(res.error ?? 'Could not add that source.')
      return
    }
    setRepo('')
    setAdding(false)
    setError(null)
    await load(true)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.skills ?? [])
      .filter((s) => (filter === 'all' ? true : filter === 'installed' ? s.installed : s.source === filter))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }, [data, filter, query])

  const chip = (value: Filter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      className={`h-8 shrink-0 rounded-full px-3.5 text-[13px] transition ${
        filter === value ? 'bg-fg font-medium text-bg' : 'bg-elev text-muted hover:text-fg'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Modal onClose={close} width={860}>
      <div className="flex items-center gap-3 px-6 pt-5 pb-3">
        <div className="flex-1">
          <div className="text-[20px] font-bold">Marketplace</div>
          <div className="text-[12px] text-muted">
            {data ? `${data.installedCount} installed · ${data.skills.length} skills from ${data.sources.length} source${data.sources.length === 1 ? '' : 's'}` : 'Loading…'}
          </div>
        </div>
        <IconButton label="Refresh from GitHub" onClick={() => void load(true)} disabled={loading}>
          <RefreshIcon size={15} className={loading ? 'spin' : ''} />
        </IconButton>
        <IconButton label="Close" onClick={close}>
          <XIcon size={16} />
        </IconButton>
      </div>

      <div className="space-y-3 px-6">
        <div className="relative">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            autoFocus
            className="h-10 w-full rounded-full bg-elev pr-4 pl-10 text-[14px] text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chip('all', 'All')}
          {chip('installed', `Installed${data?.installedCount ? ` · ${data.installedCount}` : ''}`)}
          {data?.sources.map((s) => chip(s.repo, s.repo))}
          {adding ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                void addSource()
              }}
            >
              <input
                className={`${inputBase} h-8 w-56 rounded-full py-0 text-[13px]`}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo or GitHub URL"
                autoFocus
              />
              <Button type="submit" variant="primary" className="h-8 rounded-full">
                Add
              </Button>
              <Button variant="ghost" className="h-8 rounded-full" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted hover:text-fg"
            >
              <PlusIcon size={13} /> Source
            </button>
          )}
        </div>
        {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</div>}
        {data?.sources
          .filter((s) => s.error)
          .map((s) => (
            <div key={s.repo} className="flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
              <span className="flex-1">
                {s.repo}: {s.error}
              </span>
              <button type="button" className="underline" onClick={() => void api.removeSkillSource(s.repo).then(() => load())}>
                Remove source
              </button>
            </div>
          ))}
      </div>

      <div className="mt-3 min-h-[240px] flex-1 overflow-y-auto border-t border-line px-4 py-3">
        {loading && !data ? (
          <div className="flex h-48 items-center justify-center gap-2 text-[13px] text-muted">
            <SpinnerIcon size={14} /> Fetching skills from GitHub…
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-[13px] text-muted">
            {filter === 'installed' ? 'No skills installed yet.' : 'No skills match.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {shown.map((s) => (
              <SkillCard key={s.id} skill={s} busy={busy === s.id} onToggle={() => void toggle(s)} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line px-6 py-2.5 text-[11px] leading-relaxed text-muted">
        Installed skills are available to every agent (saved in ~/NateBot/skills). Skills are instructions written by
        others, so only add sources you trust.
      </div>
    </Modal>
  )
}
