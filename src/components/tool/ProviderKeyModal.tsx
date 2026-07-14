import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { PROVIDER_ORDER, PROVIDERS, providerIsKeyless, type ProviderKey } from '@/lib/engine'
import { useApp } from '@/lib/store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/primitives'
import { cx } from '@/lib/util'

interface Draft { key: string; model: string; remember: boolean }

export function ProviderKeyModal() {
  const { keyModalOpen, setKeyModalOpen, config, sessionKeys, saveKey, removeKey } = useApp()
  const [pending, setPending] = useState<ProviderKey>(config.provider)
  const [drafts, setDrafts] = useState<Partial<Record<ProviderKey, Draft>>>({})

  // seed drafts when opening
  useEffect(() => {
    if (!keyModalOpen) return
    setPending(config.provider || 'openai')
    setDrafts({})
  }, [keyModalOpen, config.provider])

  const draftFor = (p: ProviderKey): Draft => {
    if (drafts[p]) return drafts[p]!
    const sess = sessionKeys[p]
    const live = config.provider === p ? config : null
    return {
      key: sess?.key ?? live?.key ?? '',
      model: sess?.model ?? live?.model ?? '',
      remember: !!sess,
    }
  }

  const cur = draftFor(pending)
  const provider = PROVIDERS[pending]
  const keyless = providerIsKeyless(pending)

  const patch = (p: Partial<Draft>) => setDrafts((d) => ({ ...d, [pending]: { ...draftFor(pending), ...p } }))

  const hasKeyFor = (p: ProviderKey) => !!(drafts[p]?.key ?? sessionKeys[p]?.key ?? (config.provider === p ? config.key : ''))

  return (
    <Modal
      open={keyModalOpen}
      onOpenChange={setKeyModalOpen}
      title="Model provider & API key"
      description="Choose a provider and model. No-key options work immediately; you can also use your own OpenAI, Anthropic, or Gemini key."
      footer={
        <>
          {!keyless && (
            <Button variant="ghost" size="sm" onClick={() => { removeKey(pending); patch({ key: '', remember: false }) }}>
              Remove key
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              saveKey(
                pending,
                keyless ? '' : cur.key.trim(),
                cur.model.trim() || provider.defaultModel,
                keyless ? false : cur.remember,
              )
              setKeyModalOpen(false)
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDER_ORDER.map((p) => {
          const on = p === pending
          const optionKeyless = providerIsKeyless(p)
          return (
            <button
              key={p} type="button" aria-pressed={on}
              onClick={() => setPending(p)}
              className={cx(
                'rounded-[8px] border p-3 text-center transition-colors',
                on ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface2 hover:border-accent',
              )}
            >
              <div className="text-[13.5px] font-medium">{PROVIDERS[p].label}</div>
              <div className={cx('mt-1 font-mono text-[10.5px]', optionKeyless || hasKeyFor(p) ? 'text-success' : 'text-faint')}>
                {optionKeyless ? (PROVIDERS[p].onDevice ? 'on device' : 'no key needed') : hasKeyFor(p) ? 'key set' : 'no key'}
              </div>
            </button>
          )
        })}
      </div>

      {keyless ? (
        <div className="mb-4 rounded-[8px] border border-line bg-surface2 px-4 py-3 text-[13px] text-muted">
          {pending === 'puter'
            ? 'No API key required — free, shared cloud service.'
            : 'Runs on your device — no key, no data leaves the browser.'}
        </div>
      ) : (
        <label className="mb-4 block">
          <span className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[12.5px] font-medium text-muted">API key</span>
            <span className="font-mono text-[10.5px] text-faint">{provider.keyHelp}</span>
          </span>
          <input
            type="password" autoComplete="off" spellCheck={false}
            placeholder={provider.keyPlaceholder}
            value={cur.key}
            onChange={(e) => patch({ key: e.target.value })}
            className="h-10 w-full rounded-[6px] border border-line-strong bg-surface2 px-3 font-mono text-[13px] outline-none transition-colors focus:border-focus focus:bg-surface"
          />
        </label>
      )}

      <label className="mb-4 block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-muted">Model</span>
        <input
          list="model-list" placeholder={provider.defaultModel}
          value={cur.model}
          onChange={(e) => patch({ model: e.target.value })}
          className="h-10 w-full rounded-[6px] border border-line-strong bg-surface2 px-3 font-mono text-[13px] outline-none transition-colors focus:border-focus focus:bg-surface"
        />
        <datalist id="model-list">
          {provider.models.map((m) => <option key={m} value={m} />)}
        </datalist>
      </label>

      {!keyless && (
        <label className="flex cursor-pointer items-start gap-3 rounded-[8px] border border-line-strong bg-surface px-4 py-3">
          <input
            type="checkbox" checked={cur.remember}
            onChange={(e) => patch({ remember: e.target.checked })}
            className="mt-0.5 h-[18px] w-[18px] accent-accent"
          />
          <span className="text-[13px] text-muted">
            Remember this key for the browser session (kept in this tab&apos;s <strong className="text-ink">sessionStorage</strong>, cleared when the tab closes). Leave unchecked to keep it in memory only.
          </span>
        </label>
      )}

      <div className="mt-4 flex gap-3 rounded-[8px] bg-[color-mix(in_srgb,var(--c-warn)_10%,transparent)] px-4 py-3 text-[13px] text-warn">
        <TriangleAlert size={17} className="mt-0.5 shrink-0" />
        <span>
          {pending === 'puter' && (
            <>Your text is sent <strong>browser-direct</strong> to a third-party free AI service. Use de-identified or synthetic text only.</>
          )}
          {pending === 'webllm' && (
            <>The model runs <strong>on-device</strong>. Your text and model request stay in this browser.</>
          )}
          {!keyless && (
            <>Keys are used <strong>browser-direct</strong> to the provider — never sent to any server of ours. Prefer a scoped, limited key; never paste a shared production key on a shared computer.</>
          )}
        </span>
      </div>
    </Modal>
  )
}
