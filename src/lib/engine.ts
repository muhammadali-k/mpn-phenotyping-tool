/*
 * MPN Phenotyping Engine (TypeScript)
 * -----------------------------------
 * Diagnostic + prognostic logic for three myeloproliferative neoplasms only:
 *   - Polycythemia vera (PV)
 *   - Essential thrombocythemia (ET)
 *   - Overt (fibrotic) primary myelofibrosis (overt MF)
 * Prefibrotic MF and all other MPN subtypes are intentionally out of scope.
 *
 * Each disease is assessed INDEPENDENTLY and mapped to one of seven outcomes:
 *   1 Confirmed PV        2 Confirmed ET        3 Confirmed overt MF
 *   4 Suspicious for PV — diagnosis not confirmed
 *   5 Suspicious for ET — diagnosis not confirmed
 *   6 Suspicious for overt MF — diagnosis not confirmed
 *   7 No confirmed MPN
 *
 * Core rules (WHO 2016/2022; ICC 2022 concordant for these three):
 *   - Confirm a disease ONLY when every required criterion for that disease is met.
 *   - A criterion is met | not_met | unavailable. "unavailable" (missing / pending /
 *     not performed / indeterminate) is NEVER treated as a negative.
 *   - "Suspicious" = at least one disease-defining criterion met, the disease is not
 *     hard-excluded, and the only gaps are unavailable criteria — full criteria not met.
 *   - Prognostic scoring runs ONLY after a disease is confirmed, with the single model
 *     family applicable to that disease, and never imputes missing required variables.
 *
 * 5 stages: extraction -> normalize -> merge (structured > pathology > note)
 *           -> WHO diagnosis (independent) -> prognosis (confirmed only).
 * Not a medical device. Investigational decision-support prototype only.
 */

// ---------------------------------------------------------------- types
export type FieldType = 'number' | 'enum' | 'bool' | 'list' | 'text'
export type FieldGroup = 'demographics' | 'labs' | 'molecular' | 'pathology'
export type FieldSource = 'struct' | 'llm' | 'either'

export interface Field {
  group: FieldGroup
  key: string
  label: string
  type: FieldType
  options: string[] | null
  source: FieldSource
  unit: string
}

export type VarValue = string | number | boolean | string[]
export type Variables = Record<string, VarValue>
export type SourceTag = 'structured' | 'pathology' | 'note'

// Per-field finding status. Distinguishes documented findings from the several
// flavours of "we don't know" — none of which may be read as a negative result.
export type FieldStatus =
  | 'positive' | 'negative' | 'normal' | 'equivocal'
  | 'pending' | 'not_performed' | 'unavailable' | 'not_documented'

// Rich per-field provenance captured during extraction. `variables`/`sources`
// remain the authoritative inputs to diagnosis; FieldMeta adds traceability
// (verbatim snippet, unit, date, specimen, qualifier) without changing them.
export interface FieldMeta {
  value: VarValue | null
  status: FieldStatus
  unit?: string
  date?: string
  qualifier?: string
  specimen?: string
  snippet?: string
  sourceTag: SourceTag
}

export interface Extraction {
  variables: Variables
  sources: Record<string, SourceTag>
  fields: Record<string, FieldMeta>
  needsReview: string[]
  rationale: string
  impression: string
}

// A documented status means the finding was actually established (present/absent/
// normal). Everything else is "unavailable" and must NOT enter `variables`.
export function isDocumentedStatus(s: FieldStatus): boolean {
  return s === 'positive' || s === 'negative' || s === 'normal'
}

export type CriterionStatus = 'met' | 'not_met' | 'unavailable'
export type DiseaseCode = 'PV' | 'ET' | 'MF'
export interface Criterion {
  disease: DiseaseCode
  tier: 'major' | 'minor'
  label: string
  status: CriterionStatus
  detail: string
}

export type DiseaseVerdict = 'confirmed' | 'suspicious' | 'not'
export interface DiseaseAssessment {
  disease: DiseaseCode
  name: string
  verdict: DiseaseVerdict
  label: string
  criteria: Criterion[]
  metCount: number
  notMetCount: number
  unavailableCount: number
  outstanding: string[] // additional info required for confirmation
}

export type Outcome = 'confirmed' | 'suspicious' | 'none'
export interface Diagnosis {
  outcome: Outcome
  code: string // convenience for exports/filenames: 'PV' | 'ET' | 'MF' | 'SUSPICIOUS' | 'NONE'
  headline: string
  whoEdition: string
  summary: string
  assessments: DiseaseAssessment[] // one per disease, always in PV, ET, MF order
  confirmed: DiseaseCode[]
  suspicious: DiseaseCode[]
  caveats: string[]
  conflict: boolean // >1 disease confirmed (should be unreachable; safety flag)
}

export type RiskTier = 'vlow' | 'low' | 'int1' | 'int' | 'int2' | 'high' | 'vhigh'
export type PrognosisStatus = 'established' | 'not_established'
export interface ScorePoint { label: string; pts: number | string; note: string }
export interface PrognosisTool {
  key: string
  name: string
  applicable: boolean
  status: PrognosisStatus
  category: string | null
  tier: RiskTier | null
  total: number | null
  requiredMissing: string[]
  points: ScorePoint[]
  note: string
  evidence: string
  citation: string
}
export interface Prognosis {
  primaryKey: string | null
  order: string[]
  tools: Record<string, PrognosisTool>
  missing: string[]
  gatedReason: 'suspicious' | 'none' | 'conflict' | null // why no scoring ran (null = ran)
  diseaseConfirmed: DiseaseCode | null
}

export type ProviderKey = 'groq' | 'puter' | 'webllm' | 'openai' | 'anthropic' | 'gemini'
export interface Provider {
  key: ProviderKey
  label: string
  accent: string
  keyPlaceholder: string
  keyHelp: string
  keyPattern: RegExp
  models: string[]
  defaultModel: string
  keyless?: boolean
  onDevice?: boolean
  getKeyUrl?: string
}

export interface LLMConfig { provider: ProviderKey; key: string; model: string }
export interface LLMResult { raw: unknown; provider: ProviderKey; model: string }

// ---------------------------------------------------------------- schema
const FIELDS_RAW: Array<[FieldGroup, string, string, FieldType, string[] | null, FieldSource, string]> = [
  ['demographics', 'age', 'Age', 'number', null, 'struct', 'yr'],
  ['demographics', 'sex', 'Sex', 'enum', ['male', 'female'], 'struct', ''],
  ['demographics', 'constitutional_symptoms', 'Constitutional symptoms', 'bool', null, 'either', ''],
  ['demographics', 'splenomegaly', 'Palpable splenomegaly', 'bool', null, 'either', ''],
  ['demographics', 'spleen_cm', 'Spleen (cm below costal margin)', 'number', null, 'either', 'cm'],
  ['demographics', 'prior_thrombosis', 'Prior thrombosis', 'bool', null, 'either', ''],
  ['demographics', 'thrombosis_type', 'Thrombosis type', 'enum', ['arterial', 'venous', 'both'], 'either', ''],
  ['demographics', 'cv_risk_factors', 'Cardiovascular risk factors', 'bool', null, 'either', ''],
  ['demographics', 'transfusion_dependent', 'Transfusion dependent', 'bool', null, 'either', ''],
  ['demographics', 'reactive_thrombocytosis_excluded', 'Reactive thrombocytosis excluded', 'bool', null, 'either', ''],

  ['labs', 'hemoglobin', 'Hemoglobin', 'number', null, 'struct', 'g/dL'],
  ['labs', 'hematocrit', 'Hematocrit', 'number', null, 'struct', '%'],
  ['labs', 'wbc', 'WBC', 'number', null, 'struct', '×10⁹/L'],
  ['labs', 'platelets', 'Platelets', 'number', null, 'struct', '×10⁹/L'],
  ['labs', 'ldh', 'LDH', 'number', null, 'struct', 'U/L'],
  ['labs', 'ldh_uln', 'LDH upper limit of normal', 'number', null, 'struct', 'U/L'],
  ['labs', 'peripheral_blasts', 'Peripheral-blood blasts', 'number', null, 'either', '%'],
  ['labs', 'epo', 'Serum erythropoietin', 'enum', ['low', 'normal', 'high'], 'either', ''],

  ['molecular', 'jak2_v617f', 'JAK2 V617F', 'enum', ['positive', 'negative'], 'struct', ''],
  ['molecular', 'jak2_exon12', 'JAK2 exon 12', 'enum', ['positive', 'negative'], 'struct', ''],
  ['molecular', 'calr', 'CALR', 'enum', ['type1', 'type2', 'other', 'negative'], 'struct', ''],
  ['molecular', 'mpl', 'MPL', 'enum', ['positive', 'negative'], 'struct', ''],
  ['molecular', 'bcr_abl1', 'BCR-ABL1', 'enum', ['positive', 'negative'], 'struct', ''],
  ['molecular', 'triple_negative', 'Triple negative', 'bool', null, 'struct', ''],
  ['molecular', 'clonal_marker_present', 'Other clonal marker present', 'bool', null, 'either', ''],
  ['molecular', 'hmr_mutations', 'High-molecular-risk mutations', 'list', ['ASXL1', 'EZH2', 'SRSF2', 'IDH1', 'IDH2', 'U2AF1Q157'], 'struct', ''],
  ['molecular', 'hmr_tested', 'HMR / extended NGS panel performed', 'bool', null, 'either', ''],
  ['molecular', 'karyotype_risk', 'Karyotype risk', 'enum', ['favorable', 'unfavorable', 'very_high'], 'struct', ''],
  ['molecular', 'karyotype_detail', 'Karyotype detail', 'text', null, 'either', ''],

  ['pathology', 'bm_cellularity', 'Marrow cellularity', 'enum', ['hypercellular', 'normocellular', 'hypocellular'], 'llm', ''],
  ['pathology', 'megakaryocyte_pattern', 'Megakaryocyte morphology', 'enum', ['large_mature', 'pleomorphic', 'atypical_clustered', 'normal'], 'llm', ''],
  ['pathology', 'reticulin_fibrosis_grade', 'Reticulin/collagen fibrosis (MF grade)', 'enum', ['0', '1', '2', '3'], 'llm', ''],
  ['pathology', 'panmyelosis', 'Trilineage panmyelosis', 'bool', null, 'llm', ''],
  ['pathology', 'granulocytic_proliferation', 'Granulocytic proliferation', 'bool', null, 'llm', ''],
  ['pathology', 'decreased_erythropoiesis', 'Decreased erythropoiesis', 'bool', null, 'llm', ''],
  ['pathology', 'leukoerythroblastosis', 'Leukoerythroblastic blood film', 'bool', null, 'llm', ''],
  ['pathology', 'reactive_cause_excluded', 'Reactive cause of fibrosis excluded', 'bool', null, 'either', ''],
  ['pathology', 'red_cell_mass', 'Red cell mass', 'enum', ['increased', 'normal'], 'either', ''],
]

export const FIELDS: Field[] = FIELDS_RAW.map((f) => ({
  group: f[0], key: f[1], label: f[2], type: f[3], options: f[4], source: f[5], unit: f[6],
}))

export const FIELD_BY_KEY: Record<string, Field> = {}
FIELDS.forEach((f) => { FIELD_BY_KEY[f.key] = f })

export const GROUP_LABEL: Record<FieldGroup, string> = {
  demographics: 'Demographics & clinical',
  labs: 'Blood counts & chemistry',
  molecular: 'Molecular & cytogenetics',
  pathology: 'Bone-marrow pathology',
}
export const GROUP_ORDER: FieldGroup[] = ['demographics', 'labs', 'molecular', 'pathology']

export const DISEASE_NAME: Record<DiseaseCode, string> = {
  PV: 'Polycythemia vera',
  ET: 'Essential thrombocythemia',
  MF: 'Overt myelofibrosis',
}

export const PROVIDERS: Record<ProviderKey, Provider> = {
  groq: {
    key: 'groq', label: 'Groq (free, fast)', accent: '#f55036',
    keyPlaceholder: 'gsk_...', keyHelp: 'Create a free key at console.groq.com/keys (no credit card)',
    keyPattern: /^gsk_/, getKeyUrl: 'https://console.groq.com/keys',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    defaultModel: 'openai/gpt-oss-120b',
  },
  puter: {
    key: 'puter', label: 'Puter.js (free, no key)', accent: '#6851ff',
    keyPlaceholder: '', keyHelp: '', keyPattern: /.*/,
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'gpt-5-mini', 'claude-sonnet-4-5', 'gemini-2.5-flash'],
    defaultModel: 'gpt-4.1-mini', keyless: true,
  },
  webllm: {
    key: 'webllm', label: 'On-device (WebLLM)', accent: '#0f766e',
    keyPlaceholder: '', keyHelp: '', keyPattern: /.*/,
    models: ['Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'],
    defaultModel: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', keyless: true, onDevice: true,
  },
  openai: {
    key: 'openai', label: 'OpenAI', accent: '#10a37f',
    keyPlaceholder: 'sk-...', keyHelp: 'Create a key at platform.openai.com/api-keys',
    keyPattern: /^sk-/, getKeyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'], defaultModel: 'gpt-4o',
  },
  anthropic: {
    key: 'anthropic', label: 'Anthropic (Claude)', accent: '#C15F3C',
    keyPlaceholder: 'sk-ant-...', keyHelp: 'Create a key at console.anthropic.com/settings/keys',
    keyPattern: /^sk-ant-/, getKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], defaultModel: 'claude-sonnet-4-5',
  },
  gemini: {
    key: 'gemini', label: 'Google (Gemini)', accent: '#1a73e8',
    keyPlaceholder: 'AIza...', keyHelp: 'Create a key at aistudio.google.com/app/apikey',
    keyPattern: /^AIza/, getKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'], defaultModel: 'gemini-2.5-flash',
  },
}
export const PROVIDER_ORDER: ProviderKey[] = ['groq', 'puter', 'webllm', 'openai', 'anthropic', 'gemini']

export function providerIsKeyless(provider: ProviderKey): boolean {
  return Boolean(PROVIDERS[provider].keyless)
}

export function providerIsOnDevice(provider: ProviderKey): boolean {
  return Boolean(PROVIDERS[provider].onDevice)
}

// ---------------------------------------------------------------- helpers
function num(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}
function truthy(x: unknown): boolean {
  if (x === true) return true
  if (x === false || x === null || x === undefined) return false
  const s = String(x).toLowerCase().trim()
  return s === 'true' || s === 'yes' || s === 'y' || s === 'present' || s === 'positive' || s === '1'
}
function isPos(x: unknown): boolean { return x === 'positive' || x === true }

// tri-state criterion from (is the input known?, does it satisfy the condition?)
function tri(known: boolean, cond: boolean): CriterionStatus {
  return !known ? 'unavailable' : (cond ? 'met' : 'not_met')
}

// Tokens a model may emit that mean "no value" — must never become a negative.
const ABSENCE_TOKENS = new Set([
  '', 'na', 'n/a', 'unknown', 'not reported', 'not documented', 'not stated',
  'not performed', 'not done', 'not tested', 'pending', 'indeterminate',
  'equivocal', 'none reported', 'no data', 'not available', 'unavailable', 'not mentioned',
])
function isAbsenceToken(x: unknown): boolean {
  if (x === null || x === undefined) return true
  if (Array.isArray(x)) return x.length === 0
  return ABSENCE_TOKENS.has(String(x).toLowerCase().trim())
}

// Canonical form for list options (gene names): case- and punctuation-insensitive,
// so "u2af1 q157" and "U2AF1Q157" both resolve to the schema option.
const canon = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ---------------------------------------------------------------- stage 2
// Coerce a raw model value for a field. Returns null when the value is absent,
// an unrecognised enum, or otherwise not a usable documented finding.
function coerceValue(f: Field, raw: unknown): VarValue | null {
  if (isAbsenceToken(raw)) return null
  if (f.type === 'number') return num(raw)
  if (f.type === 'bool') {
    const s = String(raw).toLowerCase().trim()
    if (['true', 'yes', 'y', 'present', 'positive', '1'].includes(s)) return true
    if (['false', 'no', 'n', 'absent', 'negative', '0'].includes(s)) return false
    return null // anything else (incl. absence tokens handled above) is not a documented boolean
  }
  if (f.type === 'list') {
    let arr = (Array.isArray(raw) ? (raw as unknown[]) : String(raw).split(/[,;]+/)).map((s) => String(s).trim())
    arr = arr.filter((s) => s && !isAbsenceToken(s))
    // Only schema options may enter a scored list: an unlisted gene (e.g. TET2)
    // must never drive HMR-positive scoring. Unknown entries are dropped here and
    // flagged for review by normalizeExtraction.
    if (f.options) {
      const byCanon = new Map(f.options.map((o) => [canon(o), o]))
      arr = Array.from(new Set(arr.map((s) => byCanon.get(canon(s))).filter((o): o is string => !!o)))
    }
    return arr.length ? arr : null
  }
  if (f.type === 'enum') {
    let s = String(raw).toLowerCase().replace(/\s+/g, '_')
    if (f.key === 'reticulin_fibrosis_grade') s = s.replace(/[^0-9]/g, '')
    // Only accept genuine option values; a pending/not-performed enum must not
    // masquerade as a known value (which diagnose() would read as a negative).
    return (f.options || []).includes(s) ? s : null
  }
  return String(raw)
}

function coerceStatus(s: unknown): FieldStatus | null {
  if (typeof s !== 'string') return null
  const t = s.toLowerCase().replace(/\s+/g, '_').trim()
  const all: FieldStatus[] = ['positive', 'negative', 'normal', 'equivocal', 'pending', 'not_performed', 'unavailable', 'not_documented']
  return (all as string[]).includes(t) ? (t as FieldStatus) : null
}

// Infer a status from a coerced value when the model did not supply one.
function inferStatus(f: Field, value: VarValue | null): FieldStatus {
  if (value === null) return 'not_documented'
  if (f.type === 'bool') return value === true ? 'positive' : 'negative'
  if (f.type === 'enum') {
    if (f.key === 'jak2_v617f' || f.key === 'jak2_exon12' || f.key === 'mpl' || f.key === 'bcr_abl1') {
      return value === 'positive' ? 'positive' : 'negative'
    }
    if (f.key === 'calr') return value === 'negative' ? 'negative' : 'positive'
    if (f.key === 'epo') return value === 'normal' ? 'normal' : 'positive'
    if (f.key === 'red_cell_mass') return value === 'increased' ? 'positive' : 'normal'
    return 'positive'
  }
  return 'positive'
}

export function normalizeExtraction(raw: unknown, sourceText?: string): Extraction {
  const out: Extraction = { variables: {}, sources: {}, fields: {}, needsReview: [], rationale: '', impression: '' }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  const vars = (r.variables && typeof r.variables === 'object' ? r.variables : r) as Record<string, unknown>
  const srcs = (r.sources && typeof r.sources === 'object' ? r.sources : {}) as Record<string, unknown>
  const fieldsMeta = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<string, unknown>
  out.rationale = typeof r.rationale === 'string' ? r.rationale : ''
  out.impression = typeof r.impression === 'string' ? r.impression : ''

  const haystack = (sourceText || '').toLowerCase().replace(/\s+/g, ' ')
  let hmrPanelNegative = false
  const listDropped: string[] = []

  Object.keys(FIELD_BY_KEY).forEach((key) => {
    const f = FIELD_BY_KEY[key]
    const metaRaw = (fieldsMeta[key] && typeof fieldsMeta[key] === 'object') ? fieldsMeta[key] as Record<string, unknown> : null

    // Resolve the raw value + status from either the rich `fields` map or the
    // legacy flat `variables` map.
    const rawValue = metaRaw && 'value' in metaRaw ? metaRaw.value : vars[key]
    const declaredStatus = metaRaw ? coerceStatus(metaRaw.status) : null
    const hasAnyInfo = metaRaw !== null || key in vars
    if (!hasAnyInfo) return

    const value = coerceValue(f, rawValue)
    let status: FieldStatus = declaredStatus || inferStatus(f, value)

    // A declared documented status with no usable value is really "not documented".
    if (isDocumentedStatus(status) && value === null) status = 'not_documented'

    // Anti-hallucination: if a snippet is provided but cannot be found in the
    // source text, distrust the value and leave the field for review.
    const snippet = metaRaw && typeof metaRaw.snippet === 'string' ? metaRaw.snippet : undefined
    let grounded = true
    if (snippet && haystack) {
      const needle = snippet.toLowerCase().replace(/\s+/g, ' ').trim()
      if (needle.length > 3 && !haystack.includes(needle)) grounded = false
    }

    // The model may only attribute a value to the note or the pathology report;
    // "structured" is reserved for on-file data and is assigned in the merge step.
    const sourceTag: SourceTag = (() => {
      const s = srcs[key] ?? (metaRaw ? metaRaw.sourceTag : undefined)
      if (s === 'pathology' || s === 'note') return s
      return f.group === 'pathology' ? 'pathology' : 'note'
    })()

    // An explicitly negative panel (empty list, status "negative") is a documented
    // negative, not missing data: remembered so hmr_tested is derived below.
    if (f.key === 'hmr_mutations' && grounded && declaredStatus === 'negative' && value === null) hmrPanelNegative = true
    // Entries outside the schema options were dropped by coerceValue: flag for review.
    if (f.type === 'list' && Array.isArray(rawValue)) {
      const offered = (rawValue as unknown[]).filter((s) => s && !isAbsenceToken(s)).length
      const kept = Array.isArray(value) ? value.length : 0
      if (offered > kept) listDropped.push(key)
    }

    // Record provenance for every field the model spoke to.
    out.fields[key] = {
      value,
      status: grounded ? status : 'unavailable',
      unit: metaRaw && typeof metaRaw.unit === 'string' ? metaRaw.unit : undefined,
      date: metaRaw && typeof metaRaw.date === 'string' ? metaRaw.date : undefined,
      qualifier: metaRaw && typeof metaRaw.qualifier === 'string' ? metaRaw.qualifier : undefined,
      specimen: metaRaw && typeof metaRaw.specimen === 'string' ? metaRaw.specimen : undefined,
      snippet,
      sourceTag,
    }

    // Only DOCUMENTED, grounded findings enter `variables` — which is what
    // diagnose()/prognose() read. Everything else stays out so a missing / pending
    // / not-performed result can never be scored as a negative.
    if (grounded && value !== null && isDocumentedStatus(status)) {
      out.variables[key] = value
      out.sources[key] = sourceTag
    } else {
      out.needsReview.push(key)
    }
  })

  // A documented negative HMR panel means the panel was performed.
  if (hmrPanelNegative && out.variables.hmr_tested === undefined) {
    out.variables.hmr_tested = true
    out.sources.hmr_tested = out.fields.hmr_mutations?.sourceTag || 'note'
  }
  listDropped.forEach((k) => { if (!out.needsReview.includes(k)) out.needsReview.push(k) })
  resolveContradictions(out)
  return out
}

// Mutually exclusive extracted values never enter `variables` together: the
// concrete result wins, the contradicted flag is removed, and both are flagged
// for review so the clinician sees the conflict.
function resolveContradictions(out: Extraction) {
  const v = out.variables
  const flag = (k: string) => { if (!out.needsReview.includes(k)) out.needsReview.push(k) }
  const drop = (k: string, keep: string) => { delete v[k]; delete out.sources[k]; flag(k); flag(keep) }
  const driverPos = isPos(v.jak2_v617f) || isPos(v.jak2_exon12) || (!!v.calr && v.calr !== 'negative') || isPos(v.mpl)
  if (v.triple_negative === true && driverPos) drop('triple_negative', isPos(v.jak2_v617f) ? 'jak2_v617f' : isPos(v.jak2_exon12) ? 'jak2_exon12' : isPos(v.mpl) ? 'mpl' : 'calr')
  if (v.hmr_tested === false && Array.isArray(v.hmr_mutations) && v.hmr_mutations.length) drop('hmr_tested', 'hmr_mutations')
  if (v.splenomegaly === false && (num(v.spleen_cm) || 0) > 0) drop('splenomegaly', 'spleen_cm')
  if (v.prior_thrombosis === false && v.thrombosis_type !== undefined) drop('prior_thrombosis', 'thrombosis_type')
}

// ---------------------------------------------------------------- stage 4
// Merge manually-entered structured values over extracted ones. Priority:
// structured > pathology > note (structured = a value the user typed / had on
// file, which always wins). Extracted per-field provenance is preserved.
export function mergeSources(structured: Variables, extracted: Extraction): { variables: Variables; sources: Record<string, SourceTag> } {
  const variables: Variables = {}
  const sources: Record<string, SourceTag> = {}
  Object.keys(extracted.variables || {}).forEach((k) => {
    variables[k] = extracted.variables[k]
    sources[k] = (extracted.sources && extracted.sources[k]) || 'note'
  })
  Object.keys(structured || {}).forEach((k) => {
    const f = FIELD_BY_KEY[k]
    if (!f) return
    const raw = structured[k]
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) return
    if (isAbsenceToken(raw)) return
    // Route through the same coercion as extracted values so a stray 'pending' /
    // 'unknown' / stringized-boolean structured entry never becomes a false negative.
    const cv = coerceValue(f, raw)
    if (cv === null) return
    variables[k] = cv
    sources[k] = 'structured'
  })
  return { variables, sources }
}

// ---------------------------------------------------------------- stage 5a
function driverLabel(v: Variables): string {
  const parts: string[] = []
  if (isPos(v.jak2_v617f)) parts.push('JAK2 V617F+')
  if (isPos(v.jak2_exon12)) parts.push('JAK2 exon12+')
  if (v.calr && v.calr !== 'negative') parts.push('CALR ' + v.calr)
  if (isPos(v.mpl)) parts.push('MPL+')
  // "triple-negative" only describes a case with NO positive driver
  if (!parts.length && truthy(v.triple_negative)) parts.push('triple-negative')
  return parts.join(', ')
}

interface DiseaseEval {
  criteria: Criterion[]
  confirmed: boolean
  suspicious: boolean
  hardExcluded: boolean
}

// ---- PV -------------------------------------------------------------------
function evalPV(v: Variables): DiseaseEval {
  const sex = v.sex
  const sexKnown = sex === 'male' || sex === 'female'
  const hb = num(v.hemoglobin)
  const hct = num(v.hematocrit)
  const rcm = v.red_cell_mass
  const jak2 = isPos(v.jak2_v617f) || isPos(v.jak2_exon12)
  const jak2Known = v.jak2_v617f !== undefined || v.jak2_exon12 !== undefined

  // Major 1 — erythrocytosis
  const eryMet = (sex === 'male' && ((hb !== null && hb > 16.5) || (hct !== null && hct > 49))) ||
    (sex === 'female' && ((hb !== null && hb > 16.0) || (hct !== null && hct > 48))) ||
    (!sexKnown && ((hb !== null && hb > 16.5) || (hct !== null && hct > 49))) ||
    rcm === 'increased'
  // sex unknown + value in the female-vs-male ambiguous band -> cannot decide.
  const eryAmbiguous = !sexKnown && rcm !== 'increased' && (
    (hb !== null && hb > 16.0 && hb <= 16.5) || (hct !== null && hct > 48 && hct <= 49)
  )
  const eryDataPresent = hb !== null || hct !== null || rcm === 'increased' || rcm === 'normal'
  let major1: CriterionStatus
  if (eryMet) major1 = 'met'
  else if (eryAmbiguous || !eryDataPresent) major1 = 'unavailable'
  else major1 = 'not_met'

  // markedly elevated counts (marrow-waiver pathway B)
  const hbHigh = (sex === 'male' && ((hb !== null && hb > 18.5) || (hct !== null && hct > 55.5))) ||
    (sex === 'female' && ((hb !== null && hb > 16.5) || (hct !== null && hct > 49.5))) ||
    (!sexKnown && ((hb !== null && hb > 18.5) || (hct !== null && hct > 55.5)))

  // Major 2 — BM panmyelosis with pleomorphic mature megakaryocytes
  const mp = v.megakaryocyte_pattern
  let major2: CriterionStatus
  if (mp === 'pleomorphic') major2 = 'met'
  else if (mp === 'atypical_clustered' || mp === 'large_mature' || mp === 'normal') major2 = 'not_met'
  else if (truthy(v.panmyelosis)) major2 = 'unavailable' // panmyelosis supportive; morphology needed
  else if (v.panmyelosis === false) major2 = 'not_met'
  else major2 = 'unavailable'

  // Major 3 — JAK2 V617F / exon 12
  const major3 = tri(jak2Known, jak2)

  // Minor — subnormal EPO
  const epoKnown = v.epo !== undefined
  const minor = tri(epoKnown, v.epo === 'low')

  // Blast phase (≥20% peripheral blasts) is outside chronic-phase MPN.
  const blasts = num(v.peripheral_blasts)
  const blastPhase = blasts !== null && blasts >= 20

  // BCR-ABL1 positivity defines CML and excludes a PV classification (as it
  // already does for ET and overt MF).
  const cml = v.bcr_abl1 === 'positive'

  // Pathway B (marrow waiver) applies only when the marrow is unavailable — never
  // when it is documented and contradicts PV (major2 not_met).
  const confirmed = !blastPhase && !cml && ((major1 === 'met' && major2 === 'met' && major3 === 'met') ||
    (hbHigh && major3 === 'met' && minor === 'met' && major2 !== 'not_met'))

  // A JAK2 mutation is obligatory; absent erythrocytosis without marked counts,
  // blast phase, and BCR-ABL1 positivity also exclude PV.
  const hardExcluded = major3 === 'not_met' || (major1 === 'not_met' && !hbHigh) || blastPhase || cml
  const definingMet = major1 === 'met' || hbHigh || major3 === 'met'
  // Suspicious only when gaps are unavailable — a documented non-PV marrow (major2
  // not_met) is a contradiction, not a gap.
  const suspicious = !confirmed && !hardExcluded && definingMet && major2 !== 'not_met'

  let ery1detail = hb !== null ? ('Hb ' + hb + ' g/dL' + (hct !== null ? ', Hct ' + hct + '%' : ''))
    : (hct !== null ? 'Hct ' + hct + '%' : (rcm ? 'RCM ' + rcm : ''))
  if (eryAmbiguous) ery1detail += ' (sex needed for threshold)'

  const criteria: Criterion[] = [
    { disease: 'PV', tier: 'major', label: 'Erythrocytosis: Hb >16.5 (M)/>16.0 (F) g/dL, Hct >49% (M)/>48% (F), or increased red cell mass', status: major1, detail: ery1detail },
    { disease: 'PV', tier: 'major', label: 'BM trilineage panmyelosis with pleomorphic mature megakaryocytes', status: major2, detail: mp ? String(mp).replace(/_/g, ' ') + (v.bm_cellularity ? ', ' + v.bm_cellularity : '') : (truthy(v.panmyelosis) ? 'panmyelosis; morphology not characterised' : '') },
    { disease: 'PV', tier: 'major', label: 'JAK2 V617F or JAK2 exon 12 mutation', status: major3, detail: isPos(v.jak2_v617f) ? 'JAK2 V617F+' : (isPos(v.jak2_exon12) ? 'JAK2 exon 12+' : (jak2Known ? 'JAK2 negative' : '')) },
    { disease: 'PV', tier: 'minor', label: 'Subnormal serum erythropoietin', status: minor, detail: v.epo ? 'EPO ' + v.epo : '' },
  ]
  return { criteria, confirmed, suspicious, hardExcluded }
}

// ---- ET -------------------------------------------------------------------
function evalET(v: Variables, pvConfirmed: boolean): DiseaseEval {
  const plt = num(v.platelets)
  const fib = fibGrade(v)
  const mp = v.megakaryocyte_pattern
  const anyDriverPos = isPos(v.jak2_v617f) || isPos(v.jak2_exon12) || (!!v.calr && v.calr !== 'negative') || isPos(v.mpl)
  const driverKnown = v.jak2_v617f !== undefined || v.jak2_exon12 !== undefined || v.calr !== undefined || v.mpl !== undefined

  // Major 1 — sustained thrombocytosis
  const major1 = tri(plt !== null, plt !== null && plt >= 450)

  // Major 2 — ET-type marrow: enlarged mature megakaryocytes, no relevant fibrosis
  let major2: CriterionStatus
  if (mp === undefined) major2 = 'unavailable'
  else if (mp !== 'large_mature') major2 = 'not_met'
  else if (fib === null) major2 = 'unavailable' // large mature megs but grade not reported
  else major2 = fib <= 1 ? 'met' : 'not_met'

  // Major 3 — does not meet PV / overt MF / CML criteria
  const cmlExcluded = anyDriverPos || v.bcr_abl1 === 'negative'
  const cmlKnown = anyDriverPos || v.bcr_abl1 !== undefined
  let major3: CriterionStatus
  if (pvConfirmed || v.bcr_abl1 === 'positive') major3 = 'not_met'
  else if (fib === null || !cmlKnown) major3 = 'unavailable'
  else if (fib < 2 && cmlExcluded) major3 = 'met'
  else major3 = 'not_met' // fib >= 2 (overt MF territory) or CML present

  // Major 4 — a driver mutation
  const major4 = tri(driverKnown, anyDriverPos)

  // Minor — clonal marker or documented absence of reactive THROMBOCYTOSIS.
  // (reactive_cause_excluded is the MF fibrosis exclusion and is a different question.)
  const minorKnown = v.clonal_marker_present !== undefined || v.reactive_thrombocytosis_excluded !== undefined
  const minorMet = truthy(v.clonal_marker_present) || truthy(v.reactive_thrombocytosis_excluded)
  const minor = tri(minorKnown, minorMet)

  // driver OR minor requirement, resolved as a tri-state
  const drvMinor: CriterionStatus = (major4 === 'met' || minor === 'met') ? 'met'
    : (major4 === 'not_met' && minor === 'not_met') ? 'not_met' : 'unavailable'

  const blasts = num(v.peripheral_blasts)
  const blastPhase = blasts !== null && blasts >= 20
  const confirmed = major1 === 'met' && major2 === 'met' && major3 === 'met' && drvMinor === 'met' && !blastPhase
  const hardExcluded = major1 === 'not_met' || pvConfirmed || (fib !== null && fib >= 2) || v.bcr_abl1 === 'positive' || blastPhase
  const definingMet = major1 === 'met'
  const suspicious = !confirmed && !hardExcluded && definingMet &&
    major2 !== 'not_met' && major3 !== 'not_met' && drvMinor !== 'not_met'

  const criteria: Criterion[] = [
    { disease: 'ET', tier: 'major', label: 'Sustained platelet count ≥450 ×10⁹/L', status: major1, detail: plt !== null ? plt + ' ×10⁹/L' : '' },
    { disease: 'ET', tier: 'major', label: 'BM: proliferation of enlarged mature megakaryocytes; no relevant reticulin fibrosis', status: major2, detail: (mp ? String(mp).replace(/_/g, ' ') : '') + (fib !== null ? ', MF-' + fib : '') },
    { disease: 'ET', tier: 'major', label: 'Does not meet WHO criteria for PV, overt MF, BCR-ABL1+ CML, or MDS', status: major3, detail: pvConfirmed ? 'meets PV' : (v.bcr_abl1 === 'positive' ? 'BCR-ABL1+' : (fib !== null && fib >= 2 ? 'fibrosis ≥grade 2' : '')) },
    { disease: 'ET', tier: 'major', label: 'JAK2, CALR, or MPL mutation', status: major4, detail: driverLabel(v) },
    { disease: 'ET', tier: 'minor', label: 'Clonal marker present, or reactive thrombocytosis excluded', status: minor, detail: truthy(v.clonal_marker_present) ? 'clonal marker present' : (truthy(v.reactive_thrombocytosis_excluded) ? 'reactive thrombocytosis excluded' : '') },
  ]
  return { criteria, confirmed, suspicious, hardExcluded }
}

// ---- overt MF -------------------------------------------------------------
function fibGrade(v: Variables): number | null {
  return v.reticulin_fibrosis_grade !== undefined && v.reticulin_fibrosis_grade !== null && v.reticulin_fibrosis_grade !== ''
    ? parseInt(String(v.reticulin_fibrosis_grade), 10) : null
}

function evalMF(v: Variables, pvConfirmed: boolean, etConfirmed: boolean): DiseaseEval {
  const sex = v.sex
  const hb = num(v.hemoglobin)
  const wbc = num(v.wbc)
  const ldh = num(v.ldh)
  // A reference upper limit must be positive; anything else falls back to the
  // documented default of 250 U/L (a ≤0 ULN would make every LDH "elevated").
  const ulnRaw = num(v.ldh_uln)
  const ulnAssumed = ulnRaw === null || ulnRaw <= 0
  const uln = ulnAssumed ? 250 : ulnRaw
  const fib = fibGrade(v)
  const mp = v.megakaryocyte_pattern
  const blasts = num(v.peripheral_blasts)
  const anyDriverPos = isPos(v.jak2_v617f) || isPos(v.jak2_exon12) || (!!v.calr && v.calr !== 'negative') || isPos(v.mpl)
  const hmr = Array.isArray(v.hmr_mutations) ? (v.hmr_mutations as string[]) : []

  // Major 1 — megakaryocytic atypia WITH reticulin/collagen fibrosis grade ≥2 (overt only)
  let major1: CriterionStatus
  if (fib !== null && fib < 2) major1 = 'not_met' // known low grade = prefibrotic (out of scope)
  else if (mp === undefined || fib === null) major1 = 'unavailable'
  else if (mp === 'atypical_clustered' && fib >= 2) major1 = 'met'
  else major1 = 'not_met'

  // Major 2 — does not meet PV / ET / CML / MDS criteria
  const cmlKnown = anyDriverPos || v.bcr_abl1 !== undefined
  let major2: CriterionStatus
  if (pvConfirmed || etConfirmed || v.bcr_abl1 === 'positive') major2 = 'not_met'
  else if (!cmlKnown) major2 = 'unavailable'
  else major2 = 'met'

  // Major 3 — clonal driver, other clonal marker, or reactive fibrosis excluded
  let major3: CriterionStatus
  if (anyDriverPos || hmr.length > 0 || truthy(v.clonal_marker_present) || truthy(v.reactive_cause_excluded)) major3 = 'met'
  else if (v.reactive_cause_excluded === false) major3 = 'not_met'
  else major3 = 'unavailable'

  // Minors
  const mAnemia = tri(hb !== null, (sex === 'male' && hb !== null && hb < 13) || ((sex === 'female' || !sex) && hb !== null && hb < 12))
  const mLeuko = tri(wbc !== null, wbc !== null && wbc >= 11)
  // An explicit "not palpable" alongside a measured spleen is a conflict, not a
  // finding: neither value is trusted until it is resolved.
  const spleenConflict = v.splenomegaly === false && (num(v.spleen_cm) || 0) > 0
  const mSpleen = spleenConflict ? 'unavailable'
    : tri(v.splenomegaly !== undefined || v.spleen_cm !== undefined, truthy(v.splenomegaly) || (num(v.spleen_cm) || 0) > 0)
  const mLDH = tri(ldh !== null, ldh !== null && ldh > uln)
  const mLEB = tri(v.leukoerythroblastosis !== undefined, truthy(v.leukoerythroblastosis))
  const minors = [mAnemia, mLeuko, mSpleen, mLDH, mLEB]
  const minorsMet = minors.filter((s) => s === 'met').length

  const blastPhase = blasts !== null && blasts >= 20
  const confirmed = major1 === 'met' && major2 === 'met' && major3 === 'met' && minorsMet >= 1 && !blastPhase
  const hardExcluded = (fib !== null && fib < 2) || pvConfirmed || etConfirmed || v.bcr_abl1 === 'positive' || blastPhase
  // Overt-MF suspicion needs marrow/fibrosis evidence, or a strong clinical picture
  // (driver + splenomegaly + ≥2 minors) with biopsy pending — never a driver + a
  // single non-specific minor alone.
  const strongClinical = (anyDriverPos || hmr.length > 0) && truthy(v.splenomegaly) && minorsMet >= 2
  const supportive = major1 === 'met' || mp === 'atypical_clustered' || (fib !== null && fib >= 2) || strongClinical
  const suspicious = !confirmed && !hardExcluded && supportive &&
    major1 !== 'not_met' && major2 !== 'not_met' && major3 !== 'not_met'

  const criteria: Criterion[] = [
    { disease: 'MF', tier: 'major', label: 'Megakaryocytic proliferation & atypia with reticulin/collagen fibrosis grade 2–3', status: major1, detail: (mp ? String(mp).replace(/_/g, ' ') : '') + (fib !== null ? ', MF-' + fib : ' (fibrosis grade not reported)') },
    { disease: 'MF', tier: 'major', label: 'Does not meet WHO criteria for PV, ET, BCR-ABL1+ CML, or MDS', status: major2, detail: pvConfirmed ? 'meets PV' : (etConfirmed ? 'meets ET' : (v.bcr_abl1 === 'positive' ? 'BCR-ABL1+' : '')) },
    { disease: 'MF', tier: 'major', label: 'JAK2/CALR/MPL mutation, another clonal marker, or reactive fibrosis excluded', status: major3, detail: driverLabel(v) || (hmr.length ? hmr.join(', ') : (truthy(v.reactive_cause_excluded) ? 'reactive cause excluded' : '')) },
    { disease: 'MF', tier: 'minor', label: 'Anemia not attributed to a comorbid condition', status: mAnemia, detail: hb !== null ? 'Hb ' + hb : '' },
    { disease: 'MF', tier: 'minor', label: 'Leukocytosis ≥11 ×10⁹/L', status: mLeuko, detail: wbc !== null ? wbc + ' ×10⁹/L' : '' },
    { disease: 'MF', tier: 'minor', label: 'Palpable splenomegaly', status: mSpleen, detail: v.spleen_cm ? v.spleen_cm + ' cm' : (truthy(v.splenomegaly) ? 'present' : '') },
    { disease: 'MF', tier: 'minor', label: 'LDH above reference range', status: mLDH, detail: ldh !== null ? ldh + ' U/L (ULN ' + uln + (ulnAssumed ? ' assumed' : '') + ')' : '' },
    { disease: 'MF', tier: 'minor', label: 'Leukoerythroblastosis', status: mLEB, detail: truthy(v.leukoerythroblastosis) ? 'present' : '' },
  ]
  return { criteria, confirmed, suspicious, hardExcluded }
}

function outstandingFrom(criteria: Criterion[]): string[] {
  return criteria.filter((c) => c.status === 'unavailable').map((c) => c.label)
}

function assessmentLabel(disease: DiseaseCode, verdict: DiseaseVerdict): string {
  const nm = disease === 'MF' ? 'overt MF' : disease
  if (verdict === 'confirmed') return 'Confirmed ' + nm
  if (verdict === 'suspicious') return 'Suspicious for ' + nm + ': diagnosis not confirmed'
  return 'Criteria for ' + nm + ' not met'
}

export function diagnose(v: Variables): Diagnosis {
  const pv = evalPV(v)
  const et = evalET(v, pv.confirmed)
  const mf = evalMF(v, pv.confirmed, et.confirmed)

  const confirmedFlags: Record<DiseaseCode, boolean> = { PV: pv.confirmed, ET: et.confirmed, MF: mf.confirmed }
  const anyConfirmed = pv.confirmed || et.confirmed || mf.confirmed
  const confirmedList = (['PV', 'ET', 'MF'] as DiseaseCode[]).filter((d) => confirmedFlags[d])
  const conflict = confirmedList.length > 1

  const evalByCode: Record<DiseaseCode, DiseaseEval> = { PV: pv, ET: et, MF: mf }
  const assessments: DiseaseAssessment[] = (['PV', 'ET', 'MF'] as DiseaseCode[]).map((d) => {
    const e = evalByCode[d]
    // A confirmed competitor suppresses suspicion for the others.
    const verdict: DiseaseVerdict = e.confirmed ? 'confirmed' : (!anyConfirmed && e.suspicious ? 'suspicious' : 'not')
    return {
      disease: d,
      name: DISEASE_NAME[d],
      verdict,
      label: assessmentLabel(d, verdict),
      criteria: e.criteria,
      metCount: e.criteria.filter((c) => c.status === 'met').length,
      notMetCount: e.criteria.filter((c) => c.status === 'not_met').length,
      unavailableCount: e.criteria.filter((c) => c.status === 'unavailable').length,
      outstanding: verdict === 'suspicious' ? outstandingFrom(e.criteria) : [],
    }
  })

  const suspiciousList = assessments.filter((a) => a.verdict === 'suspicious').map((a) => a.disease)

  let outcome: Outcome
  let headline: string
  let summary: string
  const nm = (d: DiseaseCode) => (d === 'MF' ? 'overt MF' : d)
  if (anyConfirmed) {
    outcome = 'confirmed'
    headline = confirmedList.map((d) => 'Confirmed ' + nm(d)).join(' + ')
    summary = 'All required WHO criteria are met for ' + confirmedList.map(nm).join(' and ') + '.'
    if (conflict) summary = 'Diagnostic conflict: more than one disease met full criteria; review required. ' + summary
  } else if (suspiciousList.length) {
    outcome = 'suspicious'
    headline = 'Suspicious for ' + suspiciousList.map(nm).join(' and ') + ': diagnosis not confirmed'
    summary = 'Supportive features are present but full WHO criteria are not met for ' +
      suspiciousList.map(nm).join(' or ') + '. A confirmed diagnosis has not been established; complete the outstanding investigations.'
  } else {
    outcome = 'none'
    headline = 'No confirmed MPN'
    summary = 'The criteria for PV, ET, and overt MF are not fulfilled, and there is insufficient evidence to classify the case as suspicious for any of them.'
  }

  // Non-blocking caveats.
  const caveats: string[] = []
  const blasts = num(v.peripheral_blasts)
  if (blasts !== null && blasts >= 10 && blasts < 20) caveats.push('Peripheral blasts ' + blasts + '% suggest accelerated-phase disease (10–19%); specialist review advised.')
  if (blasts !== null && blasts >= 20) caveats.push('Peripheral blasts ≥20% indicate blast-phase disease, which is outside chronic-phase MPN classification.')
  const fib = fibGrade(v)
  if (pv.confirmed && fib !== null && fib >= 2) caveats.push('Grade ≥2 fibrosis alongside a PV profile may indicate post-PV myelofibrosis; correlate clinically.')
  // Overlap flag: another disease confirmed while PV-defining erythrocytosis is present.
  const pvErythrocytosis = pv.criteria[0]?.status === 'met'
  if (!pv.confirmed && (et.confirmed || mf.confirmed) && pvErythrocytosis) {
    caveats.push('Concurrent erythrocytosis is present alongside another confirmed MPN; consider masked or post-PV disease and correlate clinically.')
  }
  if (v.bcr_abl1 === 'positive') caveats.push('BCR-ABL1 is positive: this defines chronic myeloid leukemia and excludes classification as PV, ET, or overt MF.')
  if ((pv.confirmed || pv.suspicious) && (v.red_cell_mass === 'normal' || v.epo === 'high')) {
    caveats.push('A normal red cell mass or an elevated serum erythropoietin argues against polycythemia vera; consider relative or secondary erythrocytosis.')
  }
  const hbCaveat = num(v.hemoglobin)
  if (truthy(v.transfusion_dependent) && hbCaveat !== null && hbCaveat >= 12) {
    caveats.push('Transfusion dependence is recorded with a hemoglobin of ' + hbCaveat + ' g/dL; confirm, as a recent transfusion can mask anemia grading.')
  }
  // Hb and Hct are independent WHO criteria, but physiologically Hct is about 3 × Hb:
  // a wide discordance points to a transcription or unit error in one of them.
  const hctCaveat = num(v.hematocrit)
  if (hbCaveat !== null && hctCaveat !== null && Math.abs(hctCaveat - 3 * hbCaveat) > 9) {
    caveats.push('Hemoglobin ' + hbCaveat + ' g/dL and hematocrit ' + hctCaveat + '% are inconsistent with each other (hematocrit is usually about 3 × hemoglobin); verify both values before relying on the erythrocytosis criterion.')
  }
  if (v.splenomegaly === false && (num(v.spleen_cm) || 0) > 0) {
    caveats.push('Splenomegaly is recorded as not palpable but a spleen size of ' + v.spleen_cm + ' cm is entered; the splenomegaly criterion was left unavailable until this is resolved.')
  }
  if (outcome !== 'none') caveats.push('WHO minor criteria and reactive causes should be confirmed on repeat determination; single-timepoint data cannot establish sustained findings.')

  const code = anyConfirmed ? confirmedList[0] : (suspiciousList.length ? 'SUSPICIOUS' : 'NONE')

  return {
    outcome, code, headline, whoEdition: 'WHO 2016 / 2022', summary,
    assessments, confirmed: confirmedList, suspicious: suspiciousList, caveats, conflict,
  }
}

// ---------------------------------------------------------------- stage 5b
// Tri-state numeric/boolean/enum reads for prognosis. A variable that is not
// present is "unavailable" and must never contribute a 0/negative score toward
// a definitive category.
function known(v: Variables, k: string): boolean {
  return v[k] !== undefined && v[k] !== null && v[k] !== ''
}

export function prognose(dx: Diagnosis, v: Variables): Prognosis {
  const out: Prognosis = { primaryKey: null, order: [], tools: {}, missing: [], gatedReason: null, diseaseConfirmed: null }

  // Prognosis runs ONLY after a disease is confirmed.
  if (dx.outcome !== 'confirmed') {
    out.gatedReason = dx.outcome === 'suspicious' ? 'suspicious' : 'none'
    return out
  }
  if (dx.conflict) { out.gatedReason = 'conflict'; return out }
  const disease = dx.confirmed[0]
  out.diseaseConfirmed = disease

  const age = num(v.age)
  const hb = num(v.hemoglobin)
  const wbc = num(v.wbc)
  const plt = num(v.platelets)
  const blasts = num(v.peripheral_blasts)
  const sex = v.sex
  const symptomsKnown = known(v, 'constitutional_symptoms')
  const symptoms = truthy(v.constitutional_symptoms)
  const thromboKnown = known(v, 'prior_thrombosis')
  const thrombo = truthy(v.prior_thrombosis)
  const jak2Known = known(v, 'jak2_v617f')
  const jak2 = isPos(v.jak2_v617f)
  const hmr = Array.isArray(v.hmr_mutations) ? (v.hmr_mutations as string[]) : []
  const karyoKnown = known(v, 'karyotype_risk')
  const karyo = v.karyotype_risk
  const transfusionKnown = known(v, 'transfusion_dependent')
  const transfusion = truthy(v.transfusion_dependent)
  const fib = fibGrade(v)
  const calrKnown = known(v, 'calr')
  const calrType1 = v.calr === 'type1'
  // HMR status is "known" only when a mutation is present or an HMR/NGS panel was
  // explicitly performed — NEVER inferred from driver testing (that would score an
  // unsequenced patient as HMR-negative, imputing risk).
  const hmrKnown = hmr.length > 0 || v.hmr_tested === true

  const pt = (label: string, pts: number | string, note?: string): ScorePoint => ({ label, pts, note: note || '' })
  const label = (k: string) => FIELD_BY_KEY[k]?.label || k

  // ---- PV -----------------------------------------------------------------
  if (disease === 'PV') {
    const missing: string[] = []
    if (!known(v, 'age')) missing.push('age')
    if (!thromboKnown) missing.push('prior_thrombosis')
    const high = (age !== null && age >= 60) || (thromboKnown && thrombo === true)
    const low = (age !== null && age < 60) && (thromboKnown && thrombo === false)
    // High needs only one known positive; Low needs BOTH known negative.
    const established = high || low
    out.tools.pv_conv = {
      key: 'pv_conv', name: 'Conventional PV thrombotic risk', applicable: true,
      status: established ? 'established' : 'not_established',
      category: established ? (high ? 'High risk' : 'Low risk') : null,
      tier: established ? (high ? 'high' : 'low') : null,
      total: null,
      requiredMissing: established ? [] : missing.map(label),
      points: [
        pt('Age ≥60 years', age !== null ? (age >= 60 ? 'yes' : 'no') : '?', age !== null ? age + ' yr' : 'unknown'),
        pt('History of thrombosis', thromboKnown ? (thrombo ? 'yes' : 'no') : '?', String(v.thrombosis_type || '')),
      ],
      note: !established
        ? 'Prognostic category not established: age and thrombosis history are both required (a single known positive suffices for high risk; low risk needs both known negative).'
        : high
        ? 'High thrombotic risk: cytoreduction (e.g. hydroxyurea) plus low-dose aspirin and Hct <45% typically indicated.'
        : 'Low thrombotic risk: phlebotomy to Hct <45% and low-dose aspirin; cytoreduction generally reserved for intolerance or progression.',
      evidence: 'Thrombotic risk stratified by age ≥60 and prior thrombosis.',
      citation: 'Marchioli 2005; Barbui 2011 (ELN)',
    }
    out.primaryKey = 'pv_conv'; out.order = ['pv_conv']
    out.missing = established ? [] : missing
    return out
  }

  // ---- ET -----------------------------------------------------------------
  if (disease === 'ET') {
    // Revised IPSET-thrombosis. High needs only a known positive; the other
    // tiers depend on known-negative inputs and cannot be assigned otherwise.
    const tMissing: string[] = []
    if (!known(v, 'age')) tMissing.push('age')
    if (!thromboKnown) tMissing.push('prior_thrombosis')
    if (!jak2Known) tMissing.push('jak2_v617f')
    const high = (thromboKnown && thrombo) || (age !== null && age > 60 && jak2Known && jak2)
    const allThreeKnown = age !== null && thromboKnown && jak2Known
    let tCat: string | null = null, tTier: RiskTier | null = null
    if (high) { tCat = 'High risk'; tTier = 'high' }
    else if (allThreeKnown) {
      const older = age > 60
      if (older && !jak2) { tCat = 'Intermediate risk'; tTier = 'int' }
      else if (!older && jak2) { tCat = 'Low risk'; tTier = 'low' }
      else { tCat = 'Very low risk'; tTier = 'vlow' }
    }
    const tEstablished = tCat !== null
    out.tools.ipset_t = {
      key: 'ipset_t', name: 'Revised IPSET-thrombosis', applicable: true,
      status: tEstablished ? 'established' : 'not_established',
      category: tCat, tier: tTier, total: null,
      requiredMissing: tEstablished ? [] : tMissing.map(label),
      points: [
        pt('Prior thrombosis', thromboKnown ? (thrombo ? 'yes' : 'no') : '?', ''),
        pt('Age >60 years', age !== null ? (age > 60 ? 'yes' : 'no') : '?', age !== null ? age + ' yr' : 'unknown'),
        pt('JAK2 V617F', jak2Known ? (jak2 ? 'positive' : 'negative') : '?', ''),
      ],
      note: tEstablished
        ? (tTier === 'high' ? 'High thrombotic risk: cytoreduction plus antiplatelet therapy generally recommended.'
          : tTier === 'int' ? 'Intermediate risk: antiplatelet therapy; cytoreduction individualized.'
          : tTier === 'low' ? 'Low risk: low-dose aspirin usually sufficient.'
          : 'Very low risk: observation or aspirin depending on cardiovascular risk.')
        : 'Prognostic category not established: age, prior thrombosis and JAK2 status are all required.',
      evidence: 'Four-tier thrombosis model by age, thrombosis history and JAK2 status.',
      citation: 'Barbui 2012 (revised)',
    }
    out.order.push('ipset_t'); out.primaryKey = 'ipset_t'

    // IPSET survival — additive; requires all three inputs.
    const sMissing: string[] = []
    if (!known(v, 'age')) sMissing.push('age')
    if (wbc === null) sMissing.push('wbc')
    if (!thromboKnown) sMissing.push('prior_thrombosis')
    const sEstablished = sMissing.length === 0
    let sPts: number | null = null, sCat: string | null = null, sTier: RiskTier | null = null
    const sRows: ScorePoint[] = []
    if (sEstablished) {
      const a = age !== null && age >= 60 ? 2 : 0
      const w = wbc !== null && wbc >= 11 ? 1 : 0
      const t = thrombo ? 1 : 0
      sPts = a + w + t
      sRows.push(pt('Age ≥60 years', a, age + ' yr'))
      sRows.push(pt('WBC ≥11 ×10⁹/L', w, String(wbc)))
      sRows.push(pt('Prior thrombosis', t, ''))
      if (sPts === 0) { sCat = 'Low risk'; sTier = 'low' } else if (sPts <= 2) { sCat = 'Intermediate risk'; sTier = 'int' } else { sCat = 'High risk'; sTier = 'high' }
    } else {
      sRows.push(pt('Age ≥60 years', age !== null ? (age >= 60 ? 2 : 0) : '?', age !== null ? age + ' yr' : 'unknown'))
      sRows.push(pt('WBC ≥11 ×10⁹/L', wbc !== null ? (wbc >= 11 ? 1 : 0) : '?', wbc !== null ? String(wbc) : 'unknown'))
      sRows.push(pt('Prior thrombosis', thromboKnown ? (thrombo ? 1 : 0) : '?', ''))
    }
    out.tools.ipset_s = {
      key: 'ipset_s', name: 'IPSET (survival)', applicable: true,
      status: sEstablished ? 'established' : 'not_established',
      category: sCat, tier: sTier, total: sPts,
      requiredMissing: sEstablished ? [] : sMissing.map(label), points: sRows,
      note: sEstablished ? 'Survival model: low median not reached; intermediate ≈24.5 yr; high ≈13.8 yr.'
        : 'Prognostic category not established: age, WBC and prior thrombosis are all required.',
      evidence: 'Overall-survival companion to IPSET.', citation: 'Passamonti 2012 (IPSET)',
    }
    out.order.push('ipset_s')
    out.missing = Array.from(new Set([...tMissing, ...sMissing]))
    return out
  }

  // ---- overt MF -----------------------------------------------------------
  if (disease === 'MF') {
    // DIPSS — requires all five clinical variables.
    const dMissing: string[] = []
    if (!known(v, 'age')) dMissing.push('age')
    if (wbc === null) dMissing.push('wbc')
    if (hb === null) dMissing.push('hemoglobin')
    if (blasts === null) dMissing.push('peripheral_blasts')
    if (!symptomsKnown) dMissing.push('constitutional_symptoms')
    const dEstablished = dMissing.length === 0
    let dPts: number | null = null, dTier: RiskTier | null = null, dCat: string | null = null, dBase = 0
    const dRows: ScorePoint[] = []
    if (dEstablished) {
      const a = age !== null && age > 65 ? 1 : 0
      const w = wbc !== null && wbc > 25 ? 1 : 0
      const h = hb !== null && hb < 10 ? 2 : 0
      const b = blasts !== null && blasts >= 1 ? 1 : 0
      const c = symptoms ? 1 : 0
      dPts = a + w + h + b + c
      dRows.push(pt('Age >65 years', a, age + ' yr'), pt('WBC >25 ×10⁹/L', w, String(wbc)), pt('Hemoglobin <10 g/dL', h, String(hb)), pt('Peripheral blasts ≥1%', b, blasts + '%'), pt('Constitutional symptoms', c, ''))
      if (dPts === 0) { dCat = 'Low risk'; dTier = 'low'; dBase = 0 }
      else if (dPts <= 2) { dCat = 'Intermediate-1 risk'; dTier = 'int1'; dBase = 1 }
      else if (dPts <= 4) { dCat = 'Intermediate-2 risk'; dTier = 'int2'; dBase = 2 }
      else { dCat = 'High risk'; dTier = 'high'; dBase = 3 }
    } else {
      dRows.push(pt('Age >65 years', age !== null ? (age > 65 ? 1 : 0) : '?', age !== null ? age + ' yr' : 'unknown'), pt('WBC >25 ×10⁹/L', wbc !== null ? (wbc > 25 ? 1 : 0) : '?', wbc !== null ? String(wbc) : 'unknown'), pt('Hemoglobin <10 g/dL', hb !== null ? (hb < 10 ? 2 : 0) : '?', hb !== null ? String(hb) : 'unknown'), pt('Peripheral blasts ≥1%', blasts !== null ? (blasts >= 1 ? 1 : 0) : '?', blasts !== null ? blasts + '%' : 'unknown'), pt('Constitutional symptoms', symptomsKnown ? (symptoms ? 1 : 0) : '?', ''))
    }
    out.tools.dipss = {
      key: 'dipss', name: 'DIPSS', applicable: true, status: dEstablished ? 'established' : 'not_established',
      category: dCat, tier: dTier, total: dPts, requiredMissing: dEstablished ? [] : dMissing.map(label), points: dRows,
      note: dEstablished ? 'Median survival: low not reached; Int-1 ≈14.2 yr; Int-2 ≈4.0 yr; high ≈1.5 yr.'
        : 'Prognostic category not established: all five DIPSS variables are required.',
      evidence: 'Dynamic IPSS: applicable at any point in the disease course.', citation: 'Passamonti 2010',
    }

    // DIPSS+ — DIPSS base plus karyotype, platelets, transfusion.
    const pMissing = [...dMissing]
    if (!karyoKnown) pMissing.push('karyotype_risk')
    if (plt === null) pMissing.push('platelets')
    if (!transfusionKnown) pMissing.push('transfusion_dependent')
    const pEstablished = pMissing.length === 0
    let pPts: number | null = null, pTier: RiskTier | null = null, pCat: string | null = null
    const pRows: ScorePoint[] = []
    if (pEstablished) {
      const uk = (karyo === 'unfavorable' || karyo === 'very_high') ? 1 : 0
      const lp = plt !== null && plt < 100 ? 1 : 0
      const tr = transfusion ? 1 : 0
      pPts = dBase + uk + lp + tr
      pRows.push(pt('DIPSS category', dBase, dCat || ''), pt('Unfavorable karyotype', uk, String(karyo)), pt('Platelets <100 ×10⁹/L', lp, String(plt)), pt('Red-cell transfusion need', tr, ''))
      if (pPts === 0) { pCat = 'Low risk'; pTier = 'low' } else if (pPts === 1) { pCat = 'Intermediate-1 risk'; pTier = 'int1' } else if (pPts <= 3) { pCat = 'Intermediate-2 risk'; pTier = 'int2' } else { pCat = 'High risk'; pTier = 'high' }
    } else {
      pRows.push(pt('DIPSS category', dEstablished ? dBase : '?', dCat || 'unknown'), pt('Unfavorable karyotype', karyoKnown ? ((karyo === 'unfavorable' || karyo === 'very_high') ? 1 : 0) : '?', String(karyo || 'unknown')), pt('Platelets <100 ×10⁹/L', plt !== null ? (plt < 100 ? 1 : 0) : '?', plt !== null ? String(plt) : 'unknown'), pt('Red-cell transfusion need', transfusionKnown ? (transfusion ? 1 : 0) : '?', ''))
    }
    out.tools.dipss_plus = {
      key: 'dipss_plus', name: 'DIPSS+', applicable: true, status: pEstablished ? 'established' : 'not_established',
      category: pCat, tier: pTier, total: pPts, requiredMissing: pEstablished ? [] : pMissing.map(label), points: pRows,
      note: pEstablished ? 'Adds karyotype, thrombocytopenia and transfusion need to DIPSS.'
        : 'Prognostic category not established: requires DIPSS plus karyotype, platelets and transfusion status.',
      evidence: 'Refines DIPSS with cytogenetic and clinical variables.', citation: 'Gangat 2011',
    }

    // MIPSS70 — clinical + molecular (no karyotype). Unknown CALR / unsequenced
    // HMR must NOT be scored (they would impute risk in opposite directions).
    const mMissing: string[] = []
    if (hb === null) mMissing.push('hemoglobin')
    if (wbc === null) mMissing.push('wbc')
    if (plt === null) mMissing.push('platelets')
    if (blasts === null) mMissing.push('peripheral_blasts')
    if (fib === null) mMissing.push('reticulin_fibrosis_grade')
    if (!symptomsKnown) mMissing.push('constitutional_symptoms')
    if (!calrKnown) mMissing.push('calr')
    if (!hmrKnown) mMissing.push('hmr_mutations')
    const mEstablished = mMissing.length === 0
    let mPts: number | null = null, mTier: RiskTier | null = null, mCat: string | null = null
    const mRows: ScorePoint[] = []
    if (mEstablished) {
      const h = hb !== null && hb < 10 ? 1 : 0
      const w = wbc !== null && wbc > 25 ? 2 : 0
      const p = plt !== null && plt < 100 ? 2 : 0
      const b = blasts !== null && blasts >= 2 ? 1 : 0
      const fpts = fib !== null && fib >= 2 ? 1 : 0
      const c = symptoms ? 1 : 0
      const noCalr = !calrType1 ? 1 : 0
      const h1 = hmr.length >= 1 ? 1 : 0
      const h2 = hmr.length >= 2 ? 2 : 0
      mPts = h + w + p + b + fpts + c + noCalr + h1 + h2
      mRows.push(pt('Hemoglobin <10 g/dL', h, String(hb)), pt('WBC >25 ×10⁹/L', w, String(wbc)), pt('Platelets <100 ×10⁹/L', p, String(plt)), pt('Circulating blasts ≥2%', b, blasts + '%'), pt('BM fibrosis ≥grade 2', fpts, 'MF-' + fib), pt('Constitutional symptoms', c, ''), pt('Absence of CALR type-1/like', noCalr, calrType1 ? 'CALR type1 present' : ''), pt('High-molecular-risk mutation', h1, hmr.join(', ')), pt('≥2 HMR mutations', h2, hmr.length >= 2 ? hmr.length + ' HMR' : ''))
      if (mPts <= 1) { mCat = 'Low risk'; mTier = 'low' } else if (mPts <= 4) { mCat = 'Intermediate risk'; mTier = 'int' } else { mCat = 'High risk'; mTier = 'high' }
    }
    out.tools.mipss70 = {
      key: 'mipss70', name: 'MIPSS70', applicable: true, status: mEstablished ? 'established' : 'not_established',
      category: mCat, tier: mTier, total: mPts, requiredMissing: mEstablished ? [] : mMissing.map(label), points: mRows,
      note: mEstablished ? 'Mutation-enhanced IPSS for transplant-age patients (clinical + molecular).'
        : 'Prognostic category not established: requires the full clinical panel plus CALR status and HMR sequencing.',
      evidence: '5-yr survival: low ≈95%, intermediate ≈70%, high ≈29%.', citation: 'Guglielmelli 2018',
    }

    // MIPSS70+ v2.0 — karyotype + molecular; requires sex for anemia grading.
    const vMissing: string[] = []
    if (hb === null) vMissing.push('hemoglobin')
    if (!(sex === 'male' || sex === 'female')) vMissing.push('sex')
    if (blasts === null) vMissing.push('peripheral_blasts')
    if (!symptomsKnown) vMissing.push('constitutional_symptoms')
    if (!karyoKnown) vMissing.push('karyotype_risk')
    if (!calrKnown) vMissing.push('calr')
    if (!hmrKnown) vMissing.push('hmr_mutations')
    const vEstablished = vMissing.length === 0
    let vPts: number | null = null, vTier: RiskTier | null = null, vCat: string | null = null
    const vRows: ScorePoint[] = []
    if (vEstablished) {
      let sevPts = 0, sev = 'none'
      if ((sex === 'female' && hb! < 8) || (sex === 'male' && hb! < 9)) { sevPts = 2; sev = 'severe' }
      else if ((sex === 'female' && hb! < 10) || (sex === 'male' && hb! < 11)) { sevPts = 1; sev = 'moderate' }
      const b = blasts !== null && blasts >= 2 ? 1 : 0
      const c = symptoms ? 2 : 0
      const ky = karyo === 'very_high' ? 4 : (karyo === 'unfavorable' ? 3 : 0)
      const noCalr = !calrType1 ? 2 : 0
      const h1 = hmr.length === 1 ? 2 : 0
      const h2 = hmr.length >= 2 ? 3 : 0
      vPts = sevPts + b + c + ky + noCalr + h1 + h2
      vRows.push(pt('Anemia (sex-adjusted)', sevPts, 'Hb ' + hb + ' (' + sev + ')'), pt('Circulating blasts ≥2%', b, blasts + '%'), pt('Constitutional symptoms', c, ''), pt('Cytogenetics (VHR 4 / unfavorable 3)', ky, String(karyo)), pt('Absence of CALR type-1/like', noCalr, calrType1 ? 'CALR type1 present' : ''), pt('HMR mutations (1 = 2 pts, ≥2 = 3 pts)', h1 + h2, hmr.join(', ')))
      if (vPts === 0) { vCat = 'Very low risk'; vTier = 'vlow' } else if (vPts <= 2) { vCat = 'Low risk'; vTier = 'low' } else if (vPts <= 4) { vCat = 'Intermediate risk'; vTier = 'int' } else if (vPts <= 8) { vCat = 'High risk'; vTier = 'high' } else { vCat = 'Very high risk'; vTier = 'vhigh' }
    }
    out.tools.mipss70v2 = {
      key: 'mipss70v2', name: 'MIPSS70+ v2.0', applicable: true, status: vEstablished ? 'established' : 'not_established',
      category: vCat, tier: vTier, total: vPts, requiredMissing: vEstablished ? [] : vMissing.map(label), points: vRows,
      note: vEstablished ? 'Karyotype- and mutation-enhanced 5-tier model for transplant-age PMF.'
        : 'Prognostic category not established: requires cytogenetics, molecular data and sex-adjusted anemia.',
      evidence: '10-yr survival: very low ≈92%, low ≈56%, intermediate ≈37%, high ≈13%, very high ≈7%.', citation: 'Tefferi 2018',
    }

    // Primary = the most comprehensive model that is fully established. The
    // MIPSS70 family was derived and validated in transplant-age patients
    // (70 or younger); above that age DIPSS+ / DIPSS lead and the MIPSS70
    // models are kept for reference with an explicit qualifier.
    const ageP = num(v.age)
    const transplantAge = ageP === null || ageP <= 70
    const preference = transplantAge ? ['mipss70v2', 'mipss70', 'dipss_plus', 'dipss'] : ['dipss_plus', 'dipss', 'mipss70v2', 'mipss70']
    if (!transplantAge) {
      ;['mipss70', 'mipss70v2'].forEach((k) => {
        const t = out.tools[k]
        if (t) t.note += ' Developed and validated in transplant-age patients (70 or younger); shown for reference at age ' + ageP + '.'
      })
    }
    out.primaryKey = preference.find((k) => out.tools[k].status === 'established') || null
    out.order = preference
    if (!out.primaryKey) {
      // union of everything still missing across the model family
      out.missing = Array.from(new Set([...dMissing, ...pMissing, ...mMissing, ...vMissing]))
    } else {
      out.missing = out.tools[out.primaryKey].requiredMissing.map((lbl) => {
        const f = FIELDS.find((ff) => ff.label === lbl); return f ? f.key : lbl
      })
    }
    return out
  }

  return out
}

export interface ClassifyResult {
  merged: { variables: Variables; sources: Record<string, SourceTag> }
  diagnosis: Diagnosis
  prognosis: Prognosis
}
export function classify(structured: Variables, extracted: Extraction): ClassifyResult {
  const merged = mergeSources(structured, extracted)
  const diagnosis = diagnose(merged.variables)
  const prognosis = prognose(diagnosis, merged.variables)
  return { merged, diagnosis, prognosis }
}

// ---------------------------------------------------------------- LLM (stage 1)
export interface PromptInputs { [k: string]: VarValue | undefined; clinical_note?: string; pathology_report?: string }

// Every schema field can appear in free text, so ALL are extractable. The
// `source` designation only drives default provenance tagging and form priority
// (a manually-entered structured value outranks an extracted note/pathology one)
// — it must NOT gate what the model is asked for. In this web app free text is
// the ONLY source, so every field must be extractable or it would stay empty.
const EXTRACTABLE_FIELDS = FIELDS

function extractionInstructions(): string {
  return EXTRACTABLE_FIELDS.map((f) => {
    const t = f.type === 'enum' ? 'one of [' + (f.options || []).join(', ') + ']'
      : f.type === 'list' ? 'array from [' + (f.options || []).join(', ') + ']'
      : f.type === 'bool' ? 'true/false' : f.type
    return '  "' + f.key + '": ' + t + (f.unit ? '  (' + f.unit + ')' : '') + '  — ' + f.label
  }).join('\n')
}

export function buildPrompt(inputs: PromptInputs): { system: string; user: string } {
  const note = (inputs.clinical_note || '').trim()
  const path = (inputs.pathology_report || '').trim()
  const known: Record<string, VarValue> = {}
  ;['age', 'sex', 'hemoglobin', 'hematocrit', 'wbc', 'platelets', 'ldh', 'peripheral_blasts', 'jak2_v617f', 'calr', 'mpl', 'karyotype_risk'].forEach((k) => {
    const val = inputs[k]
    if (val !== undefined && val !== null && val !== '') known[k] = val
  })
  const system = 'You are a hematopathology information-extraction assistant supporting an MPN ' +
    '(myeloproliferative neoplasm) phenotyping workflow for polycythemia vera, essential thrombocythemia and overt myelofibrosis. ' +
    'Read the clinical note and pathology / bone-marrow biopsy report and extract structured variables. ' +
    'Extract ONLY what is stated or directly implied — never infer, guess, or diagnose. ' +
    'CRITICAL: missing information is NOT a negative result. If a test or finding was not performed, is pending, or is simply not mentioned, ' +
    'mark its status as "not_performed", "pending" or "not_documented" and leave its value null — do NOT record it as negative/absent. ' +
    'Only record an explicit negative when the text actually states the finding is absent or the test is negative. ' +
    'For every field you populate, also record: a "status" (one of positive, negative, normal, equivocal, pending, not_performed, not_documented), ' +
    'a verbatim "snippet" copied from the source text supporting the value (if you cannot quote supporting text, use status "not_documented" and value null), ' +
    'and where present the unit, the result date, any qualifier (e.g. "range 2–3, higher taken", "trace", "focal"), and the specimen (e.g. core biopsy, aspirate, peripheral blood). ' +
    'Record the source of each field as "pathology" if it came from the pathology report, otherwise "note"; if a value appears in BOTH, use "pathology" and prefer the most recent dated result.'
  const user = '## Schema (keys → type)\n' + extractionInstructions() +
    '\n\n## Structured values already on file (for context; do not re-extract, do not contradict)\n' +
    (Object.keys(known).length ? JSON.stringify(known) : '(none)') +
    '\n\n## Clinical note\n' + (note || '(none provided)') +
    '\n\n## Pathology / bone-marrow biopsy report\n' + (path || '(none provided)') +
    '\n\nReturn a single JSON object with exactly these keys: ' +
    '"variables" (object of schema key → extracted value; omit or null when a finding is absent/pending/not performed/not documented), ' +
    '"fields" (object of schema key → { value, status, snippet, unit, date, qualifier, specimen }; include a field ONLY when the source says something about it), ' +
    '"sources" (object of schema key → "note"|"pathology"), ' +
    '"impression" (≤1 sentence, the report\'s stated impression if any, else ""), ' +
    '"rationale" (2–3 sentences citing the specific phrases you extracted from). ' +
    'Output JSON only, no prose.'
  return { system, user }
}

function fieldMetaSchema(dialect: 'openai' | 'gemini') {
  const str = dialect === 'gemini' ? 'STRING' : 'string'
  const statusEnum = ['positive', 'negative', 'normal', 'equivocal', 'pending', 'not_performed', 'unavailable', 'not_documented']
  const props: Record<string, unknown> = {
    status: { type: str, enum: statusEnum, nullable: true },
    snippet: { type: str, nullable: true },
    unit: { type: str, nullable: true },
    date: { type: str, nullable: true },
    qualifier: { type: str, nullable: true },
    specimen: { type: str, nullable: true },
  }
  return dialect === 'gemini'
    ? { type: 'OBJECT', properties: props }
    : { type: 'object', properties: props }
}

export function variablesJsonSchema(dialect: 'openai' | 'gemini') {
  const props: Record<string, unknown> = {}
  const fieldProps: Record<string, unknown> = {}
  const order: string[] = []
  EXTRACTABLE_FIELDS.forEach((f) => {
    const key = f.key
    order.push(key)
    if (f.type === 'number') props[key] = { type: dialect === 'gemini' ? 'NUMBER' : 'number', description: f.label, nullable: true }
    else if (f.type === 'bool') props[key] = { type: dialect === 'gemini' ? 'BOOLEAN' : 'boolean', description: f.label, nullable: true }
    else if (f.type === 'list') props[key] = { type: dialect === 'gemini' ? 'ARRAY' : 'array', items: { type: dialect === 'gemini' ? 'STRING' : 'string', enum: f.options }, description: f.label, nullable: true }
    else if (f.type === 'enum') props[key] = { type: dialect === 'gemini' ? 'STRING' : 'string', enum: f.options, description: f.label, nullable: true }
    else props[key] = { type: dialect === 'gemini' ? 'STRING' : 'string', description: f.label, nullable: true }
    fieldProps[key] = fieldMetaSchema(dialect)
  })
  if (dialect === 'gemini') {
    // Non-empty `sources`/`fields` objects (Gemini rejects a propertyless OBJECT).
    const sourceProps: Record<string, unknown> = {}
    order.forEach((k) => { sourceProps[k] = { type: 'STRING', enum: ['note', 'pathology'], nullable: true } })
    return {
      type: 'OBJECT',
      properties: {
        variables: { type: 'OBJECT', properties: props, propertyOrdering: order },
        fields: { type: 'OBJECT', properties: fieldProps, propertyOrdering: order },
        sources: { type: 'OBJECT', properties: sourceProps, propertyOrdering: order },
        impression: { type: 'STRING' },
        rationale: { type: 'STRING' },
      },
      required: ['variables', 'rationale'],
      propertyOrdering: ['variables', 'fields', 'sources', 'impression', 'rationale'],
    }
  }
  return {
    type: 'object',
    properties: {
      variables: { type: 'object', properties: props },
      fields: { type: 'object' },
      sources: { type: 'object' },
      impression: { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['variables', 'rationale'],
  }
}

export function anthropicToolSchema() {
  const props: Record<string, unknown> = {}
  EXTRACTABLE_FIELDS.forEach((f) => {
    const key = f.key
    if (f.type === 'number') props[key] = { type: ['number', 'null'], description: f.label }
    else if (f.type === 'bool') props[key] = { type: ['boolean', 'null'], description: f.label }
    else if (f.type === 'list') props[key] = { type: ['array', 'null'], items: { type: 'string', enum: f.options }, description: f.label }
    else if (f.type === 'enum') props[key] = { type: ['string', 'null'], enum: (f.options || []).concat([null as unknown as string]), description: f.label }
    else props[key] = { type: ['string', 'null'], description: f.label }
  })
  return {
    name: 'record_mpn_variables',
    description: 'Record structured MPN variables extracted from the note and pathology report.',
    input_schema: {
      type: 'object',
      properties: {
        variables: { type: 'object', properties: props },
        fields: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['positive', 'negative', 'normal', 'equivocal', 'pending', 'not_performed', 'unavailable', 'not_documented'] },
              snippet: { type: 'string' }, unit: { type: 'string' }, date: { type: 'string' }, qualifier: { type: 'string' }, specimen: { type: 'string' },
            },
          },
        },
        sources: { type: 'object', additionalProperties: { type: 'string', enum: ['note', 'pathology'] } },
        impression: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['variables', 'rationale'],
    },
  }
}

export function extractJSON(text: string | null | undefined): unknown {
  if (!text) return null
  try { return JSON.parse(text) } catch { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)) } catch { /* fall through */ } }
  return null
}

function friendlyError(provider: ProviderKey, status: number, body: string): string {
  const label = PROVIDERS[provider]?.label || provider
  const snippet = (body || '').slice(0, 300)
  if (status === 401 || status === 403) return label + ': the API key was rejected (401/403). Check the key and that it has access to this model.'
  if (status === 429) return label + ': rate-limited or out of quota (429). Wait a moment or check your billing.'
  if (status === 404) return label + ': model not found (404). Pick a different model id.'
  if (status === 400) return label + ' (400): ' + snippet
  return label + ' ' + status + ': ' + snippet
}

interface PuterMessage {
  role: 'system' | 'user'
  content: string
}

interface PuterToolCall {
  function?: { arguments?: string }
}

interface PuterChatResponse {
  message?: {
    content?: string | null
    tool_calls?: PuterToolCall[]
  }
}

interface PuterChatOptions {
  model?: string
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
}

interface PuterSDK {
  ai: {
    chat(messages: PuterMessage[], options: PuterChatOptions): Promise<PuterChatResponse>
  }
}

let puterSDKPromise: Promise<PuterSDK> | null = null

function getWindowPuter(): PuterSDK | undefined {
  return (window as Window & { puter?: PuterSDK }).puter
}

function loadPuterSDK(): Promise<PuterSDK> {
  const available = getWindowPuter()
  if (available) return Promise.resolve(available)
  if (puterSDKPromise) return puterSDKPromise

  puterSDKPromise = new Promise<PuterSDK>((resolve, reject) => {
    const src = 'https://js.puter.com/v2/'
    const timeoutMs = 20_000
    let settled = false
    let poll: number | undefined
    let timeout: number | undefined

    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    const shouldAppendScript = !script
    if (!script) {
      script = document.createElement('script')
      script.src = src
      script.async = true
    }

    const finish = (sdk?: PuterSDK, error?: Error) => {
      if (settled) return
      settled = true
      if (poll !== undefined) window.clearInterval(poll)
      if (timeout !== undefined) window.clearTimeout(timeout)
      if (sdk) resolve(sdk)
      else {
        script.remove()
        reject(error || new Error('Puter.js could not be loaded. Check your connection or content blocker, then try again.'))
      }
    }

    poll = window.setInterval(() => {
      const sdk = getWindowPuter()
      if (sdk) finish(sdk)
    }, 50)
    timeout = window.setTimeout(() => {
      finish(undefined, new Error('Puter.js did not finish loading. Check your connection or content blocker, then try again.'))
    }, timeoutMs)

    script.addEventListener('load', () => {
      const sdk = getWindowPuter()
      if (sdk) finish(sdk)
    }, { once: true })
    script.addEventListener('error', () => {
      finish(undefined, new Error('Puter.js could not be loaded. Check your connection or content blocker, then try again.'))
    }, { once: true })
    if (shouldAppendScript) document.head.appendChild(script)
  }).catch((error: unknown) => {
    puterSDKPromise = null
    throw error
  })

  return puterSDKPromise
}

function puterErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

function puterModelNotFound(error: unknown): boolean {
  const message = puterErrorText(error)
  return /model[_\s-]*not[_\s-]*found|unknown model|no such model|unsupported model|invalid model|model.*(?:unavailable|not available|does not exist)|(?:404.*model)|(?:model.*404)/i.test(message)
}

function puterToolsUnsupported(error: unknown): boolean {
  const message = puterErrorText(error).replace(/[_-]+/g, ' ')
  const toolCapability = String.raw`(?:tools?|tool\s+(?:use|calls?|calling)|functions?|function\s+calls?|function\s+calling)`
  const unsupported = String.raw`(?:unsupported|not\s+supported|does(?:\s+not|n't)\s+support|unavailable|not\s+available|disabled|not\s+enabled|unknown|unrecognized|invalid|not\s+(?:a\s+)?valid|not\s+(?:allowed|permitted)|cannot\s+be\s+used|can't\s+be\s+used|does(?:\s+not|n't)\s+allow)`
  return new RegExp(`(?:${toolCapability}).{0,120}(?:${unsupported})|(?:${unsupported}).{0,120}(?:${toolCapability})`, 'is').test(message)
}

function throwFriendlyPuterError(error: unknown): never {
  const message = puterErrorText(error)
  if (/sign[\s_-]?in|signin|log[\s_-]?in|auth(?:entication|orization)?|unauthori[sz]ed|(?:popup|window).*(?:cancel|clos|block)|user.*cancel|cancel(?:led|ed)?/i.test(message)) {
    throw new Error('Puter sign-in was cancelled or failed. Try again, or switch to On-device (WebLLM) or your own API key.')
  }
  if (error instanceof Error) throw error
  throw new Error(message || 'Puter.js could not complete the extraction.')
}

export async function callLLM(
  cfg: LLMConfig,
  inputs: PromptInputs,
  onProgress?: (msg: string, pct?: number) => void,
): Promise<LLMResult> {
  const prompt = buildPrompt(inputs)

  if (cfg.provider === 'puter') {
    const puter = await loadPuterSDK()
    const messages: PuterMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ]
    const schema = anthropicToolSchema()
    const tools: PuterChatOptions['tools'] = [{
      type: 'function',
      function: {
        name: 'record_mpn_variables',
        description: schema.description,
        parameters: schema.input_schema,
      },
    }]

    const chat = (model?: string, withTools = true) => puter.ai.chat(messages, {
      ...(model ? { model } : {}),
      ...(withTools ? { tools } : {}),
    })
    const chatWithToolFallback = async (model?: string) => {
      try {
        return await chat(model)
      } catch (error: unknown) {
        if (!puterToolsUnsupported(error)) throw error
        return chat(model, false)
      }
    }
    let response: PuterChatResponse
    try {
      response = await chatWithToolFallback(cfg.model)
    } catch (error: unknown) {
      if (!puterModelNotFound(error)) throwFriendlyPuterError(error)
      try {
        response = await chatWithToolFallback('gpt-4.1')
      } catch (fallbackError: unknown) {
        if (!puterModelNotFound(fallbackError)) throwFriendlyPuterError(fallbackError)
        try {
          response = await chatWithToolFallback()
        } catch (defaultError: unknown) {
          throwFriendlyPuterError(defaultError)
        }
      }
    }

    const argumentsJSON = response.message?.tool_calls?.[0]?.function?.arguments
    if (argumentsJSON) {
      try {
        return { raw: JSON.parse(argumentsJSON), provider: 'puter', model: cfg.model }
      } catch { /* fall back to JSON content below */ }
    }
    const parsed = extractJSON(response.message?.content ?? String(response))
    if (parsed) return { raw: parsed, provider: 'puter', model: cfg.model }
    throw new Error('Puter.js returned no structured output.')
  }

  if (cfg.provider === 'webllm') {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new Error('This browser has no WebGPU support. Use Chrome or Edge, or choose Puter.js / your own API key.')
    }
    const messages = [
      { role: 'system' as const, content: prompt.system },
      { role: 'user' as const, content: prompt.user },
    ]
    const { runWebLLM } = await import('./webllm')
    const raw = await runWebLLM(cfg.model, messages, onProgress)
    return { raw, provider: 'webllm', model: cfg.model }
  }

  if (cfg.provider === 'anthropic') {
    const tool = anthropicToolSchema()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model, max_tokens: 2500, system: prompt.system,
        tools: [tool], tool_choice: { type: 'tool', name: 'record_mpn_variables' },
        messages: [{ role: 'user', content: prompt.user }],
      }),
    })
    if (!res.ok) throw new Error(friendlyError('anthropic', res.status, await res.text()))
    const data = await res.json()
    const block = (data.content || []).find((c: { type: string }) => c.type === 'tool_use')
    if (block && block.input) return { raw: block.input, provider: 'anthropic', model: cfg.model }
    const textBlock = (data.content || []).find((c: { type: string }) => c.type === 'text')
    const parsed = extractJSON(textBlock && textBlock.text)
    if (parsed) return { raw: parsed, provider: 'anthropic', model: cfg.model }
    throw new Error('Anthropic returned no structured output.')
  }

  if (cfg.provider === 'gemini') {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(cfg.model) + ':generateContent?key=' + encodeURIComponent(cfg.key)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: variablesJsonSchema('gemini') },
      }),
    })
    if (!res.ok) throw new Error(friendlyError('gemini', res.status, await res.text()))
    const data = await res.json()
    const cand = data.candidates && data.candidates[0]
    const partText = cand && cand.content && cand.content.parts && cand.content.parts.map((p: { text?: string }) => p.text || '').join('')
    const parsed = extractJSON(partText)
    if (parsed) return { raw: parsed, provider: 'gemini', model: cfg.model }
    throw new Error('Gemini returned unparseable output' + (cand && cand.finishReason ? ' (finishReason: ' + cand.finishReason + ')' : '') + '.')
  }

  if (cfg.provider === 'groq') {
    // Groq is OpenAI-compatible; mirror the OpenAI branch (plain JSON, no tool-calling).
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    })
    if (!res.ok) throw new Error(friendlyError('groq', res.status, await res.text()))
    const data = await res.json()
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    const parsed = extractJSON(content)
    if (parsed) return { raw: parsed, provider: 'groq', model: cfg.model }
    throw new Error('Groq returned unparseable output.')
  }

  // OpenAI
  const openaiBody: Record<string, unknown> = {
    model: cfg.model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  }
  if (!/^o\d/i.test(cfg.model)) openaiBody.temperature = 0
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify(openaiBody),
  })
  if (!res.ok) throw new Error(friendlyError('openai', res.status, await res.text()))
  const data = await res.json()
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  const parsed = extractJSON(content)
  if (parsed) return { raw: parsed, provider: 'openai', model: cfg.model }
  throw new Error('OpenAI returned unparseable output.')
}

// ---------------------------------------------------------------- examples
export interface Example { label: string; inputs: PromptInputs }
export const EXAMPLES: Record<string, Example> = {
  pv: {
    label: 'PV: 62M erythrocytosis',
    inputs: {
      age: 62, sex: 'male', hemoglobin: 19.4, hematocrit: 57, wbc: 12.1, platelets: 498, ldh: 245, ldh_uln: 250, peripheral_blasts: 0, epo: 'low',
      jak2_v617f: 'positive', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative', bcr_abl1: 'negative',
      bm_cellularity: 'hypercellular', megakaryocyte_pattern: 'pleomorphic', reticulin_fibrosis_grade: '1', panmyelosis: true, red_cell_mass: 'increased',
      constitutional_symptoms: false, splenomegaly: true, spleen_cm: 3, prior_thrombosis: false, cv_risk_factors: true,
      clinical_note: '62-year-old man referred for evaluation of erythrocytosis noted on routine labs. He reports aquagenic pruritus after hot showers, occasional headaches and facial plethora. No prior arterial or venous thrombosis. History of hypertension, on lisinopril. Physical exam notable for ruddy complexion and a spleen palpable ~3 cm below the left costal margin. No B symptoms.',
      pathology_report: 'Bone marrow aspirate and core biopsy: markedly hypercellular for age (~90% cellularity) with trilineage panmyelosis. Erythroid and granulocytic hyperplasia. Megakaryocytes increased and pleomorphic, ranging from small to large forms with hyperlobulated nuclei, in loose clusters. Reticulin stain MF-1. No increase in blasts. Iron stores decreased. Findings consistent with a myeloproliferative neoplasm, favor polycythemia vera.',
    },
  },
  et: {
    label: 'ET: 48F thrombocytosis',
    inputs: {
      age: 48, sex: 'female', hemoglobin: 13.5, hematocrit: 40, wbc: 8.9, platelets: 812, ldh: 210, ldh_uln: 250, peripheral_blasts: 0, epo: 'normal',
      jak2_v617f: 'positive', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative', bcr_abl1: 'negative',
      bm_cellularity: 'normocellular', megakaryocyte_pattern: 'large_mature', reticulin_fibrosis_grade: '0', reactive_thrombocytosis_excluded: true,
      constitutional_symptoms: false, splenomegaly: false, prior_thrombosis: false, cv_risk_factors: false,
      clinical_note: '48-year-old woman with incidentally discovered thrombocytosis on a pre-operative CBC. Asymptomatic; no bleeding, no thrombosis, no vasomotor symptoms. No splenomegaly on exam. No cardiovascular risk factors. Reactive causes excluded (ferritin normal, CRP normal, no infection or inflammation).',
      pathology_report: "Bone marrow core biopsy: normocellular for age. Marked proliferation of enlarged, mature megakaryocytes with hyperlobulated 'staghorn' nuclei, predominantly loosely scattered. No significant left shift in granulopoiesis or erythropoiesis. Reticulin stain MF-0, no fibrosis. No increase in blasts. Morphology consistent with essential thrombocythemia.",
    },
  },
  mf: {
    label: 'Overt MF: 71M cytopenias + splenomegaly',
    inputs: {
      age: 71, sex: 'male', hemoglobin: 9.1, hematocrit: 28, wbc: 27, platelets: 95, ldh: 540, ldh_uln: 250, peripheral_blasts: 3, epo: 'normal',
      jak2_v617f: 'positive', jak2_exon12: 'negative', calr: 'negative', mpl: 'negative', bcr_abl1: 'negative',
      hmr_mutations: ['ASXL1'], karyotype_risk: 'unfavorable', karyotype_detail: 'del(20q), +8',
      bm_cellularity: 'hypercellular', megakaryocyte_pattern: 'atypical_clustered', reticulin_fibrosis_grade: '3', granulocytic_proliferation: true, decreased_erythropoiesis: true, leukoerythroblastosis: true,
      constitutional_symptoms: true, splenomegaly: true, spleen_cm: 8, prior_thrombosis: false, cv_risk_factors: false, transfusion_dependent: true,
      clinical_note: '71-year-old man with 6 months of progressive fatigue, drenching night sweats and ~7 kg unintentional weight loss. Increasing early satiety from splenomegaly; spleen palpable 8 cm below the costal margin. Requires intermittent red-cell transfusions. Peripheral smear shows a leukoerythroblastic picture with teardrop cells and 3% circulating blasts.',
      pathology_report: 'Bone marrow core biopsy: megakaryocytic proliferation and atypia with dense clustering; megakaryocytes with hyperchromatic, bulbous and irregularly folded nuclei. Reticulin and collagen fibrosis grade 2–3 (MF-2/3). Granulocytic proliferation with decreased erythropoiesis. Osteosclerosis present. Findings diagnostic of overt primary myelofibrosis.',
    },
  },
}
