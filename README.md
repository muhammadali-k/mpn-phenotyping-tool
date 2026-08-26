# MPN Phenotyping — web app (React)

A **fully client-side** web app that extracts structured variables from de-identified
clinical notes and pathology reports and assesses three myeloproliferative neoplasms —
**polycythemia vera (PV)**, **essential thrombocythemia (ET)**, and **overt myelofibrosis
(overt MF)** — against **WHO 2016/2022** criteria, then applies a prognostic model once a
diagnosis is confirmed. **Groq is the fast, free default** — paste a one-time free key
(from [console.groq.com/keys](https://console.groq.com/keys); no credit card, no popups).
Prefer zero setup? **Puter.js** is a keyless, free shared cloud service (slower). **WebLLM**
runs fully on-device, and you can bring your own **OpenAI / Anthropic / Google** API key.
Cloud calls go browser-direct, on-device extraction keeps text in the browser, and the app
has no backend or data store.

Each disease is assessed **independently** and reported as one of seven outcomes:
Confirmed PV / ET / overt MF; Suspicious for PV / ET / overt MF (diagnosis not confirmed);
or **No confirmed MPN**. A criterion is shown as **met**, **not met**, or **unavailable**
(missing / pending / not performed) — missing data is never treated as a negative. Prefibrotic
MF and other MPN subtypes are out of scope.

Prognostic scoring (Conventional PV risk, revised IPSET-thrombosis + IPSET survival, DIPSS,
DIPSS+, MIPSS70, MIPSS70+ v2.0) runs **only after a diagnosis is confirmed**, uses only the
model applicable to that diagnosis, and reports “category not established” rather than imputing
missing required variables. The diagnosis + prognosis logic adapts the
[mpn-phenotyping-pipeline](https://github.com/muhammadali-k/mpn-phenotyping-pipeline).

Design system: **"Clinical"**, a professional, modern health-tech look: a soft warm-neutral
ground, white cards with hairline borders and gentle shadows, a single blood-red accent
(with a blood-drop mark), and Plus Jakarta Sans display paired with Inter body. Semantic
status (success / warn / danger) stays separate from the accent, and provenance is rendered
as the visible "wiring" of the interface (numbered source chips leading to a source rail).
Light and a designed dark scale are both included.

> **Not a medical device.** Research and decision-support only. Every output must be
> confirmed by a qualified hematologist. Use **de-identified** or synthetic text only —
> general-purpose models are not covered by a HIPAA BAA.

## Stack

- **Vite + React 19 + TypeScript** (static SPA, no server)
- **Tailwind CSS v4** (CSS-first `@theme`, light + engineered dark scale)
- **Framer Motion** (restrained entrances), **lucide-react** (icons), **Radix UI** (accessible dialog)
- All clinical logic in `src/lib/engine.ts`; de-identification in `src/lib/deid.ts`

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build → dist/
npm run preview  # serve the production build locally
npm test         # run the clinical-engine test suite (zero-dependency, via jiti)
```

## Project layout

```
src/
  lib/
    engine.ts         # schema, WHO diagnosis, prognosis, LLM clients (OpenAI/Anthropic/Gemini)
    deid.ts           # in-browser PHI scrubber / redaction preview
    store.tsx         # app state (theme, provider config, session keys, role)
    theme.ts, util.ts
  components/
    ui/               # design-system primitives (Card, SourceChip, Button, Modal, Reveal, …)
    landing/          # Nav + landing sections (Hero, StatBand, HowItWorks, RiskShowcase, Privacy, …)
    tool/             # the interactive 3-step tool (Tool, fields, DeidPanel, Results, ProviderKeyModal)
  App.tsx
```

## Deploy a shareable link (GitHub Pages, automatic)

This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that **builds
and publishes to GitHub Pages on every push** — you never run a build yourself.

1. Put this `mpn-react/` folder into your repository (the workflow expects it at
   `mpn-react/`; if you place the app at the repo root, delete the two
   `working-directory: mpn-react` lines and set the artifact `path:` to `dist`).
2. Push to `main` (or `master`).
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The workflow runs and your shareable link appears at
   `https://<user>.github.io/<repo>/` within a minute or two.

The Vite `base` is set to `./` (relative), so the built site works under any Pages
subpath without reconfiguration. A `.nojekyll` file is emitted into `dist/` so every
asset is served unmodified.

### Deploy elsewhere

Any static host works identically — Netlify / Cloudflare Pages (build command
`npm run build`, output `dist`), an institutional web server, or a bucket. Because all
model calls are browser-direct, there are no server-side secrets.

## Privacy model

- **No backend.** The app is static files; cloud extraction calls go browser-direct from
  the user's device to the chosen provider, with nothing proxied through or stored by this app.
- **Fast, free default.** Groq performs the extraction with a one-time free key (from
  `console.groq.com/keys`, no credit card), browser-direct and with no runtime popups.
- **Zero-setup keyless option.** Puter.js provides a free, shared cloud AI service without
  requiring the user to supply an API key (slower).
- **Fully on-device option.** WebLLM runs extraction locally, so note and report text does
  not leave the browser.
- **Advanced bring-your-own-key option.** OpenAI, Anthropic, and Google Gemini remain
  available for users who prefer to supply their own provider credentials.
- **Client-side de-identification.** A PHI scrubber flags likely identifiers and can redact
  them before anything is sent; a required attestation gates every call.
- **Your keys stay local.** Bring-your-own API keys live in tab memory, or `sessionStorage`
  (cleared on tab close) if the user opts in. Nothing is proxied, logged, or persisted.

## License

MIT (inherits from the parent pipeline project). Investigational research tool; not a
medical device.
