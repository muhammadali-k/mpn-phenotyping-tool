import type { VarValue } from '@/lib/engine'

/* ------------------------------------------------------------------------
   Structured-form schema: gates, visibility, and consistency.

   The clinical engine (src/lib/engine.ts) is untouched. This layer decides
   WHICH questions are asked, in WHAT order, and keeps the answers internally
   consistent, so the form can never submit a contradictory state such as
   "HMR mutations present" together with "HMR panel performed = no".

   Two kinds of rules:
   - reconcile(form): data-consistency, idempotent. Applied on every change and
     when a form is seeded from an extraction. Concrete evidence wins: a listed
     mutation implies the panel was performed; a measured spleen implies
     splenomegaly; "triple negative" implies the three drivers were negative.
   - applyChange(form, key, value): user intent on interaction. Closing a gate
     (answering "no" / "unknown") clears everything behind it, so nothing is
     ever submitted hidden.

   UI-only gate keys are prefixed "_ui_" and are never sent to the engine.
   ------------------------------------------------------------------------ */

export type FormState = Record<string, VarValue | undefined>

export const UI_DRIVER_TESTED = '_ui_driver_tested'
export const UI_KARYOTYPE_TESTED = '_ui_karyotype_tested'
export const isUiKey = (k: string) => k.startsWith('_ui_')

export const DRIVER_KEYS = ['jak2_v617f', 'jak2_exon12', 'calr', 'mpl', 'bcr_abl1'] as const
export const TRIPLE_KEYS = ['jak2_v617f', 'calr', 'mpl'] as const
export const KARYOTYPE_KEYS = ['karyotype_risk', 'karyotype_detail'] as const
export const HMR_KEYS = ['hmr_mutations'] as const

/* ---- helpers */
const defined = (v: VarValue | undefined) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
const anyDefined = (f: FormState, keys: readonly string[]) => keys.some((k) => defined(f[k]))
const clear = (f: FormState, keys: readonly string[]) => { keys.forEach((k) => { f[k] = undefined }) }
const isPos = (v: VarValue | undefined) => v === 'positive'
const num = (v: VarValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function hmrList(f: FormState): string[] {
  return Array.isArray(f.hmr_mutations) ? (f.hmr_mutations as string[]) : []
}

/* Triple negative is DERIVED from the three drivers, never asked separately:
   all three documented negative -> true; any positive -> false; otherwise
   unknown (a driver still untested). Exon 12 is not part of the definition. */
export function deriveTripleNegative(f: FormState): boolean | undefined {
  const anyPositive = isPos(f.jak2_v617f) || isPos(f.jak2_exon12) || (defined(f.calr) && f.calr !== 'negative') || isPos(f.mpl)
  if (anyPositive) return false
  const allNeg = TRIPLE_KEYS.every((k) => f[k] === 'negative')
  return allNeg ? true : undefined
}

/* Any molecular or cytogenetic test open? (a clonal marker is only knowable then) */
export function anyMolecularTestOpen(f: FormState): boolean {
  return f[UI_DRIVER_TESTED] === true || f.hmr_tested === true || f[UI_KARYOTYPE_TESTED] === true
}

/* ---- data-consistency (idempotent) */
export function reconcile(input: FormState): FormState {
  const f: FormState = { ...input }

  /* demographics: a measured spleen (> 0 cm) is a palpable spleen */
  const spleen = num(f.spleen_cm)
  if (spleen !== null && spleen > 0) f.splenomegaly = true
  if (f.splenomegaly !== true) f.spleen_cm = undefined
  if (defined(f.thrombosis_type)) f.prior_thrombosis = true
  if (f.prior_thrombosis !== true) f.thrombosis_type = undefined

  /* drivers: "triple negative" documented without individual results means
     the three drivers were tested and negative */
  if (f.triple_negative === true) {
    TRIPLE_KEYS.forEach((k) => { if (!defined(f[k])) f[k] = 'negative' })
  }
  if (anyDefined(f, DRIVER_KEYS)) f[UI_DRIVER_TESTED] = true
  if (f[UI_DRIVER_TESTED] === true) {
    f.triple_negative = deriveTripleNegative(f)
  } else {
    clear(f, DRIVER_KEYS)
    f.triple_negative = undefined
  }

  /* HMR panel: a listed mutation is proof the panel was performed */
  if (hmrList(f).length > 0) f.hmr_tested = true
  if (f.hmr_tested !== true) clear(f, HMR_KEYS)

  /* karyotype */
  if (anyDefined(f, KARYOTYPE_KEYS)) f[UI_KARYOTYPE_TESTED] = true
  if (f[UI_KARYOTYPE_TESTED] !== true) clear(f, KARYOTYPE_KEYS)

  return f
}

/* ---- user interaction: closing a gate clears what it guards, then reconcile */
export function applyChange(form: FormState, key: string, value: VarValue | undefined): FormState {
  const next: FormState = { ...form, [key]: value }

  if (key === UI_DRIVER_TESTED && value !== true) { clear(next, DRIVER_KEYS); next.triple_negative = undefined }
  if (key === 'hmr_tested' && value !== true) clear(next, HMR_KEYS)
  if (key === UI_KARYOTYPE_TESTED && value !== true) clear(next, KARYOTYPE_KEYS)
  if (key === 'splenomegaly' && value !== true) next.spleen_cm = undefined
  if (key === 'prior_thrombosis' && value !== true) next.thrombosis_type = undefined
  /* clearing the parent value of a derived driver state is handled by reconcile */

  const out = reconcile(next)

  /* a clonal marker cannot be known when no molecular/cytogenetic test is open */
  const gateKeys: string[] = [UI_DRIVER_TESTED, 'hmr_tested', UI_KARYOTYPE_TESTED]
  if (gateKeys.includes(key) && !anyMolecularTestOpen(out)) out.clonal_marker_present = undefined

  return out
}

/* ---- visibility of a field in the generic (non-molecular) groups */
export function isVisible(key: string, f: FormState): boolean {
  switch (key) {
    case 'spleen_cm': return f.splenomegaly === true
    case 'thrombosis_type': return f.prior_thrombosis === true
    case 'ldh_uln': return defined(f.ldh) || defined(f.ldh_uln)
    default: return true
  }
}

/* ---- plausibility: a value outside these bounds is impossible in the field's
   unit and is almost always a unit slip (g/L for g/dL, a fraction for a percent,
   cells/µL for ×10⁹/L) or a typing slip. Errors block the run; warnings do not. */
export interface Validation { level: 'error' | 'warn'; message: string }
export const RANGES: Record<string, { min: number; max: number; unitHint?: string }> = {
  age: { min: 0, max: 120 },
  spleen_cm: { min: 0, max: 40 },
  hemoglobin: { min: 3, max: 25, unitHint: 'Enter g/dL (for example 14.5), not g/L (145).' },
  hematocrit: { min: 10, max: 80, unitHint: 'Enter a percentage (for example 45), not a fraction (0.45).' },
  wbc: { min: 0.1, max: 500, unitHint: 'Enter ×10⁹/L (for example 6.8), not cells/µL (6800).' },
  platelets: { min: 1, max: 3000, unitHint: 'Enter ×10⁹/L (for example 245), not cells/µL (245000).' },
  ldh: { min: 1, max: 20000 },
  ldh_uln: { min: 50, max: 1000, unitHint: 'The reference upper limit must be a positive value in U/L.' },
  peripheral_blasts: { min: 0, max: 100, unitHint: 'Blasts are a percentage of peripheral white cells (0 to 100).' },
}

export function validateForm(f: FormState): Record<string, Validation> {
  const out: Record<string, Validation> = {}
  Object.keys(RANGES).forEach((k) => {
    const raw = f[k]
    if (raw === undefined || raw === null || raw === '') return
    const v = typeof raw === 'number' ? raw : Number(raw)
    const r = RANGES[k]
    if (!Number.isFinite(v)) { out[k] = { level: 'error', message: 'Enter a number.' }; return }
    if (v < r.min || v > r.max) {
      out[k] = { level: 'error', message: `Outside the plausible range ${r.min} to ${r.max}.${r.unitHint ? ' ' + r.unitHint : ''}` }
    }
  })
  /* cross-checks (only when both values are individually plausible) */
  const hb = num(f.hemoglobin), hct = num(f.hematocrit)
  if (hb !== null && hct !== null && !out.hemoglobin && !out.hematocrit && Math.abs(hct - 3 * hb) > 9) {
    out.hematocrit = { level: 'warn', message: `Hematocrit ${hct}% and hemoglobin ${hb} g/dL disagree (hematocrit is usually about 3 × hemoglobin); check both values.` }
  }
  if (f.transfusion_dependent === true && hb !== null && hb >= 12) {
    out.transfusion_dependent = { level: 'warn', message: `Transfusion dependence with a hemoglobin of ${hb} g/dL; confirm, as a recent transfusion can mask anemia.` }
  }
  return out
}
export const hasBlockingErrors = (v: Record<string, Validation>) => Object.values(v).some((x) => x.level === 'error')

/* ---- per-field guidance shown under the control */
export const FIELD_HINTS: Record<string, string> = {
  ldh_uln: 'If left blank, 250 U/L is assumed.',
  karyotype_detail: 'Annotation only; karyotype risk is the scored field.',
  cv_risk_factors: 'Recorded in the summary; not used in scoring.',
  granulocytic_proliferation: 'Recorded in the summary; not used in scoring.',
  decreased_erythropoiesis: 'Recorded in the summary; not used in scoring.',
  reactive_thrombocytosis_excluded: 'Used for the ET minor criterion.',
  reactive_cause_excluded: 'Used for the overt-MF clonality criterion.',
}

/* ---- engine payload: drop UI-only keys and blanks */
export function engineVariables(f: FormState): FormState {
  const out: FormState = {}
  Object.keys(f).forEach((k) => {
    if (isUiKey(k)) return
    if (!defined(f[k])) return
    out[k] = f[k]
  })
  return out
}
