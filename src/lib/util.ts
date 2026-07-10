import clsx, { type ClassValue } from 'clsx'

export const cx = (...args: ClassValue[]) => clsx(args)

// per-metric decimal precision so numeric columns align
const DECIMALS: Record<string, number> = {
  hemoglobin: 1, hematocrit: 0, wbc: 1, platelets: 0, ldh: 0, ldh_uln: 0,
  peripheral_blasts: 0, age: 0, spleen_cm: 1,
}

export function fmtNum(key: string, v: number): string {
  const d = DECIMALS[key] ?? 1
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function fmtValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ')
  if (v === true) return 'yes'
  if (v === false) return 'no'
  return String(v).replace(/_/g, ' ')
}

export const RISK_TIERS = ['vlow', 'low', 'int1', 'int', 'int2', 'high', 'vhigh'] as const
