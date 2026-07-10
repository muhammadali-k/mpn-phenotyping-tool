import { useState } from 'react'
import { Check, ChevronRight, CircleHelp, TriangleAlert, X } from 'lucide-react'
import {
  FIELD_BY_KEY, GROUP_LABEL, GROUP_ORDER, type ClassifyResult, type Criterion, type CriterionStatus,
  type DiseaseAssessment, type Extraction, type PrognosisTool, type SourceTag,
} from '@/lib/engine'
import {
  CategoricalChip, Eyebrow, SourceChip, SourceProvider, SourceRail, type SourceItem, type Status,
} from '@/components/ui/primitives'
import { cx, fmtValue } from '@/lib/util'

const TIER_STATUS: Record<string, Status> = {
  vlow: 'success', low: 'success', int1: 'warn', int: 'warn', int2: 'warn', high: 'danger', vhigh: 'danger',
}
// Non-actionable provenance tags — teal stays reserved for actionable affordances.
const SRC_STYLE: Record<SourceTag, string> = {
  structured: 'text-info border-info/30 bg-info/8',
  pathology: 'text-ink border-line-strong bg-surface2',
  note: 'text-muted border-line bg-surface2',
}
const VERDICT_STATUS: Record<string, Status> = { confirmed: 'success', suspicious: 'warn', not: 'neutral' }
const VERDICT_WORD: Record<string, string> = { confirmed: 'Confirmed', suspicious: 'Suspicious — not confirmed', not: 'Criteria not met' }

export function Results({ result, extraction }: { result: ClassifyResult; extraction?: Extraction }) {
  const { diagnosis: dx, prognosis: prog, merged } = result
  const outcomeStatus: Status = dx.outcome === 'confirmed' ? 'success' : dx.outcome === 'suspicious' ? 'warn' : 'neutral'

  // deterministic citation list: [1] WHO, then one per applicable prognosis tool
  const sources: SourceItem[] = [{ n: 1, label: 'WHO ' + dx.whoEdition.replace('WHO ', ''), citation: 'WHO Classification of Haematolymphoid Tumours (2016 / 2022)' }]
  const toolChipN: Record<string, number> = {}
  prog.order.forEach((k) => {
    const t = prog.tools[k]
    if (!t) return
    const n = sources.length + 1
    toolChipN[k] = n
    sources.push({ n, label: t.name, citation: t.citation })
  })

  return (
    <SourceProvider>
      {/* diagnosis hero */}
      <div className="corners relative rounded-[10px] border border-line-strong bg-surface p-6 sm:p-8">
        <span className="cm tl" aria-hidden /><span className="cm tr" aria-hidden />
        <span className="cm bl" aria-hidden /><span className="cm br" aria-hidden />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{dx.whoEdition} · diagnostic assessment</Eyebrow>
            <h3 className="mt-2 font-display text-[30px] leading-[1.1] tracking-[-0.015em] sm:text-[36px]">
              {dx.headline}
              <SourceChip n={1} label={sources[0].label} />
            </h3>
          </div>
          <CategoricalChip status={outcomeStatus} className="mt-2">
            {dx.outcome === 'confirmed' ? 'Confirmed diagnosis' : dx.outcome === 'suspicious' ? 'Diagnosis not confirmed' : 'No confirmed MPN'}
          </CategoricalChip>
        </div>
        <p className="mt-4 max-w-[68ch] text-[14.5px] text-muted">{dx.summary}</p>
      </div>

      {/* per-disease assessments */}
      <div className="mt-5">
        <Eyebrow>Assessed independently · PV · ET · overt MF</Eyebrow>
        <div className="mt-3 space-y-3.5">
          {dx.assessments.map((a) => <DiseaseCard key={a.disease} a={a} />)}
        </div>
      </div>

      {/* prognosis */}
      <div className="mt-6">
        <Eyebrow>Prognostic assessment</Eyebrow>
        <div className="mt-3">
          <PrognosisSection result={result} toolChipN={toolChipN} />
        </div>
      </div>

      {/* caveats */}
      {dx.caveats.length > 0 && (
        <div className="mt-5 rounded-[10px] border border-line bg-surface2 px-5 py-4">
          <Eyebrow>Clinical caveats</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[12.5px] text-muted">
            {dx.caveats.map((c, i) => (
              <li key={i} className="flex gap-2"><span className="mt-[3px] h-[5px] w-[5px] shrink-0 rounded-full bg-faint" aria-hidden /><span>{c}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* resolved variables */}
      <div className="mt-5 rounded-[10px] border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h4 className="text-[15px] font-semibold">Resolved variables</h4>
          <div className="flex-1" />
          <span className="font-mono text-[10.5px] text-faint">source priority: structured › pathology › note</span>
        </div>
        <div className="px-5 py-4">
          {Object.keys(merged.variables).length === 0 ? (
            <p className="text-[13px] text-muted">No variables provided.</p>
          ) : (
            GROUP_ORDER.map((group) => {
              const keys = Object.keys(merged.variables).filter((k) => FIELD_BY_KEY[k]?.group === group)
              if (!keys.length) return null
              return (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{GROUP_LABEL[group]}</div>
                  <table className="w-full text-[13px]">
                    <tbody>
                      {keys.map((k) => {
                        const f = FIELD_BY_KEY[k]
                        const src = merged.sources[k] || 'note'
                        const meta = extraction?.fields?.[k]
                        return (
                          <tr key={k} className="border-b border-line last:border-0 align-top">
                            <td className="py-2 pr-3 text-muted">{f.label}{f.unit ? ` (${f.unit})` : ''}</td>
                            <td className="py-2 pr-3 font-mono tnum">
                              {fmtValue(merged.variables[k])}
                              {meta?.snippet && (
                                <span className="mt-0.5 block max-w-[36ch] font-sans text-[11px] not-italic text-faint">“{meta.snippet}”{meta.date ? ` · ${meta.date}` : ''}{meta.specimen ? ` · ${meta.specimen}` : ''}</span>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              <span className={cx('rounded-[5px] border px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em]', SRC_STYLE[src])}>{src}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
          <SourceRail sources={sources} />
        </div>
      </div>

      <div className="mt-5 flex gap-2.5 rounded-[8px] bg-[color-mix(in_srgb,var(--c-warn)_10%,transparent)] px-4 py-3.5 text-[12.5px] text-warn">
        <TriangleAlert size={17} className="mt-0.5 shrink-0" />
        <span><strong>Investigational output.</strong> An automated application of published WHO criteria for decision support — not a diagnosis. A qualified hematologist must confirm all findings.</span>
      </div>
    </SourceProvider>
  )
}

/* ------------------------------------------------------------ disease card */
function DiseaseCard({ a }: { a: DiseaseAssessment }) {
  const [open, setOpen] = useState(a.verdict !== 'not')
  const status = VERDICT_STATUS[a.verdict]
  const met = a.criteria.filter((c) => c.status === 'met')
  const notMet = a.criteria.filter((c) => c.status === 'not_met')
  const unavailable = a.criteria.filter((c) => c.status === 'unavailable')
  return (
    <div className={cx('rounded-[10px] border bg-surface', a.verdict === 'not' ? 'border-line' : 'border-line-strong')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2.5 px-5 py-4 text-left">
        <ChevronRight size={15} className={cx('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <span className="text-[15px] font-semibold">{a.name}</span>
        <span className="font-mono text-[11px] text-faint">{a.disease}</span>
        <div className="flex-1" />
        <CategoricalChip status={status}>{VERDICT_WORD[a.verdict]}</CategoricalChip>
      </button>
      {open && (
        <div className="border-t border-line px-5 py-4">
          <ul>
            {a.criteria.map((c, i) => <CriterionRow key={i} c={c} />)}
          </ul>
          {a.verdict === 'suspicious' && a.outstanding.length > 0 && (
            <div className="mt-3 rounded-[8px] bg-[color-mix(in_srgb,var(--c-warn)_10%,transparent)] px-3.5 py-3 text-[12.5px] text-warn">
              <div className="mb-1 font-medium">Additional information required for confirmation</div>
              <ul className="space-y-1">
                {a.outstanding.map((o, i) => <li key={i} className="flex gap-2"><span className="mt-[2px]">·</span><span>{o}</span></li>)}
              </ul>
            </div>
          )}
          <div className="mt-3 flex gap-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
            <span className="text-success">{met.length} met</span>
            <span className="text-danger">{notMet.length} not met</span>
            <span>{unavailable.length} unavailable / pending</span>
          </div>
        </div>
      )}
    </div>
  )
}

function critIcon(s: CriterionStatus) {
  if (s === 'met') return <Check size={13} />
  if (s === 'not_met') return <X size={13} />
  return <CircleHelp size={13} />
}
function critWord(s: CriterionStatus) {
  return s === 'met' ? 'Met' : s === 'not_met' ? 'Not met' : 'Unavailable or pending'
}
function critTone(s: CriterionStatus) {
  return s === 'met' ? 'bg-[color-mix(in_srgb,var(--c-success)_16%,transparent)] text-success'
    : s === 'not_met' ? 'bg-[color-mix(in_srgb,var(--c-danger)_14%,transparent)] text-danger'
    : 'bg-surface2 text-muted'
}
function CriterionRow({ c }: { c: Criterion }) {
  return (
    <li className="flex gap-3 border-b border-line py-3 last:border-0">
      <span role="img" aria-label={critWord(c.status)} className={cx('mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full', critTone(c.status))}>{critIcon(c.status)}</span>
      <div className="min-w-0">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">{c.disease} · {c.tier} · {critWord(c.status)}</div>
        <div className="text-[13.5px] leading-snug">{c.label}</div>
        {c.detail && <div className="mt-0.5 font-mono text-[11.5px] text-muted tnum">{c.detail}</div>}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------ prognosis */
function PrognosisSection({ result, toolChipN }: { result: ClassifyResult; toolChipN: Record<string, number> }) {
  const { prognosis: prog } = result
  if (prog.gatedReason) {
    const msg = prog.gatedReason === 'suspicious'
      ? 'Prognostic scoring is not performed while a diagnosis is only suspicious. Confirm the diagnosis to run the applicable prognostic model.'
      : prog.gatedReason === 'conflict'
      ? 'More than one diagnosis met full criteria — resolve the diagnostic conflict before prognostic scoring.'
      : 'No confirmed MPN — no prognostic model applies.'
    return (
      <div className="rounded-[10px] border border-line bg-surface px-5 py-6 text-[13px] text-muted">
        <span className="font-medium text-ink">Prognostic category not established.</span> {msg}
      </div>
    )
  }
  const applicable = prog.order.map((k) => prog.tools[k]).filter(Boolean) as PrognosisTool[]
  return (
    <div className="space-y-3.5">
      {applicable.map((t) => (
        <RiskCard key={t.key} tool={t} primary={t.key === prog.primaryKey} chipN={toolChipN[t.key]} />
      ))}
    </div>
  )
}

function RiskCard({ tool, primary, chipN }: { tool: PrognosisTool; primary: boolean; chipN: number }) {
  const [open, setOpen] = useState(primary)
  const established = tool.status === 'established'
  const status = established && tool.tier ? (TIER_STATUS[tool.tier] || 'neutral') : 'neutral'
  return (
    <div className={cx('rounded-[10px] border bg-surface', primary ? 'border-line-strong' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="text-[14.5px] font-semibold">{tool.name}</span>
        {chipN != null && <SourceChip n={chipN} label={tool.name} />}
        {primary && <span className="rounded-[5px] border border-line-strong px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">Primary</span>}
        <div className="flex-1" />
        {established ? (
          <CategoricalChip status={status}>{tool.category}{tool.total != null ? ` · ${tool.total} pts` : ''}</CategoricalChip>
        ) : (
          <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 font-mono text-[11px] text-muted">Category not established</span>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="text-[13px] text-muted">{tool.note}</p>
        {!established && tool.requiredMissing.length > 0 && (
          <div className="mt-2 flex gap-2.5 rounded-[8px] bg-[color-mix(in_srgb,var(--c-info)_9%,transparent)] px-3.5 py-2.5 text-[12px] text-info">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>Required but unavailable: <strong>{tool.requiredMissing.join(', ')}</strong>. No definitive category is assigned.</span>
          </div>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 font-mono text-[12px] text-accent" aria-expanded={open}>
          <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} />
          Scoring &amp; reference
        </button>
        {open && (
          <div className="mt-3">
            <table className="w-full text-[12.5px]">
              <tbody>
                {tool.points.map((p, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3">
                      {p.label}
                      {p.note && <div className="font-mono text-[11px] text-faint tnum">{p.note}</div>}
                    </td>
                    <td className="py-1.5 text-right font-mono font-medium text-muted tnum whitespace-nowrap">
                      {typeof p.pts === 'number' ? `+${p.pts}` : p.pts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2.5 text-[11.5px] text-faint">
              <span className="text-muted">Basis:</span> {tool.evidence}<br />
              <span className="text-muted">Reference:</span> {tool.citation}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
