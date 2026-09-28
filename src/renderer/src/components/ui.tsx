// Small shared UI primitives.
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'bg-elev-2 text-fg hover:brightness-110',
  ghost: 'text-fg hover:bg-hover',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 whitespace-nowrap text-[13px] font-medium transition disabled:cursor-default disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}

export function IconButton({
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg ${className}`}
      {...rest}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${checked ? 'bg-success' : 'bg-elev-2'}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-elev p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-3 text-[13px] transition ${
            value === o.value ? 'bg-elev-2 font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium tracking-wide text-muted uppercase">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </label>
  )
}

/** Text field look without a width, for inline fields. */
export const inputBase =
  'rounded-lg border border-line bg-elev px-3 py-2 text-[14px] text-fg outline-none placeholder:text-muted focus:border-accent'
export const inputClass = `${inputBase} w-full`

export function Modal({
  onClose,
  children,
  width = 560
}: {
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="pop flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel
}: {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal onClose={onCancel} width={380}>
      <div className="p-5">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-2 text-[13px] leading-relaxed text-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
