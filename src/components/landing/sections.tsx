import { ArrowRight, KeyRound, ScanLine, Trash2 } from 'lucide-react'
import { scrollToTool, useApp, type Role } from '@/lib/store'
import { Button, CategoricalChip, Corners, Eyebrow, StatTile } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'
import { cx } from '@/lib/util'

const REPO = 'https://github.com/muhammadali-k/mpn-phenotyping-pipeline'
const container = 'mx-auto max-w-[1120px] px-6'

const ROLE_SUBHEAD: Record<Role, string> = {
  hematologist: 'Assess a de-identified note and marrow report against WHO 2016/2022 criteria for PV, ET, and overt MF (each reported as confirmed, suspicious, or not) with prognostic scoring once a diagnosis is confirmed.',
  pathologist: 'Extract marrow morphology, fibrosis grade, and driver mutations into structured variables, then see which criteria are met, not met, or still unavailable, every value traced to its source.',
  researcher: 'Phenotype PV, ET, and overt MF from unstructured notes: structured extraction, WHO criteria applied independently to each disease, and prognostic models applied only after a diagnosis is confirmed. Reproducible and fully in-browser.',
}

/* ============================================================ Hero */
export function Hero() {
  const { role, setRole } = useApp()
  const roles: Role[] = ['hematologist', 'pathologist', 'researcher']
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="blueprint pointer-events-none absolute inset-0" aria-hidden />
      <div className="bloom pointer-events-none absolute inset-x-0 top-[-10%] h-[520px]" aria-hidden />
      <div className={cx(container, 'relative pt-20 pb-14 sm:pt-28')}>
        <Reveal>
          <div className="flex items-center gap-3">
            <Eyebrow>MPN Phenotyping · WHO 2022</Eyebrow>
            <span className="h-px w-8 bg-line-strong" aria-hidden />
            <Eyebrow tone="faint">Investigational</Eyebrow>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <h1 className="mt-5 max-w-[18ch] font-display text-[44px] font-semibold leading-[1.03] tracking-[-0.022em] sm:text-[62px]">
            Diagnosis and prognosis for PV, ET, and overt myelofibrosis.
          </h1>
        </Reveal>

        {/* role toggle */}
        <Reveal delay={0.1}>
          <div role="group" aria-label="Audience" className="mt-6 grid max-w-[420px] grid-cols-3 overflow-hidden rounded-[8px] border border-line-strong">
            {roles.map((r, i) => (
              <button
                key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r}
                className={cx('px-2 py-2 text-center font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors sm:text-[11.5px] sm:tracking-[0.08em]', i < 2 && 'border-r border-line', role === r ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink')}
              >
                {r}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.14}>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-muted">{ROLE_SUBHEAD[role]}</p>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button onClick={scrollToTool}>Try it with a sample note <ArrowRight aria-hidden size={15} /></Button>
            <Button variant="outline" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>See how it works</Button>
          </div>
        </Reveal>

        <Reveal delay={0.24}>
          <div className="mt-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
            <span className="h-px w-6 bg-line-strong" aria-hidden />
            No key required · Your data · Nothing stored
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ============================================================ Stat band */
export function StatBand() {
  const stats: { figure: string; label: string }[] = [
    { figure: '3', label: 'diseases in scope: PV · ET · overt MF' },
    { figure: '2022', label: 'WHO criteria applied independently to each disease' },
    { figure: '5', label: 'prognostic models, applied only after a diagnosis is confirmed' },
    { figure: '0', label: 'notes stored, everything stays in your browser' },
  ]
  return (
    <section className="border-b border-line">
      <div className={cx(container, 'py-4')}>
        <div className="grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
          {stats.map((s, i) => (
            <Reveal key={i} delay={i * 0.06} className={cx('border-line', i < 2 && 'border-b lg:border-b-0', i % 2 === 0 && 'border-r lg:border-r-0')}>
              <StatTile figure={s.figure} label={s.label} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================ How it works */
export function HowItWorks() {
  const steps: { n: string; title: string; body: string }[] = [
    { n: '01', title: 'De-identify & paste', body: 'Paste a clinical note and/or pathology report. An in-browser scrubber flags likely identifiers (names, MRNs, dates, contact details) and a required attestation gates the call until you confirm the text is de-identified.' },
    { n: '02', title: 'Extract & review', body: 'Groq is the fast, free default: paste a one-time free key (no credit card, no popups). Prefer zero setup? Use Puter (keyless, slower) or a fully on-device model, or bring your own OpenAI, Anthropic, or Gemini key. Your chosen model extracts structured variables, each tagged by source and status; findings that are pending or not documented are left for you to review, never assumed negative.' },
    { n: '03', title: 'Assess & stratify', body: 'The tool resolves source conflicts (structured › pathology › note) and applies WHO 2016/2022 criteria independently to PV, ET, and overt MF, reporting each as confirmed, suspicious, or not. A prognostic model is applied only once a diagnosis is confirmed, and every result is traced to the criterion or study behind it.' },
  ]
  return (
    <section id="how" className="scroll-mt-16 border-b border-line">
      <div className={cx(container, 'py-24 lg:py-32')}>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Reveal><Eyebrow>How it works</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="mt-4 font-display text-[36px] leading-[1.08] tracking-[-0.02em] sm:text-[44px]">Evidence is the interface.</h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-muted">
                Every extracted variable carries its source, and every criterion is shown as met, not met, or unavailable, so a confirmed, suspicious, or not-met verdict can always be checked against the evidence behind it.
              </p>
            </Reveal>
          </div>
          <div className="space-y-6">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <div className="corners relative rounded-[10px] border border-line bg-surface p-6 transition-colors hover:border-line-strong">
                  <Corners />
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-[13px] font-medium text-faint tnum">{s.n}</span>
                    <div>
                      <h3 className="text-[18px] font-semibold">{s.title}</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.body}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================ Risk model showcase */
export function RiskShowcase() {
  const rows: { model: string; disease: string; inputs: string; status: 'success' | 'warn' | 'danger'; tier: string; cite: string }[] = [
    { model: 'Conventional', disease: 'PV', inputs: 'age · thrombosis', status: 'danger', tier: 'High', cite: 'Marchioli 2005' },
    { model: 'IPSET-thrombosis', disease: 'ET', inputs: 'age · thrombosis · JAK2', status: 'success', tier: 'Low', cite: 'Barbui 2012' },
    { model: 'DIPSS+', disease: 'MF', inputs: 'DIPSS · karyotype · plt · transfusion', status: 'warn', tier: 'Int-2', cite: 'Gangat 2011' },
    { model: 'MIPSS70+ v2', disease: 'MF', inputs: 'anemia · blasts · symptoms · cytogenetics · mutations', status: 'danger', tier: 'Very high', cite: 'Tefferi 2018' },
  ]
  return (
    <section id="models" className="scroll-mt-16 border-b border-line">
      <div className={cx(container, 'py-24 lg:py-32')}>
        <Reveal><Eyebrow>Risk models</Eyebrow></Reveal>
        <Reveal delay={0.05}>
          <h2 className="mt-4 max-w-[20ch] font-display text-[36px] leading-[1.08] tracking-[-0.02em] sm:text-[44px]">Prognosis only after the diagnosis is confirmed.</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-muted">
            Prognostic scoring runs only once PV, ET, or overt MF is confirmed, using the validated model that fits that diagnosis. When a required variable is unavailable, the model reports “category not established” rather than assigning a risk tier from missing data.
          </p>
        </Reveal>

        <Reveal delay={0.14}>
          <div className="corners relative mt-9 rounded-[10px] border border-line bg-surface">
            <Corners />
            <div className="overflow-hidden rounded-[10px]">
            <div className="scroll overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line-strong text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
                    <th className="px-5 py-3 font-medium">Model</th>
                    <th className="px-5 py-3 font-medium">Disease</th>
                    <th className="px-5 py-3 font-medium">Inputs</th>
                    <th className="px-5 py-3 font-medium">Example tier</th>
                    <th className="px-5 py-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.model} className="border-b border-line last:border-0">
                      <td className="px-5 py-3.5 font-medium">{r.model}</td>
                      <td className="px-5 py-3.5"><span className="font-mono text-[12px] font-medium text-ink">{r.disease}</span></td>
                      <td className="px-5 py-3.5 text-muted">{r.inputs}</td>
                      <td className="px-5 py-3.5"><CategoricalChip status={r.status}>{r.tier}</CategoricalChip></td>
                      <td className="px-5 py-3.5 font-mono text-[11.5px] text-faint">{r.cite}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ============================================================ Privacy */
export function Privacy() {
  const flow: { icon: React.ReactNode; label: string; sub: string }[] = [
    { icon: <ScanLine size={18} />, label: 'De-identified note', sub: 'scrubbed in your browser' },
    { icon: <KeyRound size={18} />, label: 'AI extraction', sub: 'browser-direct, free key, no popups' },
    { icon: <Trash2 size={18} />, label: 'Discarded', sub: 'nothing persisted or logged' },
  ]
  return (
    <section id="privacy" className="scroll-mt-16 border-b border-line">
      <div className={cx(container, 'py-24 lg:py-32')}>
        <div className="corners relative rounded-[14px] border border-line-strong bg-surface p-8 sm:p-12">
          <Corners />
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <Reveal><Eyebrow>Privacy by architecture</Eyebrow></Reveal>
              <Reveal delay={0.05}>
                <h2 className="mt-4 font-display text-[36px] leading-[1.08] tracking-[-0.02em] sm:text-[44px]">No key required. Your data. Nothing stored.</h2>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-muted">
                  There is no backend. Groq is the fast, free default: a one-time free key (no credit card, no popups). Prefer zero setup? Puter.js is a keyless, free shared cloud service, and WebLLM runs fully on-device. As an advanced option, you can bring your own OpenAI, Anthropic, or Gemini key. Cloud extraction calls go browser-direct from your device to the chosen provider; with WebLLM, the text never leaves your browser. We never see your notes, keys, or results, and de-identification happens locally before any cloud call.
                </p>
              </Reveal>
              <Reveal delay={0.14}>
                <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-faint">
                  General-purpose models are not covered by a HIPAA BAA; use de-identified or synthetic text only. This tool is investigational and not a medical device.
                </p>
              </Reveal>
            </div>

            <Reveal delay={0.1}>
              <div className="rounded-[10px] border border-line bg-surface2 p-5">
                <div className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">Data flow</div>
                <div className="space-y-3">
                  {flow.map((f, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-4 py-3">
                        <span className="text-muted" aria-hidden>{f.icon}</span>
                        <div>
                          <div className="text-[13.5px] font-medium">{f.label}</div>
                          <div className="font-mono text-[11px] text-faint">{f.sub}</div>
                        </div>
                      </div>
                      {i < flow.length - 1 && <div className="ml-[25px] h-4 w-px bg-line-strong" aria-hidden />}
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================ Closing CTA */
export function ClosingCTA() {
  return (
    <section className="border-b border-line">
      <div className={cx(container, 'py-24 text-center lg:py-32')}>
        <Reveal>
          <h2 className="mx-auto max-w-[24ch] font-display text-[36px] leading-[1.08] tracking-[-0.02em] sm:text-[44px]">
            Assess a case against WHO criteria: diagnosis first, prognosis once confirmed.
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-8 flex justify-center">
            <Button onClick={scrollToTool}>Open the tool <ArrowRight aria-hidden size={15} /></Button>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ============================================================ Footer */
export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className={cx(container, 'flex flex-col gap-6 py-12 sm:flex-row sm:items-start sm:justify-between')}>
        <div className="max-w-[42ch]">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-6 shrink-0 place-items-center text-accent">
              <svg aria-hidden viewBox="0 0 24 26" width="18" height="20" fill="none"><path fill="currentColor" d="M12 1.4C12 1.4 4.6 10.6 4.6 17a7.4 7.4 0 0 0 14.8 0C19.4 10.6 12 1.4 12 1.4Z" /><ellipse cx="9.5" cy="17.4" rx="1.7" ry="2.5" fill="#fff" opacity="0.4" /></svg>
            </span>
            <span className="font-display text-[14px] font-bold tracking-[-0.01em]">MPN Phenotyping</span>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
            An investigational decision-support tool for polycythemia vera, essential thrombocythemia, and overt myelofibrosis. Applies published WHO criteria and prognostic models, fully in your browser. Not for clinical use.
          </p>
        </div>
        <div className="font-mono text-[11.5px] leading-relaxed text-faint">
          <div>WHO 2016 / 2022 diagnostic criteria</div>
          <div>IPSET · DIPSS · DIPSS+ · MIPSS70 · MIPSS70+ v2.0</div>
          <div className="mt-3"><a href={REPO} target="_blank" rel="noopener noreferrer" className="text-accent">Source &amp; methods →</a></div>
        </div>
      </div>
    </footer>
  )
}
