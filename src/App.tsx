import { AppProvider } from '@/lib/store'
import { Nav } from '@/components/landing/Nav'
import { ClosingCTA, Footer, Hero, HowItWorks, Privacy, RiskShowcase, StatBand } from '@/components/landing/sections'
import { Tool } from '@/components/tool/Tool'
import { ProviderKeyModal } from '@/components/tool/ProviderKeyModal'
import { Eyebrow } from '@/components/ui/primitives'
import { Reveal } from '@/components/ui/Reveal'

function ToolSection() {
  return (
    <section id="tool" className="relative scroll-mt-16 border-b border-line">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative mx-auto max-w-[1120px] px-6 py-20 lg:py-28">
        <Reveal>
          <div className="mb-2 flex items-center gap-3">
            <Eyebrow>The tool</Eyebrow>
            <span className="h-px w-8 bg-line-strong" aria-hidden />
            <Eyebrow tone="faint">De-identified / synthetic text only</Eyebrow>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="mb-8 max-w-[26ch] font-display text-[36px] leading-[1.08] tracking-[-0.02em] sm:text-[44px]">
            Paste a note. Review the variables. Get a WHO assessment.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <Tool />
        </Reveal>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <AppProvider>
      <div id="top">
        <Nav />
        <main>
          <Hero />
          <ToolSection />
          <StatBand />
          <HowItWorks />
          <RiskShowcase />
          <Privacy />
          <ClosingCTA />
        </main>
        <Footer />
      </div>
      <ProviderKeyModal />
    </AppProvider>
  )
}
