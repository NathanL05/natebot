import { useState } from 'react'
import type { RoomDraft } from '@shared/types'
import { api, sortAgents, useStore } from '../lib/store'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { CheckIcon, XIcon } from './icons'
import { Button, ConfirmDialog, Field, IconButton, inputClass, Modal, Segmented } from './ui'

const MIN_MEMBERS = 2
const MAX_MEMBERS = 6
const TURN_OPTIONS = ['4', '8', '12', '20'] as const

/** Create a group chat (roomEditor = 'new') or edit one (roomEditor = its id). */
export function RoomModal() {
  const target = useStore((s) => s.roomEditor)
  const agents = useStore((s) => s.agents)
  const existing = useStore((s) => s.rooms.find((r) => r.id === s.roomEditor))
  const [draft, setDraft] = useState<RoomDraft>(() =>
    existing
      ? { name: existing.name, memberIds: existing.memberIds, maxTurns: existing.maxTurns }
      : { name: '', memberIds: sortAgents(agents).slice(0, 3).map((a) => a.id), maxTurns: 8 }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const close = (): void => useStore.getState().setRoomEditor(null)
  const editing = target !== 'new' && !!existing

  const toggle = (id: string): void =>
    setDraft((d) => {
      const on = d.memberIds.includes(id)
      if (!on && d.memberIds.length >= MAX_MEMBERS) return d
      return { ...d, memberIds: on ? d.memberIds.filter((m) => m !== id) : [...d.memberIds, id] }
    })

  const save = async (): Promise<void> => {
    if (draft.memberIds.length < MIN_MEMBERS) return setError(`Pick at least ${MIN_MEMBERS} agents.`)
    setSaving(true)
    try {
      if (editing) {
        await api.updateRoom({ ...draft, id: existing.id })
        close()
      } else {
        const room = await api.createRoom(draft)
        close()
        useStore.getState().select(room.id)
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!existing) return
    await api.deleteRoom(existing.id)
    close()
  }

  return (
    <Modal onClose={close} width={520}>
      <div className="flex items-center border-b border-line px-5 py-3">
        <div className="flex-1 text-[15px] font-semibold">{editing ? 'Group chat settings' : 'New group chat'}</div>
        <IconButton label="Close" onClick={close}>
          <XIcon size={16} />
        </IconButton>
      </div>
      <div className="space-y-5 overflow-y-auto px-5 py-5">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => {
              const name = e.target.value
              setDraft((d) => ({ ...d, name }))
            }}
            placeholder="e.g. Brain trust"
            className={inputClass}
            autoFocus
          />
        </Field>
        <div>
          <div className="mb-1.5 flex items-baseline text-[12px] font-medium tracking-wide text-muted uppercase">
            <span className="flex-1">Members</span>
            <span className="normal-case tracking-normal">
              {draft.memberIds.length} of {MAX_MEMBERS} max
            </span>
          </div>
          <div className="space-y-1">
            {sortAgents(agents).map((a) => {
              const on = draft.memberIds.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(a.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition ${
                    on ? 'border-accent/60 bg-selected' : 'border-transparent hover:bg-hover'
                  }`}
                >
                  <Avatar seed={a.name} shape={a.shape} color={a.color} picture={agentPicture(a.id, a.avatarVersion)} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{a.name}</div>
                    <div className="truncate text-[12px] text-muted">{a.instructions.split('\n')[0] || 'General assistant'}</div>
                  </div>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      on ? 'border-accent-strong bg-accent-strong text-on-accent' : 'border-line-strong'
                    }`}
                  >
                    {on && <CheckIcon size={12} />}
                  </span>
                </button>
              )
            })}
            {agents.length < MIN_MEMBERS && (
              <div className="rounded-xl bg-elev px-3 py-3 text-[13px] text-muted">
                You need at least {MIN_MEMBERS} agents for a group chat. Create another agent first.
              </div>
            )}
          </div>
        </div>
        <Field label="Replies before pausing" hint="Agents take turns and can @mention each other. The group pauses after this many replies until you say something or press Keep going.">
          <Segmented
            value={String(draft.maxTurns)}
            options={TURN_OPTIONS.map((v) => ({ value: v, label: v }))}
            onChange={(v) => setDraft((d) => ({ ...d, maxTurns: Number(v) }))}
          />
        </Field>
        <div className="text-[12px] text-muted">
          Each agent keeps a separate memory for this group, so it won't mix with your one-on-one chats. Group chats can't
          propose actions that need your approval.
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {editing && (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        <div className="flex-1 truncate text-[12px] text-danger">{error}</div>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" disabled={saving || draft.memberIds.length < MIN_MEMBERS} onClick={() => void save()}>
          {editing ? 'Save' : 'Create group'}
        </Button>
      </div>
      {confirmDelete && existing && (
        <ConfirmDialog
          title={`Delete "${existing.name}"?`}
          body="This deletes the group chat and its messages. The agents themselves are kept."
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  )
}
