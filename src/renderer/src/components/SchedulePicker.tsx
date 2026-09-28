import { DAY_NAMES, describeCron, fromCron, toCron, type ScheduleSpec } from '@shared/schedule'
import { inputBase } from './ui'

type Kind = ScheduleSpec['kind']

const KINDS: { value: Kind; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'hourly', label: 'Every few hours' },
  { value: 'custom', label: 'Custom (cron)' }
]

const selectClass = `${inputBase} h-9 py-0 pr-8`

function timeOf(spec: ScheduleSpec): string {
  return 'time' in spec ? spec.time : '08:00'
}

export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p) => /^[\d*,/-]+$/.test(p))
}

export function SchedulePicker({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const spec = fromCron(cron)
  const emit = (next: ScheduleSpec): void => onChange(toCron(next))

  const changeKind = (kind: Kind): void => {
    const time = timeOf(spec)
    switch (kind) {
      case 'daily':
        return emit({ kind, time })
      case 'weekdays':
        return emit({ kind, time })
      case 'weekly':
        return emit({ kind, day: 1, time })
      case 'hourly':
        return emit({ kind, every: 2, minute: 0 })
      case 'custom':
        return emit({ kind, cron })
    }
  }

  const valid = isValidCron(cron)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select className={`${selectClass}`} value={spec.kind} onChange={(e) => changeKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {spec.kind === 'weekly' && (
          <select
            className={`${selectClass}`}
            value={spec.day}
            onChange={(e) => emit({ ...spec, day: Number(e.target.value) })}
          >
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        )}

        {(spec.kind === 'daily' || spec.kind === 'weekdays' || spec.kind === 'weekly') && (
          <input
            type="time"
            className={`${inputBase} h-9 py-0`}
            value={spec.time}
            onChange={(e) => e.target.value && emit({ ...spec, time: e.target.value })}
          />
        )}

        {spec.kind === 'hourly' && (
          <select
            className={`${selectClass}`}
            value={spec.every}
            onChange={(e) => emit({ ...spec, every: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
              <option key={n} value={n}>
                every {n} hour{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        )}

        {spec.kind === 'custom' && (
          <input
            className={`${inputBase} h-9 w-48 py-0 font-mono text-[13px]`}
            value={cron}
            placeholder="0 8 * * 1-5"
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      <div className={`text-[12px] ${valid ? 'text-muted' : 'text-danger'}`}>
        {valid ? describeCron(cron) : 'Enter 5 cron fields: minute hour day month weekday'}
        {valid && <span className="ml-2 font-mono opacity-60">{cron}</span>}
      </div>
    </div>
  )
}
