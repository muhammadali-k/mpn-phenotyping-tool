import { useEffect, useRef, useState, type ReactNode } from 'react'

/* Quiet one-time rise+fade on scroll into view. Scroll/resize + rAF viewport
   check (reliable under React StrictMode and headless automation, unlike a bare
   IntersectionObserver). The global prefers-reduced-motion rule snaps it to the
   end-state. Motion explains layout, never entertains. */
export function Reveal({ children, delay = 0, y = 14, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // reduced-motion users get content immediately — no hidden-until-scroll flash
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(true); return }
    let done = false
    let ticking = false
    const reveal = () => {
      done = true
      setShown(true)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    const check = () => {
      if (done) return
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight - 40 && r.bottom > 0) reveal()
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => { ticking = false; check() })
    }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // safety net: never leave content hidden if scroll/rAF is throttled or absent
    const fallback = window.setTimeout(() => { if (!done) reveal() }, 1600)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.clearTimeout(fallback)
    }
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${y}px)`,
        transition: `opacity .5s var(--ease-out) ${delay}s, transform .5s var(--ease-out) ${delay}s`,
        willChange: shown ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </div>
  )
}
