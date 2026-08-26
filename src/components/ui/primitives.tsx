import { createContext, useContext, useState, type ReactNode } from 'react'
import { cx } from '@/lib/util'

/* ---------------------------------------------------------------- Eyebrow
   The two canonical mono micro-label roles, used everywhere for consistency:
   - Eyebrow: 11.5px / 0.14em / medium — section kickers, card eyebrows.
   - Meta:    10.5px / 0.1em          — table headers, in-card captions, rails. */
export function Eyebrow({ children, className, tone = 'muted' }: { children: ReactNode; className?: string; tone?: 'muted' | 'faint' }) {
  return (
    <span className={cx('font-mono text-[11.5px] font-medium uppercase tracking-[0.14em]', tone === 'faint' ? 'text-faint' : 'text-muted', className)}>
      {children}
    </span>
  )
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint', className)}>
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- corner plus-marks */
export function Corners() {
  return (
    <>
      <span className="cm tl" aria-hidden />
      <span className="cm tr" aria-hidden />
      <span className="cm bl" aria-hidden />
      <span className="cm br" aria-hidden />
    </>
  )
}

/* ---------------------------------------------------------------- Card */
export function Card({
  children, className, corners = false, hoverable = false, as: Tag = 'div',
}: {
  children: ReactNode; className?: string; corners?: boolean; hoverable?: boolean; as?: 'div' | 'section' | 'article'
}) {
  return (
    <Tag
      className={cx(
        'relative rounded-[10px] border border-line bg-surface',
        corners && 'corners',
        hoverable && 'transition-colors duration-200 hover:border-line-strong',
        className,
      )}
    >
      {corners && <Corners />}
      {children}
    </Tag>
  )
}

/* ---------------------------------------------------------------- Button */
type BtnProps = {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ children, variant = 'primary', size = 'md', className, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[8px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-3.5 py-2 text-[13.5px]' : 'px-5 py-2.5 text-[14.5px]',
        variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent-hover',
        variant === 'outline' && 'border border-line-strong text-ink hover:border-accent hover:text-accent',
        variant === 'ghost' && 'text-muted hover:bg-surface2 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- StatTile */
export function StatTile({ figure, label, className, corners = false }: { figure: ReactNode; label: string; className?: string; corners?: boolean }) {
  return (
    <div className={cx('relative px-6 py-8', corners && 'corners', className)}>
      {corners && <Corners />}
      <div className="font-display text-[40px] leading-none tracking-[-0.02em] tnum">{figure}</div>
      <div className="mt-3 text-[13.5px] text-muted">{label}</div>
    </div>
  )
}

/* ---------------------------------------------------------------- CategoricalChip (semantic status ONLY) */
export type Status = 'success' | 'warn' | 'danger' | 'info' | 'neutral'
const STATUS_STYLE: Record<Status, string> = {
  success: 'text-success', warn: 'text-warn', danger: 'text-danger', info: 'text-info', neutral: 'text-muted',
}
export function CategoricalChip({ status = 'neutral', children, className }: { status?: Status; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 rounded-full border border-line bg-surface2 px-2.5 py-1 font-mono text-[11.5px] font-medium tracking-wide', STATUS_STYLE[status], className)}>
      <span className="inline-block h-[7px] w-[7px] rounded-full bg-current" aria-hidden />
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- Source-chip / source-rail wiring
   Provenance rendered as the visible "wiring" of the interface. A SourceProvider
   collects citations; each SourceChip registers one and highlights its rail row on hover. */
export interface SourceItem { n: number; label: string; citation: string }
interface SourceCtx { active: number | null; setActive: (n: number | null) => void }
const SourceContext = createContext<SourceCtx | null>(null)

export function SourceProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<number | null>(null)
  return <SourceContext.Provider value={{ active, setActive }}>{children}</SourceContext.Provider>
}

export function useSources() {
  return useContext(SourceContext)
}

export function SourceChip({ n, label }: { n: number; label: string }) {
  const ctx = useSources()
  const activeCls = ctx?.active === n
  return (
    <button
      type="button"
      onMouseEnter={() => ctx?.setActive(n)}
      onMouseLeave={() => ctx?.setActive(null)}
      onFocus={() => ctx?.setActive(n)}
      onBlur={() => ctx?.setActive(null)}
      className={cx(
        'ml-1 inline-flex translate-y-[-2px] items-center gap-1 rounded-[6px] border px-1.5 py-0.5 align-super font-mono text-[9.5px] font-medium tracking-wide transition-colors',
        activeCls ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-accent-soft text-accent hover:border-accent',
      )}
      aria-label={`Source ${n}: ${label}`}
    >
      <span className="tnum">{n}</span>
      <span className="opacity-80">{label}</span>
    </button>
  )
}

/* rail rendered at a card foot; rows light when their chip is active */
export function SourceRail({ sources }: { sources: SourceItem[] }) {
  const ctx = useSources()
  if (!sources.length) return null
  return (
    <div className="mt-4 border-t border-line pt-3">
      <Meta className="mb-2 block">Sources</Meta>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <li
            key={s.n}
            className={cx(
              'flex gap-2.5 rounded-[6px] px-1.5 py-1 text-[12px] transition-colors',
              ctx?.active === s.n ? 'bg-accent-soft' : '',
            )}
          >
            <span className="mt-[1px] font-mono text-[11px] font-medium text-accent tnum">{s.n}</span>
            <span className="text-muted">
              <span className="font-medium text-ink">{s.label}</span>: {s.citation}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- StepMarker */
export function StepMarker({ n, label, active = false }: { n: string; label: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-2 sm:gap-2.5">
      <span className={cx('font-mono text-[12px] font-medium tnum', active ? 'text-accent' : 'text-faint')}>{n}</span>
      <span className={cx('h-[1px] w-3 sm:w-4', active ? 'bg-accent' : 'bg-line-strong')} aria-hidden />
      <span className={cx('hidden font-mono text-[11px] uppercase tracking-[0.12em] sm:inline', active ? 'text-ink' : 'text-muted')}>{label}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- NumericCell */
export function NumericCell({ value, unit, range, className }: { value: ReactNode; unit?: string; range?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-baseline gap-1 font-mono tnum', className)}>
      <span className="text-ink">{value}</span>
      {unit && <span className="text-[0.82em] text-faint">{unit}</span>}
      {range && <span className="ml-1 text-[0.72em] text-faint">({range})</span>}
    </span>
  )
}
