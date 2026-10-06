// The Guide: every NateBot feature, searchable, each with a few short steps. The content is in lib/guide.ts.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GUIDE_FEATURES, searchGuide, type GuideFeature, type GuideTarget } from '../lib/guide'
import { useStore } from '../lib/store'
import { ArrowUpIcon, ChevronIcon, SearchIcon } from './icons'
import { Button } from './ui'

const GO: Record<GuideTarget, { label: string; run: () => void }> = {
  today: { label: 'Open Today', run: () => useStore.getState().setView('today') },
  jobs: { label: 'Open Jobs', run: () => useStore.getState().setView('jobs') },
  routines: { label: 'Open Routines', run: () => useStore.getState().setView('routines') },
  settings: { label: 'Open Settings', run: () => useStore.getState().setView('settings') },
  marketplace: { label: 'Open Marketplace', run: () => useStore.getState().setMarketplaceOpen(true) },
  newAgent: { label: 'New agent', run: () => useStore.getState().setAddOpen(true) },
  newRoom: { label: 'New group chat', run: () => useStore.getState().setRoomEditor('new') },
  palette: { label: 'Open ⌘K', run: () => useStore.setState({ paletteOpen: true }) }
}

/** **bold** for things to click, `code` for keys and text to type. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith('**') ? (
          <strong key={i} className="font-semibold text-fg">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith('`') ? (
          <kbd key={i} className="rounded-md border border-line-strong bg-elev px-1.5 py-px font-mono text-[12px] text-fg">
            {part.slice(1, -1)}
          </kbd>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  )
}

export function GuideView() {
  const focus = useStore((s) => s.guideFocus)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(focus ?? GUIDE_FEATURES[0]?.id ?? '')
  const listRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  // Opened at a feature from ⌘K: show it, then forget it so the next visit starts where you left off.
  useEffect(() => {
    if (!focus) return
    setQuery('')
    setSelectedId(focus)
    useStore.setState({ guideFocus: null })
  }, [focus])

  const categories = useMemo(() => searchGuide(query), [query])
  const shown = useMemo(() => categories.flatMap((c) => c.features), [categories])
  // A search that hides the open feature moves to the first match.
  const feature: GuideFeature | undefined = shown.find((f) => f.id === selectedId) ?? shown[0]
  const category = categories.find((c) => c.features.some((f) => f.id === feature?.id))
  const at = feature ? shown.indexOf(feature) : -1

  const select = (f: GuideFeature | undefined): void => {
    if (f) setSelectedId(f.id)
  }

  useEffect(() => {
    if (!feature) return
    listRef.current?.querySelector<HTMLElement>(`[data-id="${feature.id}"]`)?.scrollIntoView({ block: 'nearest' })
    detailRef.current?.scrollTo({ top: 0 })
  }, [feature])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-6">
        <div className="text-[15px] font-semibold">Guide</div>
        <div className="text-[12px] text-muted">{GUIDE_FEATURES.length} things NateBot can do</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <div className="p-3">
            <div className="relative">
              <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    select(shown[Math.min(at + 1, shown.length - 1)])
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    select(shown[Math.max(at - 1, 0)])
                  } else if (e.key === 'Escape' && query) {
                    e.stopPropagation()
                    setQuery('')
                  }
                }}
                placeholder="How do I…"
                aria-label="Search the guide"
                className="h-8 w-full rounded-lg bg-elev pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/60"
              />
            </div>
          </div>
          <nav ref={listRef} className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Features">
            {categories.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches “{query.trim()}”.</div>}
            {categories.map((c) => (
              <section key={c.id} className="mb-3">
                <h2 className="flex items-center px-2.5 pt-1 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
                  <span className="flex-1">{c.title}</span>
                  <span className="tabular-nums">{c.features.length}</span>
                </h2>
                {c.features.map((f) => (
                  <button
                    key={f.id}
                    data-id={f.id}
                    type="button"
                    onClick={() => select(f)}
                    aria-current={f.id === feature?.id ? 'true' : undefined}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
                      f.id === feature?.id ? 'bg-selected font-medium text-fg' : 'text-fg/85 hover:bg-hover'
                    }`}
                  >
                    {f.title}
                  </button>
                ))}
              </section>
            ))}
          </nav>
        </div>

        <div ref={detailRef} className="min-w-0 flex-1 overflow-y-auto">
          {feature && (
            <article key={feature.id} className="selectable rise mx-auto max-w-[580px] px-8 py-10">
              <div className="text-[12px] font-semibold tracking-wide text-accent uppercase">{category?.title}</div>
              <h1 className="mt-1.5 text-[24px] leading-tight font-semibold">{feature.title}</h1>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{feature.summary}</p>

              <ol className="mt-7">
                {feature.steps.map((step, i) => {
                  const last = i === feature.steps.length - 1
                  return (
                    <li key={i} className="rise-step relative flex gap-3.5 pb-5" style={{ '--i': i } as CSSProperties}>
                      {/* The line joining each step's number to the next. */}
                      {!last && <span className="absolute top-8 bottom-1 left-[13px] w-px bg-line-strong" aria-hidden="true" />}
                      <span className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-accent-strong text-[12px] font-semibold text-on-accent tabular-nums">
                        {i + 1}
                      </span>
                      <span className="pt-[3px] text-[14px] leading-relaxed">
                        <Inline text={step} />
                      </span>
                    </li>
                  )
                })}
              </ol>

              {feature.tip && (
                <div className="mt-1 flex gap-3 rounded-xl border border-line bg-elev/60 px-4 py-3 text-[13px] leading-relaxed">
                  <span className="shrink-0 font-semibold text-accent">Tip</span>
                  <span className="text-muted">
                    <Inline text={feature.tip} />
                  </span>
                </div>
              )}

              {feature.go && (
                <Button variant="primary" className="mt-6" onClick={GO[feature.go].run}>
                  {GO[feature.go].label}
                  <ArrowUpIcon size={12} className="rotate-45" />
                </Button>
              )}

              <Pager prev={shown[at - 1]} next={shown[at + 1]} onSelect={select} />
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

function Pager({ prev, next, onSelect }: { prev?: GuideFeature; next?: GuideFeature; onSelect: (f: GuideFeature) => void }) {
  const card = (f: GuideFeature, dir: 'prev' | 'next'): ReactNode => (
    <button
      type="button"
      onClick={() => onSelect(f)}
      className={`flex min-w-0 flex-1 flex-col rounded-xl border border-line px-3.5 py-2.5 transition hover:bg-hover ${dir === 'next' ? 'items-end text-right' : 'items-start text-left'}`}
    >
      <span className="flex items-center gap-1 text-[11px] text-muted">
        {dir === 'prev' && <ChevronIcon size={11} className="rotate-180" />}
        {dir === 'prev' ? 'Previous' : 'Next'}
        {dir === 'next' && <ChevronIcon size={11} />}
      </span>
      <span className="w-full truncate text-[13px] font-medium">{f.title}</span>
    </button>
  )
  if (!prev && !next) return null
  return (
    <div className="mt-10 flex gap-3 border-t border-line pt-5">
      {prev ? card(prev, 'prev') : <span className="flex-1" />}
      {next ? card(next, 'next') : <span className="flex-1" />}
    </div>
  )
}
