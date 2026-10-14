# Bara La Afrika

**Bara La Afrika** (Swahili for "the continent of Africa") is a long-running project for uncovering, learning about and understanding Africa from historical and contemporary perspectives. Version 1 is a responsive web app with four sections:

| Section | Route | What it shows |
|---|---|---|
| Home | `/` | Interactive Equal Earth map of Africa, countries coloured by region |
| Countries | `/countries` | All 54 states: the meaning of their names, flags, national symbols and national animals (from the project's research document) |
| **Harim** | `/harim` | Africa's mountains and their heights, per country |
| **Dhahabu** | `/dhahabu` | Gold in Africa: deposits, mining, trade and central bank reserves |

History and Contemporary Africa appear in the navigation as "Coming soon".

> **Status:** milestone 1 of 17 (scaffold) is complete: tooling, design system, app shell, CI. Data, API, maps and tables arrive in later milestones (see [Roadmap](#roadmap)).

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started (local development)](#getting-started-local-development)
- [Quality checks](#quality-checks)
- [Environment variables](#environment-variables)
- [Deployment (Netlify)](#deployment-netlify)
- [Design system](#design-system)
- [Decisions and deviations](#decisions-and-deviations)
- [Roadmap](#roadmap)
- [Credits and licences](#credits-and-licences)

---

## Architecture

```
Browser (React + Vite SPA)
   │  /api/*  (JSON, zod-validated, CDN-cached)
   ▼
Netlify Functions (Node, TypeScript) ── read-only role ──▶ Neon Postgres
                                                             ▲
Python pipelines (uv, GitHub Actions cron) ── write role ────┘
```

- **Frontend:** React 19, Vite 8, React Router 8 (data router, code-split routes), TypeScript (strict). Plain CSS with design tokens and CSS Modules; no Tailwind or CSS-in-JS.
- **API:** Netlify Functions in TypeScript. Input is validated with `zod`; every error uses the shape `{ error: { code, message } }`. Responses send `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` plus an `ETag`.
- **Database:** Postgres on Neon. Plain numbered SQL migrations. Statistics are defined in SQL views, not in the browser.
- **Pipelines:** Python 3.15, managed with `uv`. Every pipeline is idempotent, logs its runs and records dataset coverage.
- **Shared code:** `packages/shared` holds the API types, schemas and constants used by both the web app and the functions. Unit constants (e.g. troy ounces per tonne) are defined once in `config/constants.json` and read from TypeScript, Python and SQL.

## Repository layout

```
apps/web/                 React + Vite app
  index.html              Real HTML entry, incl. the no-flash theme bootstrap
  build/                  Vite plugin that generates the CSP (_headers)
  public/                 favicon, robots.txt (later: topojson, flag fallbacks)
  src/
    app/                  router, layout shell, theme provider, error boundaries
    features/             map, countries, harim, dhahabu, coverage (data ribbon)
    components/           Icon, IconButton, GlassCard, PageHeader, Tooltip, ThemeToggle…
    styles/               tokens.css, glass.css, base.css, media.css, fonts.css
    lib/                  strings (i18n dictionary), storage, theme, breakpoints
packages/shared/          types, zod schemas and constants shared by web + functions
netlify/functions/        API functions (_shared/ holds HTTP and DB helpers)
netlify/tests/            function tests (kept outside functions/ so they never deploy)
db/migrations/            numbered .sql migrations
db/seeds/                 generated, reviewable JSON seeds (committed)
pipelines/                Python package: `python -m pipelines <command>`
scripts/                  build helpers (Material Symbols subsetting)
config/constants.json     single source of truth for unit constants
e2e/                      Playwright suites (desktop 1440×900, mobile 390×844)
data/source/              the research PDF (raw downloads go to data/raw/, gitignored)
```

## Prerequisites

| Tool | Version | Install (macOS) |
|---|---|---|
| Node.js | 24 (see `.nvmrc`; ≥ 24.0) | `brew install node@24` or nvm |
| Python | 3.15 (see `.python-version`) | `brew install python@3.15` |
| uv | current | `brew install uv` |
| cairo | current (native lib for flag rasterisation) | `brew install cairo` |

On Linux, install `libcairo2` instead of `cairo`.

## Getting started (local development)

```bash
npm install                     # all JS workspaces
uv sync                         # Python venv for pipelines
npx playwright install chromium # browser for end-to-end tests (one-time)

npm run dev                     # Vite dev server on http://localhost:5173
```

Once the API exists (milestone 4), use `npm run dev:netlify` (Netlify CLI on http://localhost:8888) to run the site and the functions together. Before then, `npm run dev` is enough.

The pipelines run from the repo root:

```bash
uv run python -m pipelines --help
```

The full first-run data sequence (`migrate → extract-pdf → flags → boundaries → load`) is documented here as each step lands.

## Quality checks

| Command | What it runs |
|---|---|
| `npm run check` | ESLint + Stylelint, `tsc -b`, Vitest, production build |
| `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` | individually |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run e2e` | Playwright: desktop (1440×900) and mobile (390×844) projects; includes axe accessibility checks in light and dark mode and no-horizontal-scroll checks at 320px |
| `npm run screenshots` | Captures every page at desktop and mobile, light and dark, into `screenshots/` (gitignored) for visual review |
| `uv run ruff check . && uv run ruff format --check .` | Python lint and format |
| `uv run mypy` | Python type-check (strict) |
| `uv run pytest` | Python tests |

CI (`.github/workflows/ci.yml`) runs all of these on every push to `main` and on pull requests.

## Environment variables

Copy `.env.example` to `.env` for local work. **Each variable belongs in exactly one place:**

| Variable | Where it lives | Used by |
|---|---|---|
| `DATABASE_URL_READ` | Netlify site environment variables | Netlify Functions (read-only DB role) |
| `DATABASE_URL_WRITE` | local `.env`, GitHub Actions secret | Python pipelines only |
| `COMTRADE_API_KEY` | local `.env`, GitHub Actions secret | `gold-trade` pipeline only |
| `ENABLE_WGC_IMPORT` | local `.env` (default `false`) | optional manual WGC import |
| `NETLIFY_BUILD_HOOK` | GitHub Actions secret (optional) | data-refresh workflow |

Functions never hold write credentials, and no secret is ever exposed to the client bundle.

## Deployment (Netlify)

`netlify.toml` configures:

- the build: `npm run build`, publishing `apps/web/dist`
- functions from `netlify/functions`
- the `/api/*` → `/.netlify/functions/:splat` redirect and the SPA fallback
- security headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP
- cache headers: one-year immutable for hashed assets, revalidate for HTML

The **Content-Security-Policy** is generated at build time into `dist/_headers` by `apps/web/build/securityHeaders.ts`. It allows exactly the inline theme-bootstrap script, by SHA-256 hash, and blocks every other inline script. A unit test keeps the hash in sync with `index.html`.

Full deployment steps (Neon setup, Netlify site creation, env vars, preview branches) are added at the deployment milestone.

## Design system

- **Tokens:** `apps/web/src/styles/tokens.css` defines typography, spacing, radii, motion, layers and colours (OKLCH). The light set is on `:root` and the dark set on `[data-theme='dark']`.
- **Liquid glass:** the `.glass` / `.glass--strong` classes in `glass.css` combine a translucent tint, backdrop blur and saturation, a 1px specular gradient edge, an inner highlight and a depth shadow, layered over an ambient colour mesh. Fallbacks:
  - a near-opaque surface when `backdrop-filter` is unsupported or `prefers-reduced-transparency` is set
  - a solid surface with a solid border for `prefers-contrast: more`
- **Typography:** self-hosted **Fraunces** (display, with an optical-size axis) and **Instrument Sans** (text), Latin subsets. Numbers use tabular figures.
- **Breakpoints:** 480 / 720 / 1024 / 1280 / 1440 px, defined once as `@custom-media` in `media.css` (compiled by PostCSS) and mirrored in `lib/breakpoints.ts`. A test keeps them in sync.
- **Icons:** Google Material Symbols (Outlined) via `<Icon name="…" />`, which is `aria-hidden` by default. Icon-only buttons use `<IconButton label="…" />`. The font is **subset to the icons in `components/Icon/iconNames.ts`** (≈20 KiB instead of 4 MB) by `uv run python -m scripts.build_icon_font`. The script fails if a name is not in the current canonical Material Symbols set. Re-run it after editing the list; a test fails if the subset is stale.
- **Theme:** follows `prefers-color-scheme` until the user toggles it. The choice persists in `localStorage` (failures are tolerated) and is applied before first paint by the inline script in `index.html`, so there is no flash.
- **Strings:** all UI copy lives in `src/lib/strings.ts`, ready for translation.

## Decisions and deviations

Decisions taken where the specification left room, or where the current ecosystem required it:

- **TypeScript 6.0, not 7.x:** typescript-eslint (needed for type-aware linting) supports TypeScript < 6.1 only.
- **ESLint 10 with eslint-plugin-jsx-a11y:** the plugin's declared peer range stops at ESLint 9, which is no longer supported upstream. It was verified to work under ESLint 10, and a scoped `overrides` entry in `package.json` records this.
- **jsdom 29:** jsdom 30 requires Node ≥ 24.15.
- **npm workspaces**, since pnpm is not assumed.
- **`packages/shared`** is a small addition to the specified layout, so the web app and functions share one set of types and schemas.
- **Charts:** hand-written React SVG on `d3-scale`/`d3-shape` rather than visx. This keeps the bundle smaller, themes charts directly from CSS tokens, and gives full control of focus, ARIA and data-table fallbacks.
- **Icon substitutions:** `terrain` is now only a legacy alias of `landscape`, and `filter_hdr` is not in the current canonical set. They are replaced by `landscape_2` and `mountain_flag` where the specification suggested them.
- **Nav includes Dhahabu:** the nav order follows §1 of the specification (Home · Countries · Harim · Dhahabu · History · Contemporary Africa).
- **Local database:** tests run SQL against **PGlite** (Postgres in WebAssembly), so neither local work nor CI needs a database server. Real data is loaded into Neon.
- **Dev-tool advisories:** `npm audit` reports advisories in dev-only tooling (`netlify-cli`'s local server dependencies and Stylelint's glob dependencies). None of it ships to the browser or the deployed functions.

## Roadmap

v1 milestones (stop points for review are marked ⏸):

1. ✅ Scaffold
2. Data foundation: migrations, PDF extraction, seeds, review report ⏸
3. Flags and region colours ⏸
4. API (Neon connected)
5. Map
6. Countries table
7. Ribbon and coverage
8. Harim data ⏸
9. Harim API and table
10. Harim statistics band ⏸
11. Harim map and chart
12. Harim ranges, peak pages and export
13. Dhahabu source and licence check ⏸
14. Dhahabu data ⏸
15. Dhahabu API, table, band and live ribbon ⏸
16. Dhahabu map, charts and drawer
17. Polish, Lighthouse and deployment

**Not in v1:**

- **Dhahabu:** gold demand, jewellery and investment flows (including ETFs); company-level production and ownership data; artisanal-mining formalisation and responsible-sourcing indicators; a standalone page per country; inflation-adjusted values. Forecasts and investment advice will never be added.
- **Harim:** glaciers and volcanic activity (v1.1, after a data assessment); protected areas and UNESCO World Heritage mountain sites; an elevation-zones infographic; a west-to-east skyline chart; hillshade or 3D terrain; a "which is taller?" quiz; peak photos, climbing routes and first-ascent history.
- **General:** historical timelines; contemporary indicators (via a future `indicators` / `observations` time-series model); user accounts; a CMS; multi-language content; long-form search; offline/PWA support.

## Credits and licences

Credits are shown in the site footer and in data exports, including the attribution wording required by GeoNames (CC BY 4.0) and the IMF. Sources: the project's state-symbology research document, Natural Earth, Flagpedia, Material Symbols (Apache 2.0), Fraunces and Instrument Sans (SIL OFL 1.1), Wikidata (CC0), GeoNames (CC BY 4.0), the Harim prototype, the IMF, USGS, BGS, the World Bank and UN Comtrade. The World Gold Council's Goldhub is linked for reference only; none of its data is republished.

Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim.
