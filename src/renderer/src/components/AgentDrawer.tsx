import { useEffect, useState } from 'react'
import type { AgentConfig, AgentDraft, AgentSummary } from '@shared/types'
import { api, useStore } from '../lib/store'
import { AgentForm, validateDraft } from './AgentForm'
import { RefreshIcon, TrashIcon, XIcon } from './icons'
import { Button, ConfirmDialog, IconButton } from './ui'

function toDraft(a: AgentSummary): AgentDraft {
  return {
    name: a.name,
    shape: a.shape,
    color: a.color,
    model: a.model,
    instructions: a.instructions,
    mcp_servers: [...a.mcp_servers],
    allowed_tools: [...a.allowed_tools],
    disallowed_tools: [...a.disallowed_tools],
    routine: a.routine ? { ...a.routine } : null
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
          <AgentForm draft={draft} onChange={setDraft} mcpServers={mcpServers} />

          <div className="mt-8 space-y-2 border-t border-line pt-5">
            <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Memory & removal</div>
            <div className="flex items-center gap-3 rounded-xl bg-elev px-3 py-2.5">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Reset memory</div>
                <div className="text-[12px] text-muted">Start a fresh Claude session. Chat history stays visible.</div>
              </div>
              <Button onClick={() => setConfirm('reset')}>
                <RefreshIcon size={13} /> Reset
              </Button>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-elev px-3 py-2.5">
              <div className="flex-1">
                <div className="text-[13px] font-medium">Delete agent</div>
                <div className="text-[12px] text-muted">Removes its settings, routine and chat history.</div>
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
          body="It will forget the conversation so far and start fresh next time. Your chat history stays on screen."
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
          body="This removes the agent, its routine and its chat history. This can't be undone."
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
