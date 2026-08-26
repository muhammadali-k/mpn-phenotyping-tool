import { Moon, Sun } from 'lucide-react'
import { scrollToTool, useApp } from '@/lib/store'
import { cx } from '@/lib/util'

const REPO = 'https://github.com/muhammadali-k/mpn-phenotyping-pipeline'

function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.4 6.8-5.2 6.8-9.7C22 6.6 17.5 2 12 2z" />
    </svg>
  )
}

export function Nav() {
  const { theme, toggleTheme } = useApp()
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--c-bg)_82%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-4 px-6">
        <a href="#top" className="flex min-w-0 shrink items-center gap-2">
          <span className="grid h-8 w-7 shrink-0 place-items-center text-accent">
            <svg aria-hidden viewBox="0 0 24 26" width="20" height="22" fill="none"><path fill="currentColor" d="M12 1.4C12 1.4 4.6 10.6 4.6 17a7.4 7.4 0 0 0 14.8 0C19.4 10.6 12 1.4 12 1.4Z" /><ellipse cx="9.5" cy="17.4" rx="1.7" ry="2.5" fill="#fff" opacity="0.4" /></svg>
          </span>
          <span className="hidden truncate font-display text-[15px] font-bold tracking-[-0.01em] min-[380px]:inline">MPN Phenotyping</span>
        </a>

        <div className="flex-1" />

        <nav className="hidden items-center gap-6 md:flex">
          <a href="#how" className="text-[13.5px] text-muted transition-colors hover:text-ink">How it works</a>
          <a href="#models" className="text-[13.5px] text-muted transition-colors hover:text-ink">Risk models</a>
          <a href="#privacy" className="text-[13.5px] text-muted transition-colors hover:text-ink">Privacy</a>
        </nav>

        <div className="mx-1 hidden h-5 w-px bg-line md:block" />

        <button
          type="button" onClick={toggleTheme} aria-label="Toggle light / dark theme"
          className="grid h-9 w-9 place-items-center rounded-[8px] border border-line text-muted transition-colors hover:border-accent hover:text-ink"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <a
          href={REPO} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository"
          className="grid h-9 w-9 place-items-center rounded-[8px] border border-line text-muted transition-colors hover:border-accent hover:text-ink"
        >
          <GithubMark size={16} />
        </a>
        <button
          type="button" onClick={scrollToTool}
          className={cx('ml-1 hidden rounded-[9px] bg-accent px-3.5 py-2 text-[13.5px] font-semibold text-on-accent shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover sm:block')}
        >
          Open the tool →
        </button>
      </div>
    </header>
  )
}
