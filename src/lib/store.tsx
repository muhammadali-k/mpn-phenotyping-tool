import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { PROVIDER_ORDER, PROVIDERS, type LLMConfig, type ProviderKey } from './engine'
import { useTheme, type Theme } from './theme'

export type Role = 'hematologist' | 'pathologist' | 'researcher'
export interface StoredKey { key: string; model: string }

interface AppState {
  theme: Theme
  toggleTheme: () => void
  config: LLMConfig
  setConfig: (c: LLMConfig) => void
  sessionKeys: Record<string, StoredKey>
  saveKey: (provider: ProviderKey, key: string, model: string, remember: boolean) => void
  removeKey: (provider: ProviderKey) => void
  keyModalOpen: boolean
  setKeyModalOpen: (o: boolean) => void
  role: Role
  setRole: (r: Role) => void
}

const Ctx = createContext<AppState | null>(null)

function loadKeys(): Record<string, StoredKey> {
  try {
    const raw = sessionStorage.getItem('mpn-keys')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme()
  const [sessionKeys, setSessionKeys] = useState<Record<string, StoredKey>>(loadKeys)
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [role, setRole] = useState<Role>('hematologist')

  const [config, setConfig] = useState<LLMConfig>(() => {
    const initial = loadKeys()
    const withKey = PROVIDER_ORDER.find((p) => initial[p]?.key)
    if (withKey) return { provider: withKey, key: initial[withKey].key, model: initial[withKey].model || PROVIDERS[withKey].defaultModel }
    return { provider: 'groq', key: '', model: PROVIDERS.groq.defaultModel }
  })

  const saveKey = useCallback((provider: ProviderKey, key: string, model: string, remember: boolean) => {
    const m = model || PROVIDERS[provider].defaultModel
    setConfig({ provider, key, model: m })
    setSessionKeys((prev) => {
      const next = { ...prev }
      if (remember && key) next[provider] = { key, model: m }
      else delete next[provider]
      try { sessionStorage.setItem('mpn-keys', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const removeKey = useCallback((provider: ProviderKey) => {
    setSessionKeys((prev) => {
      const next = { ...prev }
      delete next[provider]
      try { sessionStorage.setItem('mpn-keys', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    setConfig((c) => (c.provider === provider ? { ...c, key: '' } : c))
  }, [])

  const value = useMemo<AppState>(() => ({
    theme, toggleTheme: toggle, config, setConfig, sessionKeys, saveKey, removeKey, keyModalOpen, setKeyModalOpen, role, setRole,
  }), [theme, toggle, config, sessionKeys, saveKey, removeKey, keyModalOpen, role])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export function scrollToTool() {
  document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
