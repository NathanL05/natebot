import { useState } from 'react'
import type { AgentDraft } from '@shared/types'
import { seededColor } from '@shared/mascot'
import { api, useStore } from '../lib/store'
import { AgentForm, blankDraft, validateDraft } from './AgentForm'
import { XIcon } from './icons'
import { Button, IconButton, Modal } from './ui'

export function AddAgentModal() {
  const mcpServers = useStore((s) => s.mcpServers)
  const defaultModel = useStore((s) => s.settings?.defaultModel ?? 'sonnet')
  const defaultEffort = useStore((s) => s.settings?.defaultEffort ?? 'medium')
  const [draft, setDraft] = useState<AgentDraft>(() => blankDraft(defaultModel, defaultEffort))
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [colorPicked, setColorPicked] = useState(false)

  // Until a colour is picked by hand, it follows the name (same seed as the mascot).
  const change = (next: AgentDraft): void => {
    const picked = colorPicked || next.color !== draft.color
    setColorPicked(picked)
    setDraft(picked ? next : { ...next, color: seededColor(next.name) })
  }
  const close = (): void => useStore.getState().setAddOpen(false)

  const problems = validateDraft(draft)

  const create = async (): Promise<void> => {
    setTouched(true)
    if (problems.length) return
    setSaving(true)
    try {
      const agent = await api.createAgent(draft)
      const folderId = useStore.getState().addFolderId
      if (folderId) await api.moveToFolder(agent.id, folderId)
      close()
      useStore.getState().select(agent.id)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={close} width={600}>
      <div className="flex items-center border-b border-line px-5 py-3">
        <div className="flex-1 text-[15px] font-semibold">New agent</div>
        <IconButton label="Close" onClick={close}>
          <XIcon size={16} />
        </IconButton>
      </div>
      <div className="overflow-y-auto px-5 py-5">
        <AgentForm draft={draft} onChange={change} mcpServers={mcpServers} />
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <div className="flex-1 truncate text-[12px] text-danger">{touched ? problems[0] : ''}</div>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving} onClick={() => void create()}>
          Create agent
        </Button>
      </div>
    </Modal>
  )
}
