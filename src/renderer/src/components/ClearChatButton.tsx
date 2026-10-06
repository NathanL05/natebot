import { useState } from 'react'
import { useStore } from '../lib/store'
import { EraserIcon } from './icons'
import { ConfirmDialog, IconButton } from './ui'

/** Chat header button that clears the conversation, after asking. ⌘K opens the same question. */
export function ClearChatButton({ chatId, name, running, group }: { chatId: string; name: string; running: boolean; group?: boolean }) {
  const asking = useStore((s) => s.clearingId === chatId)
  const empty = useStore((s) => !s.messages[chatId]?.some((m) => !m.pinned))
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    setError(null)
    useStore.setState({ clearingId: null })
  }

  const clear = async (): Promise<void> => {
    try {
      await useStore.getState().clearChat(chatId)
      close()
    } catch (e) {
      // Electron prefixes errors thrown in main ("Error invoking remote method …: Error: …").
      setError((e as Error).message.replace(/^.*Error: /, ''))
    }
  }

  return (
    <>
      <IconButton
        label={running ? 'Clear chat (stop it first)' : 'Clear chat'}
        disabled={running || empty}
        onClick={() => useStore.setState({ clearingId: chatId })}
      >
        <EraserIcon size={16} />
      </IconButton>
      {asking && (
        <ConfirmDialog
          title={`Clear ${group ? `"${name}"` : `your chat with ${name}`}?`}
          body={
            error ?? (
              <>
                This deletes the messages here, including any proposals still waiting for you. Pinned messages stay.{' '}
                {group ? 'The agents start this group conversation fresh.' : `${name} starts a fresh conversation, keeping its lasting notes.`}{' '}
                This can't be undone.
              </>
            )
          }
          confirmLabel="Clear chat"
          danger
          onCancel={close}
          onConfirm={() => void clear()}
        />
      )}
    </>
  )
}
