import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { api, useStore } from '../lib/store'
import { listTime } from '../lib/format'
import { PinIcon } from './icons'
import { IconButton } from './ui'

/** Chat header button listing the chat's pinned messages; a click jumps to one. */
export function PinnedButton({ chatId }: { chatId: string }) {
  const messages = useStore((s) => s.messages[chatId])
  const [open, setOpen] = useState(false)
  const [pins, setPins] = useState<ChatMessage[]>([])
  const box = useRef<HTMLDivElement>(null)
  const count = messages?.filter((m) => m.pinned).length ?? 0

  useEffect(() => {
    if (open) void api.pinnedMessages(chatId).then(setPins)
  }, [open, chatId, count])

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', outside)
    return () => window.removeEventListener('mousedown', outside)
  }, [open])

  if (!count && !open) return null
  return (
    <div ref={box} className="relative">
      <IconButton label={`Pinned messages (${count})`} onClick={() => setOpen(!open)}>
        <PinIcon size={16} />
      </IconButton>
      {open && (
        <div className="pop absolute top-9 right-0 z-30 w-[340px] rounded-xl border border-line-strong bg-elev p-1 shadow-2xl">
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Pinned</div>
          {pins.length === 0 && <div className="px-2.5 py-2 text-[12px] text-muted">Nothing pinned.</div>}
          {pins.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setOpen(false)
                useStore.getState().openMessage(chatId, m.id)
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-hover"
            >
              <div className="line-clamp-2 text-[13px]">{m.text.replace(/[*_`#>]/g, '').slice(0, 200)}</div>
              <div className="text-[11px] text-muted">{listTime(m.createdAt)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
