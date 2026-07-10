/*
 * Minimal zero-dependency test harness.
 * Run with:  npm test   (which invokes `jiti tests/engine.test.ts`)
 * No vitest/jest needed — the clinical engine is pure and framework-free.
 */

let passed = 0
let failed = 0
const failures: string[] = []
let currentSuite = ''

export function suite(name: string, fn: () => void) {
  currentSuite = name
  // eslint-disable-next-line no-console
  console.log('\n\x1b[1m' + name + '\x1b[0m')
  fn()
  currentSuite = ''
}

export function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    // eslint-disable-next-line no-console
    console.log('  \x1b[32m✓\x1b[0m ' + name)
  } catch (e) {
    failed++
    const msg = e instanceof Error ? e.message : String(e)
    failures.push((currentSuite ? currentSuite + ' › ' : '') + name + '\n      ' + msg.replace(/\n/g, '\n      '))
    // eslint-disable-next-line no-console
    console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + msg.replace(/\n/g, '\n      '))
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function assert(cond: unknown, message: string) {
  if (!cond) throw new Error('assertion failed: ' + message)
}

export function eq<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error((message ? message + '\n      ' : '') + 'expected ' + fmt(expected) + '  but got  ' + fmt(actual))
  }
}

export function includes(arr: readonly string[] | undefined, needle: string, message?: string) {
  if (!arr || !arr.includes(needle)) {
    throw new Error((message ? message + '\n      ' : '') + 'expected [' + (arr || []).join(', ') + '] to include "' + needle + '"')
  }
}

export function excludes(arr: readonly string[] | undefined, needle: string, message?: string) {
  if (arr && arr.includes(needle)) {
    throw new Error((message ? message + '\n      ' : '') + 'expected [' + arr.join(', ') + '] NOT to include "' + needle + '"')
  }
}

export function report(): never {
  // eslint-disable-next-line no-console
  console.log('\n' + '─'.repeat(52))
  if (failed === 0) {
    // eslint-disable-next-line no-console
    console.log('\x1b[32m\x1b[1m' + passed + ' passed, 0 failed\x1b[0m')
    process.exit(0)
  }
  // eslint-disable-next-line no-console
  console.log('\x1b[31m\x1b[1m' + failed + ' failed\x1b[0m, ' + passed + ' passed\n')
  failures.forEach((f, i) => {
    // eslint-disable-next-line no-console
    console.log('\x1b[31m' + (i + 1) + ') ' + f + '\x1b[0m')
  })
  process.exit(1)
}
