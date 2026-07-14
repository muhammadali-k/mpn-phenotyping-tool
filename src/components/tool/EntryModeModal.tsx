import { useEffect, useState } from 'react'
import { Keyboard, Sparkles } from 'lucide-react'
import {
  PROVIDERS,
  providerIsKeyless,
  providerIsOnDevice,
  type ProviderKey,
} from '@/lib/engine'
import { Modal } from '@/components/ui/Modal'
import { Button, Eyebrow } from '@/components/ui/primitives'
import { cx } from '@/lib/util'

export type EntryMode = 'llm' | 'manual'

export interface EntryModeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: ProviderKey
  model: string
  hasKey: boolean
  onChoose: (mode: EntryMode) => void
  onOpenProviderSettings: () => void
  onUsePuter: () => void
}

export function EntryModeModal({
  open,
  onOpenChange,
  provider,
  model,
  hasKey,
  onChoose,
  onOpenProviderSettings,
  onUsePuter,
}: EntryModeModalProps) {
  const [mode, setMode] = useState<EntryMode>('llm')
  const [acknowledged, setAcknowledged] = useState(false)
  const onDevice = providerIsOnDevice(provider)
  const keyless = providerIsKeyless(provider)
  const providerInfo = PROVIDERS[provider]
  const providerName = providerInfo.label.split(' — ')[0].split(' (')[0]
  const needsKey = mode === 'llm' && !keyless && !hasKey
  const needsAcknowledgment = mode === 'llm' && !onDevice
  const canContinue = !needsAcknowledgment || acknowledged

  useEffect(() => {
    if (!open) return
    setMode('llm')
    setAcknowledged(false)
  }, [open])

  const choose = () => {
    if (!canContinue) return
    onChoose(mode)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose how to enter data"
      description="Start with AI-assisted extraction from de-identified text, or go directly to the structured form."
      footer={
        <Button onClick={choose} disabled={!canContinue}>
          Continue
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Data entry mode">
        <button
          type="button"
          aria-pressed={mode === 'llm'}
          onClick={() => setMode('llm')}
          className={cx(
            'rounded-[10px] border p-4 text-left transition-colors',
            mode === 'llm'
              ? 'border-accent bg-accent-soft'
              : 'border-line-strong bg-surface2 hover:border-accent',
          )}
        >
          <Sparkles aria-hidden size={18} className={mode === 'llm' ? 'text-accent' : 'text-muted'} />
          <span className="mt-3 block text-[14px] font-semibold text-ink">Extract with AI</span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
            Paste a note or report, then review the extracted variables.
          </span>
        </button>

        <button
          type="button"
          aria-pressed={mode === 'manual'}
          onClick={() => setMode('manual')}
          className={cx(
            'rounded-[10px] border p-4 text-left transition-colors',
            mode === 'manual'
              ? 'border-accent bg-accent-soft'
              : 'border-line-strong bg-surface2 hover:border-accent',
          )}
        >
          <Keyboard aria-hidden size={18} className={mode === 'manual' ? 'text-accent' : 'text-muted'} />
          <span className="mt-3 block text-[14px] font-semibold text-ink">Enter data manually.</span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
            Skip AI extraction and complete the structured form yourself.
          </span>
        </button>
      </div>

      {mode === 'llm' && onDevice && (
        <div className="mt-4 rounded-[8px] border border-line bg-surface2 px-4 py-3 text-[13px] text-muted">
          <strong className="text-ink">Runs entirely on your device</strong> — nothing is sent to any server.
        </div>
      )}

      {needsKey && (
        <div className="mt-4 rounded-[8px] border border-line bg-surface2 px-4 py-3 text-[13px] text-muted">
          <strong className="text-ink">{providerName}</strong> is free and fast but needs a one-time free key (no credit card).
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {providerInfo.getKeyUrl && (
              <a
                href={providerInfo.getKeyUrl} target="_blank" rel="noopener noreferrer"
                className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
              >
                Get a free key ↗
              </a>
            )}
            <button
              type="button"
              onClick={onOpenProviderSettings}
              className="font-medium text-accent underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
            >
              Add key
            </button>
            <button
              type="button"
              onClick={onUsePuter}
              className="underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              or use Puter — no setup (slower)
            </button>
          </div>
        </div>
      )}

      {needsAcknowledgment && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] border border-line-strong bg-surface px-4 py-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-accent"
          />
          <span className="text-[13px] leading-relaxed text-muted">
            <strong className="text-ink">I understand this text will be shared with a third-party AI service.</strong>{' '}
            The note and report I enter are sent over the internet to an external AI provider to perform the extraction. This service is outside our control, is{' '}
            <strong className="text-ink">not firewall-protected</strong>, and is{' '}
            <strong className="text-ink">not covered by a HIPAA Business Associate Agreement</strong>. I will use{' '}
            <strong className="text-ink">de-identified or synthetic text only</strong> and confirm I am authorized to process it this way.
          </span>
        </label>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="faint">Current model</Eyebrow>
          <div className="mt-1 break-words text-[12.5px] text-muted">
            <span className="font-medium text-ink">{providerInfo.label}</span>
            {' · '}{model || providerInfo.defaultModel}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenProviderSettings}
          className="text-left text-[12.5px] font-medium text-accent underline-offset-4 transition-colors hover:text-accent-hover hover:underline"
        >
          Advanced: choose model / use your own key
        </button>
      </div>
    </Modal>
  )
}
