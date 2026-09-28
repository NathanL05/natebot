import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/store'
import { ACCEPTED_TYPES, squareImage } from '../lib/avatars'

/**
 * Wraps an avatar so clicking it offers "Choose picture…" and "Reset to
 * default". target is 'user' or 'agent:<id>'.
 */
export function AvatarEditor({
  target,
  hasPicture,
  onChanged,
  children,
  label = 'Change picture',
  placement = 'below'
}: {
  target: string
  hasPicture: boolean
  onChanged?: (version: number | null) => void
  children: ReactNode
  label?: string
  placement?: 'below' | 'above'
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const apply = async (dataUrl: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onChanged?.(await api.setAvatar(target, dataUrl))
      setOpen(false)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      await apply(await squareImage(file))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div ref={root} className="no-drag relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group relative block rounded-full"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {children}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {busy ? '…' : 'Edit'}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {open && (
        <div role="menu" className={`pop absolute left-0 z-50 w-52 ${placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} rounded-xl border border-line bg-bg p-1 shadow-2xl`}>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-hover"
          >
            Choose picture…
            <div className="text-[11px] text-muted">PNG, JPG or GIF · cropped to a square</div>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy || !hasPicture}
            onClick={() => void apply(null)}
            className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Reset to default
          </button>
          {error && <div className="px-3 pt-1 pb-2 text-[12px] text-danger">{error}</div>}
        </div>
      )}
    </div>
  )
}
