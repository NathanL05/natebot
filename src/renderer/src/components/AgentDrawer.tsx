import { useEffect, useState } from 'react'
import type { AgentConfig, AgentDraft, AgentSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { AgentForm, validateDraft } from './AgentForm'
import { Avatar } from './Avatar'
import { AvatarEditor } from './AvatarEditor'
import { RefreshIcon, TrashIcon, XIcon } from './icons'
import { Button, ConfirmDialog, IconButton, inputClass } from './ui'

function toDraft(a: AgentSummary): AgentDraft {
  return {
    name: a.name,
    shape: a.shape,
    color: a.color,
    model: a.model,
    effort: a.effort,
    instructions: a.instructions,
    mcp_servers: [...a.mcp_servers],
    allowed_tools: [...a.allowed_tools],
    disallowed_tools: [...a.disallowed_tools],
    quick_prompts: [...a.quick_prompts],
    routines: a.routines.map((r) => ({ ...r })),
    email_triggers: a.email_triggers.map((t) => ({ ...t })),
    read_folders: [...a.read_folders],
    auto_approve: [...(a.auto_approve ?? [])]
  }
}

/** Slide-over settings panel for the open agent. */
export function AgentDrawer({ agent }: { agent: AgentSummary }) {
  const mcpServers = useStore((s) => s.mcpServers)
  const close = (): void => useStore.getState().setDrawerOpen(false)
  const [draft, setDraft] = useState<AgentDraft>(() => toDraft(agent))
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(toDraft(agent))
    // Only reset the form when switching to a different agent.
  }, [agent.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !confirm) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(agent))
  const problems = validateDraft(draft)

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const updated: AgentConfig = { ...draft, id: agent.id, session_id: agent.session_id }
      await api.updateAgent(updated)
      close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/25" onMouseDown={close} />
      <aside className="slide-in absolute top-0 right-0 bottom-0 z-40 flex w-[440px] max-w-full flex-col border-l border-line bg-bg shadow-2xl">
        <div className="drag flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
          <div className="flex-1 text-[14px] font-semibold">Agent settings</div>
          <IconButton label="Close" onClick={close}>
            <XIcon size={16} />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <AgentForm
            key={agent.id}
            draft={draft}
            onChange={setDraft}
            mcpServers={mcpServers}
            avatar={
              <AvatarEditor target={`agent:${agent.id}`} hasPicture={!!agent.avatarVersion} label="Upload a picture">
                <Avatar
                  seed={draft.name}
                  shape={draft.shape}
                  color={draft.color}
                  picture={agentPicture(agent.id, agent.avatarVersion)}
                  size={64}
                />
              </AvatarEditor>
            }
          />

          <div className="mt-8 space-y-2 border-t border-line pt-5">
            <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Memory & removal</div>
            <LastingNotes agentId={agent.id} name={agent.name} />
            <div className="flex items-center gap-3 rounded-xl bg-elev px-3 py-2.5">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Reset memory</div>
                <div className="text-[12px] text-muted">Start a fresh Claude session. Chat history and lasting notes stay.</div>
              </div>
              <Button onClick={() => setConfirm('reset')}>
                <RefreshIcon size={13} /> Reset
              </Button>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-elev px-3 py-2.5">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Delete agent</div>
                <div className="text-[12px] text-muted">Removes its settings, routines and chat history.</div>
              </div>
              <Button variant="danger" onClick={() => setConfirm('delete')}>
                <TrashIcon size={13} /> Delete
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <div className="flex-1 truncate text-[12px] text-danger">{dirty ? problems[0] : ''}</div>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!dirty || problems.length > 0 || saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </aside>

      {confirm === 'reset' && (
        <ConfirmDialog
          title={`Reset ${agent.name}'s memory?`}
          body="It will forget the conversation so far and start fresh next time, from its lasting notes. Your chat history stays on screen."
          confirmLabel="Reset memory"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            void api.resetMemory(agent.id)
          }}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={`Delete ${agent.name}?`}
          body="This removes the agent, its routines and its chat history. This can't be undone."
          confirmLabel="Delete agent"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null)
            close()
            void api.deleteAgent(agent.id)
          }}
        />
      )}
    </>
  )
}

/** memory.md: what the agent has noted about you. Saved on its own, separate from the settings form. */
function LastingNotes({ agentId, name }: { agentId: string; name: string }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void api.getMemory(agentId).then((t) => {
      if (!live) return
      setSaved(t)
      setText(t)
    })
    return () => {
      live = false
    }
  }, [agentId])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.setMemory(agentId, text)
      setSaved(text.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-elev px-3 py-2.5">
      <div className="text-[13px] font-medium">Lasting notes</div>
      <div className="mb-2 text-[12px] text-muted">
        What {name} remembers about you across conversations (memory.md). It adds to these itself; you can edit them too.
      </div>
      <textarea
        className={`${inputClass} min-h-[90px] resize-y font-mono text-[12px] leading-relaxed`}
        value={text}
        disabled={saved === null}
        onChange={(e) => setText(e.target.value)}
        placeholder="Nothing yet. Tell the agent something to remember, or write notes here."
      />
      {saved !== null && text.trim() !== saved && (
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setText(saved)}>
            Undo
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save notes
          </Button>
        </div>
      )}
    </div>
  )
}
