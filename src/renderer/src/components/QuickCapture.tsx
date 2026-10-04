// The quick-capture box (its own small window, opened by the global shortcut).
// It talks to the API directly rather than the app store, so opening it never
// marks chats as read or loads history.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentSummary } from '@shared/types'
import { accentById, onFill } from '@shared/accents'
import { api } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { ArrowUpIcon } from './icons'

const LAST_AGENT = 'natebot.capture.agent'

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_AGENT)
  } catch {
    return null
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(LAST_AGENT, id)
  } catch {
    // Not important: the box just starts on another agent next time.
  }
}

/** "@plan…" at the start picks the agent whose name starts with it. */
function mentioned(text: string, agents: AgentSummary[]): AgentSummary | undefined {
  const m = /^@(\S+)/.exec(text)
  if (!m?.[1]) return undefined
  const q = m[1].toLowerCase()
  return agents.find((a) => a.name.toLowerCase().replace(/\s+/g, '').startsWith(q)) ?? agents.find((a) => a.name.toLowerCase().startsWith(q))
}

export function QuickCapture() {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [agentId, setAgentId] = useState<string | null>(remembered())
  const [text, setText] = useState('')
  const [clip, setClip] = useState<{ text: string | null; imagePath: string | null }>({ text: null, imagePath: null })
  const [withClip, setWithClip] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const load = async (): Promise<void> => {
    const boot = await api.bootstrap()
    const sorted = [...boot.agents].sort((a, b) => b.lastActivity - a.lastActivity)
    setAgents(sorted)
    setAgentId((id) => (id && sorted.some((a) => a.id === id) ? id : (sorted[0]?.id ?? null)))
    const theme = boot.settings.theme
    document.documentElement.dataset['theme'] = theme
    const { text: accentText, fill } = accentById(boot.settings.accent)[theme]
    const root = document.documentElement.style
    root.setProperty('--accent', accentText)
    root.setProperty('--accent-strong', fill)
    root.setProperty('--on-accent', onFill(fill))
  }

  useEffect(() => {
    document.documentElement.classList.add('capture')
    void load()
    const offShown = api.on('captureShown', (shown) => {
      void load()
      setText(shown.text ?? '')
      if (shown.agent) setAgentId(shown.agent)
      setWithClip(false)
      void api.readClipboard().then(setClip)
      requestAnimationFrame(() => box.current?.focus())
    })
    const offAgents = api.on('agents', (list) => setAgents([...list].sort((a, b) => b.lastActivity - a.lastActivity)))
    return () => {
      offShown()
      offAgents()
    }
  }, [])

  const picked = mentioned(text, agents)
  const target = picked ?? agents.find((a) => a.id === agentId)

  const choose = (id: string): void => {
    setAgentId(id)
    remember(id)
    box.current?.focus()
  }

  const send = (): void => {
    if (!target) return
    const typed = (picked ? text.replace(/^@\S+\s*/, '') : text).trim()
    const pasted = withClip && clip.text ? `\n\n[From my clipboard]\n${clip.text}` : ''
    const files = withClip && clip.imagePath ? [clip.imagePath] : undefined
    if (!typed && !pasted && !files) return
    void api.sendMessage(target.id, `${typed}${pasted}`.trim(), files)
    remember(target.id)
    setAgentId(target.id)
    setText('')
    void api.hideCapture()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void api.hideCapture()
    } else if (e.key === 'Tab' && agents.length > 1) {
      e.preventDefault()
      const i = agents.findIndex((a) => a.id === target?.id)
      const next = agents[(i + (e.shiftKey ? agents.length - 1 : 1)) % agents.length]
      if (next) choose(next.id)
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-full items-start p-3">
      <div className="w-full rounded-[22px] border border-line-strong bg-bg/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="flex items-end gap-2.5">
          {target && (
            <Avatar seed={target.name} shape={target.shape} color={target.color} picture={agentPicture(target.id, target.avatarVersion)} size={34} />
          )}
          <textarea
            ref={box}
            rows={2}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={target ? `Ask ${target.name}…` : 'Add an agent in NateBot first'}
            className="flex-1 resize-none bg-transparent py-1 text-[15px] leading-[22px] text-fg outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={send}
            disabled={!target || (!text.trim() && !withClip)}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-me text-me-fg transition hover:opacity-85 disabled:opacity-30"
          >
            <ArrowUpIcon size={16} />
          </button>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 overflow-hidden">
          {agents.slice(0, 6).map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] transition ${
                a.id === target?.id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <Avatar seed={a.name} shape={a.shape} color={a.color} picture={agentPicture(a.id, a.avatarVersion)} size={16} />
              {a.name}
            </button>
          ))}
          {(clip.text || clip.imagePath) && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setWithClip(!withClip)}
              title={clip.text ? clip.text.slice(0, 300) : 'The copied image'}
              className={`ml-auto flex max-w-[200px] shrink-0 items-center gap-1 truncate rounded-full border px-2 py-1 text-[12px] transition ${
                withClip ? 'border-accent bg-selected text-fg' : 'border-line-strong text-muted hover:text-fg'
              }`}
            >
              {withClip ? '✓ ' : '+ '}
              {clip.imagePath ? 'Clipboard image' : `Clipboard: “${(clip.text ?? '').replace(/\s+/g, ' ').slice(0, 24)}…”`}
            </button>
          )}
          <span className={`${clip.text || clip.imagePath ? '' : 'ml-auto'} shrink-0 text-[11px] text-muted`}>Tab switches · Enter sends · Esc closes</span>
        </div>
      </div>
    </div>
  )
}
