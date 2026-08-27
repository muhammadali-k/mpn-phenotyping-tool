import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Copy, Download, FlaskConical, Loader2, Printer, Sparkles } from 'lucide-react'
import {
  callLLM, diagnose, EXAMPLES, FIELDS, FIELD_BY_KEY, GROUP_LABEL, GROUP_ORDER,
  normalizeExtraction, prognose, PROVIDERS, providerIsKeyless, providerIsOnDevice,
  type ClassifyResult, type Extraction, type SourceTag, type VarValue, type Variables,
} from '@/lib/engine'
import { useApp } from '@/lib/store'
import { Button, Eyebrow, StepMarker } from '@/components/ui/primitives'
import { GateRow, StatusLine, VarField } from './fields'
import {
  anyMolecularTestOpen, applyChange, DRIVER_KEYS, hasBlockingErrors, hmrList, isUiKey, isVisible, KARYOTYPE_KEYS, reconcile,
  TRIPLE_KEYS, UI_DRIVER_TESTED, UI_KARYOTYPE_TESTED, validateForm, type FormState, type Validation,
} from './formSchema'
import { DeidPanel } from './DeidPanel'
import { EntryModeModal, type EntryMode } from './EntryModeModal'
import { Results } from './Results'
import { cx, fmtValue } from '@/lib/util'

type Step = 1 | 2 | 3
const EMPTY_EXTRACT: Extraction = { variables: {}, sources: {}, fields: {}, needsReview: [], rationale: '', impression: '' }

function sameValue(a: VarValue, b: VarValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x) => b.includes(x))
  return String(a) === String(b)
}

export function Tool() {
  const { config, setConfig, setKeyModalOpen } = useApp()
  const [step, setStepRaw] = useState<Step>(1)
  const stepRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const setStep = (s: Step) => setStepRaw(s)
  const [note, setNote] = useState('')
  const [path, setPath] = useState('')
  const [attested, setAttested] = useState(false)
  const [onFile, setOnFile] = useState<Variables>({}) // structured "on file" (example)
  const [extracted, setExtracted] = useState<Extraction>(EMPTY_EXTRACT)
  const [lastExtract, setLastExtract] = useState<{ provider: string; model: string } | null>(null)
  const [form, setForm] = useState<Record<string, VarValue | undefined>>({})
  const [result, setResult] = useState<ClassifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progressText, setProgressText] = useState('')
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null)
  const [llmAcknowledged, setLlmAcknowledged] = useState(false)
  const [entryModalOpen, setEntryModalOpen] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  // keys the user has edited by hand in Step 2: a later extraction must not overwrite them
  const userEdited = useRef<Set<string>>(new Set())

  // every Step 2 edit invalidates a previously computed result so a stale
  // diagnosis can never be viewed or exported after the inputs changed
  function setFormUser(next: FormState) {
    Object.keys(next).forEach((k) => { if (!isUiKey(k) && !sameValue((form[k] ?? '') as VarValue, (next[k] ?? '') as VarValue)) userEdited.current.add(k) })
    setForm(next)
    if (result) setResult(null)
  }

  const flash = (m: string) => {
    setToast(m); window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2400)
  }
  // clear pending toast timer on unmount
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  // move focus to the new step's container on transition (skip initial mount)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    stepRef.current?.focus()
  }, [step])
  useEffect(() => {
    if (step === 1 && entryMode === null) setEntryModalOpen(true)
  }, [entryMode, step])
  // the cloud-sharing acknowledgment is tied to the provider it was given for:
  // any provider change (cloud ↔ cloud or on-device ↔ cloud) requires it again
  const ackProvider = useRef(config.provider)
  useEffect(() => {
    if (ackProvider.current !== config.provider) { ackProvider.current = config.provider; setLlmAcknowledged(false) }
  }, [config.provider])

  const hasText = (note + path).trim().length > 0
  const keyless = providerIsKeyless(config.provider)
  const onDevice = providerIsOnDevice(config.provider)
  const hasCredential = keyless || !!config.key
  const ackOk = onDevice || llmAcknowledged
  const extractReady = attested && hasText && hasCredential && ackOk
  const providerInfo = PROVIDERS[config.provider]
  const providerName = providerInfo.label.split(' — ')[0].split(' (')[0]

  function reset() {
    setNote(''); setPath(''); setAttested(false); setOnFile({}); setExtracted(EMPTY_EXTRACT)
    setLastExtract(null); setForm({}); setResult(null); setError(''); setProgressText('')
    userEdited.current = new Set()
  }

  function loadExample(k: keyof typeof EXAMPLES) {
    const inp = EXAMPLES[k].inputs
    setNote(inp.clinical_note || ''); setPath(inp.pathology_report || '')
    const structured: Variables = {}
    Object.keys(inp).forEach((key) => {
      if (key === 'clinical_note' || key === 'pathology_report') return
      if (FIELD_BY_KEY[key]) structured[key] = inp[key] as VarValue
    })
    setOnFile(structured); setExtracted(EMPTY_EXTRACT); setAttested(true); setError('')
    // a new case replaces any previous form and result outright
    setForm({}); setResult(null); userEdited.current = new Set()
    flash(`Loaded ${EXAMPLES[k].label}`)
  }

  function initForm(ext: Extraction, base: Variables) {
    const f: FormState = {}
    FIELDS.forEach((field) => {
      const k = field.key
      // a value the user typed by hand, or deliberately cleared, survives a (re-)extraction
      if (userEdited.current.has(k)) { f[k] = form[k]; return }
      f[k] = base[k] !== undefined ? base[k] : ext.variables[k]
    })
    // enforce consistency + derive gates from whatever evidence was extracted
    setForm(reconcile(f))
    setResult(null)
  }

  async function runExtraction() {
    if (!ackOk) {
      setError('Confirm the data-sharing acknowledgment before starting cloud AI extraction.')
      return
    }
    setBusy(true); setError(''); setProgressText('Starting AI extraction…')
    try {
      const inputs = { ...onFile, clinical_note: note, pathology_report: path }
      const res = await callLLM(config, inputs, (message, pct) => {
        const percent = typeof pct === 'number' ? ` ${Math.round(pct * 100)}%` : ''
        setProgressText(`${message}${percent}`)
      })
      const ext = normalizeExtraction(res.raw, note + '\n' + path)
      setExtracted(ext)
      setLastExtract({ provider: res.provider, model: res.model })
      initForm(ext, onFile)
      flash(`Extracted ${Object.keys(ext.variables).length} variable${Object.keys(ext.variables).length === 1 ? '' : 's'}`)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgressText('')
    }
  }

  function skipToForm() {
    // switching to manual entry keeps whatever is already on the form
    // (extracted or hand-entered); only an empty form is seeded from on-file data
    const hasValues = Object.keys(form).some((k) => !isUiKey(k) && form[k] !== undefined && form[k] !== '')
    if (!hasValues) initForm(EMPTY_EXTRACT, onFile)
    setStep(2)
  }

  function chooseEntryMode(mode: EntryMode) {
    setEntryMode(mode)
    setEntryModalOpen(false)
    if (mode === 'manual') {
      setLlmAcknowledged(false)
      skipToForm()
      return
    }
    setLlmAcknowledged(!onDevice)
    setStep(1)
  }

  function runDiagnosis() {
    // form is authoritative: cleared fields override extraction, provenance preserved
    const variables: Variables = {}
    const sources: Record<string, SourceTag> = {}
    Object.keys(form).forEach((k) => {
      if (isUiKey(k)) return // UI-only gate state never reaches the engine
      const v = form[k]
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return
      variables[k] = v
      // on-file structured value wins provenance (structured › pathology › note)
      if (onFile[k] !== undefined && sameValue(onFile[k], v)) {
        sources[k] = 'structured'
      } else {
        const ext = extracted.variables[k]
        const unchanged = ext !== undefined && sameValue(ext, v)
        sources[k] = unchanged ? (extracted.sources[k] || 'note') : 'structured'
      }
    })
    const dx = diagnose(variables)
    const prog = prognose(dx, variables)
    setResult({ merged: { variables, sources }, diagnosis: dx, prognosis: prog })
    setStep(3)
  }

  const stepDefs: { n: string; label: string }[] = [
    { n: '01', label: 'Paste note' },
    { n: '02', label: 'Review variables' },
    { n: '03', label: 'Diagnosis + prognosis' },
  ]

  // a step is reachable if it's at or before the current step, or is an
  // already-computed step (2 or 3 once a result exists). Navigation is frozen
  // while an extraction is in flight so its completion cannot clobber edits.
  const canGo = (i: number) => !busy && (i + 1 <= step || (!!result && (i === 1 || i === 2)))

  return (
    <div className="app-frame corners relative rounded-[14px] bg-surface">
      <span className="cm tl" aria-hidden /><span className="cm tr" aria-hidden />
      <span className="cm bl" aria-hidden /><span className="cm br" aria-hidden />

      <div className="overflow-hidden rounded-[14px]">
        {/* frame header — step markers */}
        <nav aria-label="Workflow steps" className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-3.5 sm:gap-x-6 sm:px-6 md:px-7">
          {stepDefs.map((s, i) => (
            <button key={s.n} type="button"
              onClick={() => { if (canGo(i)) setStep((i + 1) as Step) }}
              disabled={!canGo(i)}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={cx('transition-opacity', !canGo(i) && 'opacity-45')}
            >
              <StepMarker n={s.n} label={s.label} active={step === i + 1} />
            </button>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => setKeyModalOpen(true)} className="inline-flex items-center gap-2 font-mono text-[11.5px] text-muted transition-colors hover:text-ink">
            <span className={cx('inline-block h-[7px] w-[7px] rounded-full', hasCredential ? 'bg-success' : 'bg-faint')} aria-hidden />
            {hasCredential ? PROVIDERS[config.provider].label : 'set up model'}
          </button>
        </nav>

        <div className="scroll p-5 sm:p-6 md:p-7">
          <div key={step} ref={stepRef} tabIndex={-1} className="step-in outline-none">
            {step === 1 && (
            <StepReports
              note={note} path={path} setNote={setNote} setPath={setPath}
              attested={attested} setAttested={setAttested}
              onLoadExample={loadExample} onClear={reset}
              extractReady={extractReady} busy={busy} error={error}
              hasCredential={hasCredential} keyless={keyless} ackOk={ackOk} hasText={hasText}
              providerName={providerName} getKeyUrl={providerInfo.getKeyUrl}
              progressText={progressText}
              onExtract={runExtraction} onChangeEntryMode={() => setEntryModalOpen(true)}
              onOpenKeyModal={() => setKeyModalOpen(true)}
              onApplyRedaction={(n, p) => { setNote(n); setPath(p) }}
              cloudProvider={!onDevice} acknowledged={llmAcknowledged} onAcknowledge={setLlmAcknowledged}
            />
          )}
          {step === 2 && (
            <StepVariables
              form={form} setForm={setFormUser} extracted={extracted} onFile={onFile} lastExtract={lastExtract}
              onBack={() => setStep(1)} onRun={runDiagnosis}
            />
          )}
            {step === 3 && result && (
              <StepResults result={result} extracted={extracted} lastExtract={lastExtract} onBack={() => setStep(2)} onCopy={(ok) => flash(ok ? 'Summary copied' : 'Copy failed in this browser; use Export JSON')} />
            )}
          </div>
        </div>
      </div>

      {/* persistent live region so screen readers hear status changes */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{toast}</div>
      {toast && (
        <div aria-hidden className="toast-in pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-surface shadow-[var(--frame-shadow)]">
          {toast}
        </div>
      )}
      <EntryModeModal
        open={entryModalOpen}
        onOpenChange={setEntryModalOpen}
        provider={config.provider}
        model={config.model}
        hasKey={!!config.key}
        onChoose={chooseEntryMode}
        onOpenProviderSettings={() => setKeyModalOpen(true)}
        onUsePuter={() => setConfig({ provider: 'puter', key: '', model: PROVIDERS.puter.defaultModel })}
        required={entryMode === null}
      />
    </div>
  )
}

/* ============================================================ Step 1 */
function StepReports(props: {
  note: string; path: string; setNote: (s: string) => void; setPath: (s: string) => void
  attested: boolean; setAttested: (b: boolean) => void
  onLoadExample: (k: keyof typeof EXAMPLES) => void; onClear: () => void
  extractReady: boolean; busy: boolean; error: string; hasCredential: boolean; keyless: boolean; ackOk: boolean; hasText: boolean
  providerName: string; getKeyUrl?: string
  progressText: string
  onExtract: () => void; onChangeEntryMode: () => void; onOpenKeyModal: () => void; onApplyRedaction: (n: string, p: string) => void
  cloudProvider: boolean; acknowledged: boolean; onAcknowledge: (b: boolean) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const ta = 'scroll min-h-[130px] w-full resize-y rounded-[6px] border border-line-strong bg-surface2 px-3.5 py-3 text-[14px] leading-[1.6] outline-none transition-colors focus:border-focus focus:bg-surface'
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <Eyebrow>Clinical note &amp; pathology report</Eyebrow>
          <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false) }}>
            <Button variant="outline" size="sm" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <FlaskConical aria-hidden size={14} /> Load example
            </Button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden onClick={() => setMenuOpen(false)} />
                <div role="menu" aria-label="Load example case" className="absolute right-0 z-20 mt-1.5 w-60 rounded-[8px] border border-line-strong bg-surface p-1.5 shadow-[var(--shadow-sm)]">
                  {(Object.keys(EXAMPLES) as (keyof typeof EXAMPLES)[]).map((k, i) => (
                    <button key={k} type="button" role="menuitem" autoFocus={i === 0} onClick={() => { props.onLoadExample(k); setMenuOpen(false) }}
                      className="block w-full rounded-[6px] px-3 py-2 text-left text-[13.5px] transition-colors hover:bg-surface2 focus:bg-surface2">
                      {EXAMPLES[k].label}
                      <span className="block font-mono text-[10.5px] text-faint">synthetic · no PHI</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 flex items-baseline gap-2"><span className="text-[12.5px] font-medium text-muted">Clinical note</span><span className="font-mono text-[10.5px] text-faint">optional</span></span>
          <textarea className={ta} placeholder="Paste a de-identified clinical / hematology note…" value={props.note} onChange={(e) => props.setNote(e.target.value)} />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 flex items-baseline gap-2"><span className="text-[12.5px] font-medium text-muted">Pathology / bone-marrow biopsy report</span><span className="font-mono text-[10.5px] text-faint">optional</span></span>
          <textarea className={ta} placeholder="Paste a de-identified pathology or bone-marrow report…" value={props.path} onChange={(e) => props.setPath(e.target.value)} />
        </label>

        <DeidPanel note={props.note} path={props.path} onApplyRedaction={props.onApplyRedaction} />

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] border border-line-strong bg-surface px-4 py-3">
          <input type="checkbox" checked={props.attested} onChange={(e) => props.setAttested(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent" />
          <span className="text-[13px] text-muted"><strong className="text-ink">I confirm this text is de-identified.</strong> It contains no names, MRNs, dates of birth, contact details or other direct identifiers, and I am authorized to process it with a third-party model.</span>
        </label>

        {/* the cloud-sharing acknowledgment always sits next to the action it
            governs whenever a cloud provider is selected; it is never defaulted,
            resets on any provider change, and is required before extraction */}
        {props.cloudProvider && (
          <label className={cx('mt-3 flex cursor-pointer items-start gap-3 rounded-[8px] border px-4 py-3', props.acknowledged ? 'border-line bg-surface' : 'border-warn/50 bg-[color-mix(in_srgb,var(--c-warn)_7%,transparent)]')}>
            <input type="checkbox" checked={props.acknowledged} onChange={(e) => props.onAcknowledge(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent" />
            <span className="text-[13px] leading-relaxed text-muted">
              <strong className="text-ink">I understand this text will be shared with a third-party AI service ({props.providerName}).</strong>{' '}
              It is an external provider outside our control, not firewall-protected, and not covered by a HIPAA Business Associate Agreement. I will use de-identified or synthetic text only. Required before extraction; asked again if the provider changes.
            </span>
          </label>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button
            onClick={props.onExtract}
            disabled={!props.extractReady || props.busy}
            title={!props.hasText ? 'Paste a note or report first' : !props.attested ? 'Confirm de-identification first' : !props.ackOk ? 'Confirm the data-sharing acknowledgment first' : !props.hasCredential && !props.keyless ? `Add your free ${props.providerName} key first` : 'Extract structured variables'}
          >
            {props.busy ? <Loader2 aria-hidden size={15} className="animate-spin" /> : <Sparkles aria-hidden size={15} />}
            {props.busy ? 'Extracting…' : 'Extract with AI'}
          </Button>
          <Button variant="outline" size="sm" onClick={props.onChangeEntryMode}>Change entry mode</Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={props.onClear}>Clear</Button>
        </div>
        {!props.hasCredential && !props.keyless && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            <span>{props.providerName} needs a one-time free key (no credit card).</span>
            {props.getKeyUrl && (
              <a
                href={props.getKeyUrl} target="_blank" rel="noopener noreferrer"
                className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
              >
                Get a free key ↗
              </a>
            )}
            <button
              type="button"
              onClick={props.onOpenKeyModal}
              className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
            >
              Add key
            </button>
          </div>
        )}
        {props.busy && props.progressText && (
          <div role="status" aria-live="polite" className="mt-2.5 font-mono text-[11.5px] text-muted">
            {props.progressText}
          </div>
        )}
        {props.error && (
          <div role="alert" className="mt-3.5 rounded-[8px] bg-[color-mix(in_srgb,var(--c-danger)_12%,transparent)] px-4 py-3 text-[13px] text-danger">
            {props.error}
          </div>
        )}
      </div>

      <aside className="rounded-[10px] border border-line bg-surface2 p-5">
        <Eyebrow>How it works</Eyebrow>
        <ol className="mt-3 space-y-3 text-[13px] text-muted">
          {[
            <><strong className="text-ink">De-identify &amp; paste</strong> a clinical note and/or pathology report, both optional.</>,
            <>Your chosen AI provider extracts structured variables browser-direct. <strong className="text-ink">Groq</strong> is the fast, free default: paste a one-time free key (no credit card, no popups). Or pick Puter for zero-setup, an on-device model, or your own OpenAI, Anthropic, or Gemini key.</>,
            <><strong className="text-ink">Review &amp; complete</strong> the structured form; findings that are pending or not documented are left for you to confirm, never assumed negative.</>,
            <>Get an independent <strong className="text-ink">WHO 2016/2022 assessment</strong> of PV, ET, and overt MF (confirmed, suspicious, or not) plus <strong className="text-ink">prognostic scoring</strong> once a diagnosis is confirmed, each traced to its source.</>,
          ].map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-[1px] font-mono text-[11px] font-medium text-faint tnum">{String(i + 1).padStart(2, '0')}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 rounded-[8px] border border-line bg-surface px-4 py-3 text-[12.5px] text-muted">
          <span className="text-info">No note?</span> Choose <strong className="text-ink">Enter data manually</strong> from the entry-mode pop-up: diagnosis works from structured variables alone.
        </div>
      </aside>
    </div>
  )
}

/* ============================================================ Step 2 */
function StepVariables({ form, setForm, extracted, onFile, lastExtract, onBack, onRun }: {
  form: Record<string, VarValue | undefined>
  setForm: (f: Record<string, VarValue | undefined>) => void
  extracted: Extraction; onFile: Variables; lastExtract: { provider: string; model: string } | null
  onBack: () => void; onRun: () => void
}) {
  // every edit goes through the schema so dependent fields stay consistent
  const setField = (k: string, v: VarValue | undefined) => setForm(applyChange(form, k, v))
  const sourceOf = (k: string): SourceTag | null => {
    const v = form[k]
    if (v === undefined) return null
    if (onFile[k] !== undefined && sameValue(onFile[k], v)) return 'structured'
    const ext = extracted.variables[k]
    if (ext !== undefined && sameValue(ext, v)) return extracted.sources[k] || 'note'
    return 'structured'
  }
  const extractedKeys = Object.keys(extracted.variables)
  const validation = validateForm(form)
  const blocked = hasBlockingErrors(validation)
  const errorLabels = Object.keys(validation).filter((k) => validation[k].level === 'error').map((k) => FIELD_BY_KEY[k]?.label || k)
  const reviewKeys = (extracted.needsReview || []).filter((k) => FIELD_BY_KEY[k])
  const reviewOf = (k: string) => reviewKeys.includes(k)

  return (
    <div>
      <Eyebrow>Step 02 · source priority: structured › pathology › note</Eyebrow>
      <h3 className="mt-1.5 font-display text-[28px] leading-tight tracking-[-0.015em]">Review &amp; complete structured variables</h3>
      <p className="mt-1.5 max-w-[70ch] text-[14px] text-muted">
        Values extracted from free text are pre-filled and tagged by source. Edit anything, and add whatever labs, molecular, and cytogenetic data you have; the more complete the inputs, the more criteria can be assessed and the applicable prognostic model applied. A blank field is treated as unavailable, not negative.
      </p>

      {extractedKeys.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-line bg-surface2 p-4">
          {lastExtract && <Eyebrow>Extracted by {lastExtract.provider} · {lastExtract.model}</Eyebrow>}
          {extracted.impression && <p className="mt-2 text-[13px] text-muted"><strong className="text-ink">Report impression:</strong> {extracted.impression}</p>}
          {extracted.rationale && <p className="mt-1.5 text-[12.5px] text-muted"><strong className="text-ink">Model rationale:</strong> {extracted.rationale}</p>}
          <div className="mt-2 font-mono text-[11px] text-faint tnum">{extractedKeys.length} variable{extractedKeys.length === 1 ? '' : 's'} extracted from free text</div>
        </div>
      )}

      {reviewKeys.length > 0 && (
        <div className="mt-4">
          <StatusLine tone="warn">
            <strong>Needs review ({reviewKeys.length}):</strong> {reviewKeys.map((k) => FIELD_BY_KEY[k].label).join(', ')}. The model addressed these, but the value could not be grounded in the text, was pending or not documented, or contradicted another finding. They were left blank or adjusted; confirm them before running.
          </StatusLine>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="rounded-[10px] border border-line bg-surface">
            <div className="border-b border-line px-4 py-3"><h4 className="text-[14px] font-semibold">{GROUP_LABEL[group]}</h4></div>
            <div className="space-y-4 px-4 py-4">
              {group === 'molecular'
                ? <MolecularPanel form={form} setField={setField} sourceOf={sourceOf} reviewOf={reviewOf} />
                : FIELDS.filter((f) => f.group === group && isVisible(f.key, form)).map((f) => (
                    <VarField key={f.key} field={f} value={form[f.key]} source={sourceOf(f.key)} onChange={(v) => setField(f.key, v)}
                      validation={validation[f.key]} review={reviewOf(f.key)} />
                  ))}
            </div>
          </div>
        ))}
      </div>

      {blocked && (
        <div className="mt-5">
          <StatusLine tone="warn">
            <strong>Fix the highlighted values before running:</strong> {errorLabels.join(', ')}. Values outside the plausible range are usually a unit or typing slip and would silently change the assessment.
          </StatusLine>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <Button variant="ghost" onClick={onBack}>← Back to reports</Button>
        <div className="flex-1" />
        <Button onClick={onRun} disabled={blocked} title={blocked ? 'Fix the highlighted values first' : 'Run diagnosis and prognosis'}>
          Run diagnosis &amp; prognosis <ArrowRight aria-hidden size={15} />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Molecular & cytogenetics
   Guided entry: each test is a yes / no / unknown gate; its result fields appear
   only once the test is marked performed. Triple-negative status is derived from
   the driver results rather than asked separately, so it can never contradict them. */
function MolecularPanel({ form, setField, sourceOf, reviewOf }: {
  form: FormState
  setField: (k: string, v: VarValue | undefined) => void
  sourceOf: (k: string) => SourceTag | null
  reviewOf: (k: string) => boolean
}) {
  const noValidation: Validation | null = null
  const driverOpen = form[UI_DRIVER_TESTED] === true
  const hmrOpen = form.hmr_tested === true
  const karyoOpen = form[UI_KARYOTYPE_TESTED] === true
  const anyOpen = anyMolecularTestOpen(form)
  const showClonal = anyOpen || form.clonal_marker_present !== undefined
  const hmr = hmrList(form)

  const driverStatus = (() => {
    if (!driverOpen) return null
    const pos: string[] = []
    if (form.jak2_v617f === 'positive') pos.push('JAK2 V617F')
    if (form.jak2_exon12 === 'positive') pos.push('JAK2 exon 12')
    if (form.calr && form.calr !== 'negative') pos.push(`CALR ${String(form.calr).replace(/_/g, ' ')}`)
    if (form.mpl === 'positive') pos.push('MPL')
    if (form.bcr_abl1 === 'positive') pos.push('BCR-ABL1')
    if (pos.length) return { tone: 'info' as const, text: `Driver result: ${pos.join(', ')} positive.` }
    if (form.triple_negative === true) return { tone: 'info' as const, text: 'Triple negative: JAK2 V617F, CALR and MPL all negative.' }
    const untested = TRIPLE_KEYS.filter((k) => form[k] === undefined).map((k) => FIELD_BY_KEY[k].label)
    if (untested.length) return { tone: 'muted' as const, text: `Not yet entered: ${untested.join(', ')}. Leave blank if not included in the panel; a blank result is treated as untested, not negative.` }
    return null
  })()

  const withLabel = (key: string, label: string) => ({ ...FIELD_BY_KEY[key], label })
  const indent = 'mt-3 space-y-4 border-l-2 border-line-strong pl-4'

  return (
    <div className="space-y-5">
      {/* 1. driver mutations */}
      <div>
        <GateRow id="gate-driver" label="Driver mutation testing performed?" hint="JAK2 V617F, JAK2 exon 12, CALR, MPL, BCR-ABL1"
          value={form[UI_DRIVER_TESTED]} onChange={(v) => setField(UI_DRIVER_TESTED, v)} />
        {driverOpen && (
          <div className={indent}>
            {DRIVER_KEYS.map((k) => (
              <VarField key={k} field={FIELD_BY_KEY[k]} value={form[k]} source={sourceOf(k)} onChange={(v) => setField(k, v)} validation={noValidation} review={reviewOf(k)} />
            ))}
            {driverStatus && <StatusLine tone={driverStatus.tone}>{driverStatus.text}</StatusLine>}
          </div>
        )}
      </div>

      {/* 2. extended NGS / HMR panel */}
      <div className="border-t border-line pt-5">
        <GateRow id="gate-hmr" label="Extended NGS / high-molecular-risk (HMR) panel performed?" hint="ASXL1, EZH2, SRSF2, IDH1, IDH2, U2AF1 Q157"
          value={form.hmr_tested} onChange={(v) => setField('hmr_tested', v)} />
        {hmrOpen && (
          <div className={indent}>
            <VarField field={withLabel('hmr_mutations', 'HMR mutations detected (select all that apply)')} value={form.hmr_mutations} source={sourceOf('hmr_mutations')} onChange={(v) => setField('hmr_mutations', v)} review={reviewOf('hmr_mutations')} />
            <StatusLine tone={hmr.length ? 'info' : 'muted'}>
              {hmr.length
                ? `${hmr.length} HMR mutation${hmr.length === 1 ? '' : 's'} recorded: ${hmr.join(', ')}.`
                : 'No mutations selected: recorded as HMR-negative (panel performed, none detected).'}
            </StatusLine>
          </div>
        )}
      </div>

      {/* 3. cytogenetics */}
      <div className="border-t border-line pt-5">
        <GateRow id="gate-karyo" label="Cytogenetics / karyotype performed?"
          value={form[UI_KARYOTYPE_TESTED]} onChange={(v) => setField(UI_KARYOTYPE_TESTED, v)} />
        {karyoOpen && (
          <div className={indent}>
            {KARYOTYPE_KEYS.map((k) => (
              <VarField key={k} field={FIELD_BY_KEY[k]} value={form[k]} source={sourceOf(k)} onChange={(v) => setField(k, v)} review={reviewOf(k)} />
            ))}
            {form.karyotype_risk === undefined && (
              <StatusLine tone="muted">Karyotype risk is the scored field: choose favorable, unfavorable, or very high so DIPSS+ and MIPSS70+ v2.0 can be established. Without it they report "category not established".</StatusLine>
            )}
          </div>
        )}
      </div>

      {/* 4. other clonal evidence: only knowable once some test is open */}
      {showClonal && (
        <div className="border-t border-line pt-5">
          <VarField field={withLabel('clonal_marker_present', 'Other clonal marker present (non-driver)')} value={form.clonal_marker_present} source={sourceOf('clonal_marker_present')} onChange={(v) => setField('clonal_marker_present', v)} review={reviewOf('clonal_marker_present')} />
          <p className="mt-1.5 text-[12px] text-faint">Any additional clonal abnormality on sequencing or cytogenetics.</p>
        </div>
      )}

      {!anyOpen && (
        <p className="text-[12.5px] leading-relaxed text-faint">
          Answer the testing questions above to enter results. Tests marked no or unknown are left blank and are never counted as negative.
        </p>
      )}
    </div>
  )
}

/* ============================================================ Step 3 */
function StepResults({ result, extracted, lastExtract, onBack, onCopy }: {
  result: ClassifyResult; extracted: Extraction; lastExtract: { provider: string; model: string } | null
  onBack: () => void; onCopy: (ok: boolean) => void
}) {
  const summary = useMemo(() => buildSummary(result), [result])

  const copy = async () => {
    let ok = false
    try {
      if (navigator.clipboard) { await navigator.clipboard.writeText(summary); ok = true }
      else throw new Error('no clipboard')
    } catch {
      const ta = document.createElement('textarea'); ta.value = summary; document.body.appendChild(ta); ta.select()
      try { ok = document.execCommand('copy') } catch { ok = false }
      ta.remove()
    }
    // only report success when the text actually reached the clipboard
    onCopy(ok)
  }

  const exportJSON = () => {
    const payload = {
      diagnosis: result.diagnosis, prognosis: result.prognosis, resolved: result.merged,
      // full per-field provenance (value, status, snippet, source) and review flags travel with the export
      extraction: { provider: lastExtract, impression: extracted.impression, rationale: extracted.rationale, fields: extracted.fields, needsReview: extracted.needsReview },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `mpn-phenotyping-${result.diagnosis.code || 'result'}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div>
      <div className="print-hide mb-4 flex flex-wrap items-center gap-2.5">
        <Button variant="ghost" size="sm" onClick={onBack}>← Edit variables</Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={copy}><Copy aria-hidden size={14} /> Copy summary</Button>
        <Button variant="outline" size="sm" onClick={exportJSON}><Download aria-hidden size={14} /> Export JSON</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer aria-hidden size={14} /> Print</Button>
      </div>
      <Results result={result} extraction={extracted} />
    </div>
  )
}

function buildSummary(r: ClassifyResult): string {
  const { diagnosis: dx, prognosis: prog, merged } = r
  const L: string[] = []
  L.push('MPN PHENOTYPING: investigational output')
  L.push('='.repeat(44))
  L.push(`Diagnostic assessment (${dx.whoEdition}): ${dx.headline}`)
  L.push(`Summary: ${dx.summary}`)
  L.push('')
  L.push('Per-disease criteria (independent assessment):')
  dx.assessments.forEach((a) => {
    L.push(`  ${a.name} (${a.disease}): ${a.label}`)
    a.criteria.forEach((c) => {
      const m = c.status === 'met' ? '[met]' : c.status === 'not_met' ? '[not met]' : '[unavailable]'
      L.push(`    ${m} (${c.tier}) ${c.label}${c.detail ? '  · ' + c.detail : ''}`)
    })
    if (a.verdict === 'suspicious' && a.outstanding.length) {
      L.push(`    Additional information required: ${a.outstanding.join('; ')}`)
    }
  })
  if (dx.caveats.length) {
    L.push(''); L.push('Caveats:')
    dx.caveats.forEach((c) => L.push(`  - ${c}`))
  }
  L.push(''); L.push('Prognostic assessment:')
  if (prog.gatedReason) {
    L.push(`  Prognostic category not established: ${prog.gatedReason === 'suspicious' ? 'diagnosis not confirmed' : prog.gatedReason === 'conflict' ? 'diagnostic conflict' : 'no confirmed MPN'}. No prognostic scoring performed.`)
  } else {
    prog.order.forEach((k) => {
      const t = prog.tools[k]; if (!t) return
      const star = k === prog.primaryKey ? '* ' : '  '
      if (t.status === 'established') L.push(`  ${star}${t.name}: ${t.category}${t.total != null ? ` (${t.total} pts)` : ''}`)
      else L.push(`  ${star}${t.name}: category not established${t.requiredMissing.length ? ` (missing: ${t.requiredMissing.join(', ')})` : ''}`)
    })
  }
  L.push(''); L.push('Resolved variables (structured › pathology › note):')
  Object.keys(merged.variables).forEach((k) => {
    const f = FIELD_BY_KEY[k]; if (!f) return
    L.push(`  ${f.label}: ${fmtValue(merged.variables[k])}  [${merged.sources[k] || 'note'}]`)
  })
  L.push(''); L.push('Not a medical device. Verify with a hematologist.')
  return L.join('\n')
}
