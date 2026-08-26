import { useMemo, useState } from 'react'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { preview, redact, scan } from '@/lib/deid'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/primitives'
import { cx } from '@/lib/util'

export function DeidPanel({
  note, path, onApplyRedaction,
}: {
  note: string
  path: string
  onApplyRedaction: (note: string, path: string) => void
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const text = (note + '\n' + path).trim()
  const result = useMemo(() => scan(text), [text])
  const dirty = result.total > 0

  return (
    <div className={cx('mt-4 rounded-[8px] border bg-surface2 px-4 py-3.5', dirty ? 'border-[color-mix(in_srgb,var(--c-warn)_40%,var(--c-line))]' : 'border-line')}>
      <div className="flex items-center gap-2.5" role="status" aria-live="polite">
        {dirty
          ? <ShieldAlert aria-hidden size={19} className="shrink-0 text-warn" />
          : <ShieldCheck aria-hidden size={19} className="shrink-0 text-success" />}
        <strong className="text-[13.5px]">
          {!text ? 'No identifiers detected' : dirty ? `${result.total} possible identifier${result.total === 1 ? '' : 's'} found` : 'No obvious identifiers detected'}
        </strong>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setPreviewOpen(true)}>Preview redaction</Button>
      </div>

      {dirty && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {result.findings.map((f) => (
            <span key={f.label} className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--c-danger)_12%,transparent)] px-2.5 py-1 text-[11.5px] font-medium text-danger">
              {f.label}<span className="font-mono opacity-75 tnum">×{f.count}</span>
            </span>
          ))}
        </div>
      )}

      <p className="mt-2.5 text-[11.5px] text-faint">
        Scanning runs entirely in your browser. Pattern matching is assistive only and can miss identifiers, notably a <strong>plain name with no title or label</strong>. You remain responsible for de-identification.
      </p>

      <Modal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        wide
        title="Redaction preview"
        description={<>Highlighted spans are what the in-browser scrubber would redact, replacing them with placeholders like <code className="font-mono">[NAME]</code>, <code className="font-mono">[DATE]</code>, <code className="font-mono">[ID]</code>. Review carefully; this is a safety net, not a guarantee.</>}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button size="sm" onClick={() => { onApplyRedaction(redact(note).text, redact(path).text); setPreviewOpen(false) }}>
              Apply redaction to my text
            </Button>
          </>
        }
      >
        {note.trim() && (
          <>
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-faint">Clinical note</div>
            <div className="scroll max-h-[280px] overflow-auto rounded-[8px] border border-line bg-surface2 px-4 py-3 text-[13px] leading-[1.7]" dangerouslySetInnerHTML={{ __html: preview(note) }} />
          </>
        )}
        {path.trim() && (
          <>
            <div className="mb-1.5 mt-3.5 font-mono text-[11px] uppercase tracking-[0.06em] text-faint">Pathology report</div>
            <div className="scroll max-h-[280px] overflow-auto rounded-[8px] border border-line bg-surface2 px-4 py-3 text-[13px] leading-[1.7]" dangerouslySetInnerHTML={{ __html: preview(path) }} />
          </>
        )}
      </Modal>
    </div>
  )
}
