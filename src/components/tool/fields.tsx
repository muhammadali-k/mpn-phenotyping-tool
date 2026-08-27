import { ChevronDown } from 'lucide-react'
import type { Field, SourceTag, VarValue } from '@/lib/engine'
import { cx } from '@/lib/util'
import { FIELD_HINTS, RANGES, type Validation } from './formSchema'

// Non-actionable provenance tags — teal stays reserved for actionable affordances.
const SRC_STYLE: Record<SourceTag, string> = {
  structured: 'text-info border-info/30 bg-info/8',
  pathology: 'text-ink border-line-strong bg-surface2',
  note: 'text-muted border-line bg-surface2',
}

function SourceTagChip({ src }: { src: SourceTag }) {
  return (
    <span className={cx('rounded-[5px] border px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em]', SRC_STYLE[src])}>
      {src}
    </span>
  )
}

// Fixed-height label row so every field's control starts at the same offset,
// keeping the two side-by-side cards aligned row-to-row.
function Label({ field, source, id, review }: { field: Field; source?: SourceTag | null; id?: string; review?: boolean }) {
  return (
    <span id={id} className="mb-1.5 flex min-h-[18px] items-baseline gap-2">
      <span className="text-[12.5px] font-medium leading-tight text-muted">{field.label}</span>
      {field.unit && <span className="whitespace-nowrap font-mono text-[10.5px] text-faint">{field.unit}</span>}
      <span className="flex-1" />
      {review && <span className="rounded-[5px] border border-warn/40 bg-[color-mix(in_srgb,var(--c-warn)_12%,transparent)] px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-warn">needs review</span>}
      {source && <SourceTagChip src={source} />}
    </span>
  )
}

/* guidance + validation under a control */
function FieldFoot({ fieldKey, validation }: { fieldKey: string; validation?: Validation | null }) {
  const hint = FIELD_HINTS[fieldKey]
  if (!hint && !validation) return null
  return (
    <span className="mt-1.5 block space-y-1">
      {validation && (
        <span role={validation.level === 'error' ? 'alert' : undefined} className={cx('block text-[12px] leading-snug', validation.level === 'error' ? 'text-danger' : 'text-warn')}>
          {validation.message}
        </span>
      )}
      {hint && <span className="block text-[12px] leading-snug text-faint">{hint}</span>}
    </span>
  )
}

// Uniform 40px control height so inputs, selects and tri-states line up.
const inputCls =
  'w-full h-10 rounded-[6px] border border-line-strong bg-surface2 px-3 text-[14px] outline-none transition-colors focus:border-focus focus:bg-surface'

export interface FieldProps {
  field: Field
  value: VarValue | undefined
  source?: SourceTag | null
  onChange: (v: VarValue | undefined) => void
  validation?: Validation | null
  review?: boolean
}

export function VarField({ field, value, source, onChange, validation, review }: FieldProps) {
  const invalid = validation?.level === 'error'
  // bool/list are <button> groups — not labelable by a wrapping <label>, so use
  // role="group" + aria-labelledby pointing at the field label.
  if (field.type === 'bool' || field.type === 'list') {
    const labelId = `lbl-${field.key}`
    return (
      <div role="group" aria-labelledby={labelId} className="block">
        <Label field={field} source={source} id={labelId} review={review} />
        {field.type === 'bool'
          ? <TriState value={value as boolean | undefined} onChange={onChange} labelId={labelId} />
          : <ChipMulti options={field.options || []} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} labelId={labelId} />}
        <FieldFoot fieldKey={field.key} validation={validation} />
      </div>
    )
  }
  const range = RANGES[field.key]
  return (
    <label className="block">
      <Label field={field} source={source} review={review} />
      {field.type === 'number' && (
        <input
          type="number" step="any" inputMode="decimal"
          min={range?.min} max={range?.max}
          aria-invalid={invalid || undefined}
          className={cx(inputCls, 'font-mono tnum', invalid && 'border-danger focus:border-danger', validation?.level === 'warn' && 'border-warn')}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        />
      )}
      {field.type === 'text' && (
        <input
          type="text" className={inputCls}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value.trim() === '' ? undefined : e.target.value)}
        />
      )}
      {field.type === 'enum' && (
        <div className="relative">
          <select
            className={cx(inputCls, 'appearance-none pr-9')}
            value={value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          >
            <option value="">–</option>
            {(field.options || []).map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <ChevronDown aria-hidden size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
        </div>
      )}
      <FieldFoot fieldKey={field.key} validation={validation} />
    </label>
  )
}

/* ---------------------------------------------------------------- GateRow
   A yes / no / unknown question that guards the detail fields beneath it
   ("Was this test performed?"). Details render only when the answer is yes;
   answering no or unknown clears them (see formSchema.applyChange). */
export function GateRow({ id, label, hint, value, onChange }: {
  id: string; label: string; hint?: string; value: VarValue | undefined; onChange: (v: VarValue | undefined) => void
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span id={id} className="block min-w-0">
        <span className="block text-[13.5px] font-semibold leading-snug text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-faint">{hint}</span>}
      </span>
      <div className="w-full shrink-0 sm:w-[236px]">
        <TriState value={value as boolean | undefined} onChange={onChange} labelId={id} />
      </div>
    </div>
  )
}

/* small inline status / guidance line under a group of fields */
export function StatusLine({ tone = 'muted', children }: { tone?: 'muted' | 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={cx(
      'rounded-[8px] px-3 py-2 text-[12.5px] leading-relaxed',
      tone === 'info' && 'bg-[color-mix(in_srgb,var(--c-info)_9%,transparent)] text-info',
      tone === 'warn' && 'bg-[color-mix(in_srgb,var(--c-warn)_10%,transparent)] text-warn',
      tone === 'muted' && 'bg-surface2 text-muted',
    )}>
      {children}
    </div>
  )
}

function TriState({ value, onChange, labelId }: { value: boolean | undefined; onChange: (v: VarValue | undefined) => void; labelId: string }) {
  const opts: [string, boolean | undefined][] = [['Yes', true], ['No', false], ['Unknown', undefined]]
  return (
    <div className="flex h-10 w-full overflow-hidden rounded-[6px] border border-line-strong">
      {opts.map(([lbl, val], i) => {
        const on = value === val || (value === undefined && val === undefined)
        return (
          <button
            key={lbl} type="button"
            aria-pressed={on} aria-labelledby={`${labelId} ${labelId}-${lbl}`} id={`${labelId}-${lbl}`}
            onClick={() => onChange(val)}
            className={cx(
              'flex flex-1 items-center justify-center text-[13px] transition-colors',
              i < 2 && 'border-r border-line',
              // a chosen yes / no reads as a decision (accent); the default "unknown"
              // stays neutral so an untouched form does not look like a wall of choices
              on && val !== undefined && 'bg-accent font-medium text-on-accent',
              on && val === undefined && 'bg-surface font-medium text-ink',
              !on && 'bg-surface2 text-muted hover:text-ink',
            )}
          >
            {lbl}
          </button>
        )
      })}
    </div>
  )
}

function ChipMulti({ options, value, onChange, labelId }: { options: string[]; value: string[]; onChange: (v: VarValue | undefined) => void; labelId: string }) {
  const toggle = (o: string) => {
    const next = value.includes(o) ? value.filter((x) => x !== o) : [...value, o]
    onChange(next.length ? next : undefined)
  }
  return (
    <div className="flex min-h-10 flex-wrap content-center items-center gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o} type="button" role="checkbox" aria-checked={on}
            aria-labelledby={`${labelId} ${labelId}-opt-${o}`} id={`${labelId}-opt-${o}`}
            onClick={() => toggle(o)}
            className={cx(
              'rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors',
              on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface2 text-muted hover:border-accent',
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}
