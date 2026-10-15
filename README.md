# Bara La Afrika

**Bara La Afrika** (Swahili for "the continent of Africa") is a long-running project for uncovering, learning about and understanding Africa from historical and contemporary perspectives. Version 1 is a responsive web app with four sections:

| Section | Route | What it shows |
|---|---|---|
| Home | `/` | Interactive Equal Earth map of Africa, countries coloured by region |
| Countries | `/countries` | All 54 states: the meaning of their names, flags, national symbols and national animals (from the project's research document) |
| **Harim** | `/harim` | Africa's mountains and their heights, per country |
| **Dhahabu** | `/dhahabu` | Gold in Africa: deposits, mining, trade and central bank reserves |

History and Contemporary Africa appear in the navigation as "Coming soon".

> **Status:** milestones 1–7 of 17 are complete: scaffold, data foundation, flags with approved region colours, the API (connected to Neon), the **interactive map** on the home page, the **countries table** and the **data ribbon** with live coverage and the shared time range. Harim's mountain data is next (see [Roadmap](#roadmap)).

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started (local development)](#getting-started-local-development)
- [Data: database and pipelines](#data-database-and-pipelines)
- [API](#api)
- [The map](#the-map)
- [The countries table](#the-countries-table)
- [The data ribbon and time range](#the-data-ribbon-and-time-range)
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
  public/                 favicon (Africa silhouette), robots.txt, map topojson, flag fallbacks
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
db/roles.sql              one-time read/write role setup (run in the Neon SQL editor)
db/tests/                 schema and seed tests against PGlite
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

npm run dev:local               # site + API with the committed seed data: http://localhost:5173
```

Three ways to run the site locally:

| Command | Open | Data |
|---|---|---|
| `npm run dev:local` | http://localhost:5173 | The real API handlers on an in-memory Postgres loaded with the committed seeds (`e2e/api-server.ts`, port 4175), behind Vite's proxy. No database or `.env` needed. Ctrl+C stops both. |
| `npm run dev:netlify` | http://localhost:8888 | The Netlify Functions emulator on **your Neon database** (`DATABASE_URL_READ` from `.env`). The CLI injects every `.env` variable locally, but the functions only ever read `DATABASE_URL_READ`. |
| `npm run dev` | http://localhost:5173 | None: the site alone, for layout work. Where data would load, development builds explain which command to run instead. |

`netlify dev` and the production CSP: the build writes the Content-Security-Policy to `apps/web/dist/_headers`, and Netlify merges `<publish>/_headers` into its config. Under `netlify dev` that CSP would block Vite's inline development scripts and leave a blank page, so `netlify.toml` points `publish` at `apps/web/public` in the `dev` context. Deploys still use `apps/web/dist` and its CSP (a test guards this).

Local `netlify dev` quirk: after a 404 from a function, the emulator retries the same path with `.html`/`index.html` suffixes (to mimic static-file lookup), so a not-found message may name a suffixed path. Production returns the function's response as is.

The pipelines run from the repo root (`uv run python -m pipelines --help`); see the next section.

## Data: database and pipelines

### One-time Neon setup

1. Create a Neon project (one branch for production; optionally a branch per deploy preview).
2. In the Neon SQL editor, as the database owner, run [`db/roles.sql`](db/roles.sql) after replacing its two placeholder passwords. It creates `bla_writer` (pipelines) and `bla_reader` (read-only, for the Netlify Functions).
3. Put the connection strings where they belong (see [Environment variables](#environment-variables)): `bla_writer` → `DATABASE_URL_WRITE` in your local `.env` and the GitHub Actions secrets; `bla_reader` → `DATABASE_URL_READ` in the Netlify site settings.

### First run

| Step | Command | What it does | Status |
|---|---|---|---|
| 1 | `uv run python -m pipelines migrate` | Applies `db/migrations/*.sql` in order (checksummed; an applied file that was edited is an error) and grants `SELECT` to `bla_reader` | ✅ |
| 2 | `uv run python -m pipelines extract-pdf` | Research PDF → `db/seeds/{countries,sources,datasets}.json` and `data/review_report.md`, with loud validation (54 countries; region counts 6/15/9/16/8; unique ISO codes; every summary field present; no stray citation digits) | ✅ |
| 3 | `uv run python -m pipelines flags` | Downloads the 54 flag SVGs from flagcdn.com (cached in `data/raw/flags/`, copied to `apps/web/public/flags/` as the offline fallback), computes each flag's palette and each region's colour, and writes `db/seeds/flags.json` and `data/region_colors_report.md` | ✅ |
| 4 | `uv run python -m pipelines boundaries` | Natural Earth 4.1.0 (1:50m, via world-atlas 2.0.2) → `apps/web/public/geo/africa.topo.json` (the 54 countries, Somaliland tagged as Somalia, Western Sahara as disputed) and `africa-context.topo.json` (neighbouring land, loaded after the countries); computes each country's area on the equal-area Equal Earth projection, a map anchor and whether it needs a circle marker; writes `db/seeds/boundaries.json` and `data/boundaries_report.md` | ✅ |
| 5 | `uv run python -m pipelines load` | Upserts the seeds into Neon (regions with the **approved** colours, countries, profiles, sources, citations, flag palettes, datasets). Only rows whose values changed are written, so re-runs report 0 changes; each run is logged in `ingestion_runs` and refuses to start while migrations are pending | ✅ |

`uv run python -m pipelines status` prints every dataset's "as of" date, last refresh, cadence and last run (flagging overdue datasets).

`migrate --dry-run` lists pending migrations. `extract-pdf --check` validates without writing and fails if the committed seeds are stale; the pytest suite runs it.

### Region colours

Each region's identity colour is the **mode colour across its flags**: flags are rasterised, clustered into at most 8 colours in CIELAB, merged across flags (CIEDE2000 < 10) and summed per region; white, black and grey are excluded by default, and near-identical picks are resolved by giving the colour to the region where it has the larger share. Anti-aliasing blends at stripe edges are folded back into the real flag colours first. Every parameter is a command-line option (`python -m pipelines flags --help`), and `--include-neutrals` switches which result is selected (both are always reported).

`data/region_colors_report.md` shows the picks with swatches, the top five candidates per region, every uniqueness decision, both results, per-flag palettes and automated checks (distinctness, colour-vision-deficiency simulation, contrast against the light and dark page). Colours are never adjusted by hand.

**Approval.** The approved colours (2026-10-15: North `#c1272d`, West `#009e49`, Central `#fcd116`, East `#418fde`, Southern `#001489`) are recorded in `pipelines/africa_pipelines/reference/region_colors_approval.json`, and `load` writes **only** those to `regions.color_hex`. If a later `flags` run computes different colours, the approved ones stay in use and the report says the computation differs, until a new approval is recorded there.

### Correcting the data

The research document is not fully verified (see `data/review_report.md`). To correct it:

1. Edit `db/seeds/countries.json` (or `sources.json`). For example, fix a summary, set `etymology_category`, change `animal_status`, or set `needs_review` to `false` once a record is checked.
2. Run `uv run python -m pipelines load`.

`extract-pdf` refuses to overwrite seeds you have edited (it compares a content hash recorded at generation time) unless you pass `--force`.

How the extraction works and where its judgement calls live:

- `pipelines/africa_pipelines/reference/african_states.json`: canonical names (with diacritics), ISO codes, regions, and every label the PDF uses for each country.
- `pipelines/africa_pipelines/reference/symbology_curation.json`: the reviewed mapping of each country's prose sentences to profile fields, the animal-status decisions with their reasons, the reviewed etymology categories, the known inconsistencies (each marked corrected, status changed or open) and the **verified corrections**. Each correction replaces or appends exact text, gives its reason and cites the reference source it was checked against; that source is added to `sources` and cited on the corrected field. If a correction's original text stops matching, extraction fails rather than silently skipping it. The review report lists every correction with its before and after text.
- `pipelines/africa_pipelines/reference/source_tiers.json`: the reliability tier for each cited website.

### Scheduled refresh

`.github/workflows/data-refresh.yml` runs weekly (and on demand): `migrate` → `flags --refresh` → `load` → `status`, then calls the Netlify build hook if `load` changed any rows. If upstream flags changed the generated seeds, the run warns and uploads them (with the colour report) as the `refreshed-data` artifact for you to review and commit; the approved region colours are never replaced automatically. Repository secrets: `DATABASE_URL_WRITE` (required) and `NETLIFY_BUILD_HOOK` (optional).

### Local database for tests

Tests never need a database server. Vitest runs the migrations and loads the seeds into **PGlite** (Postgres compiled to WebAssembly, in-process). pytest starts PGlite's socket server so the Python migration runner is tested over the real Postgres wire protocol.

## API

Netlify Functions in `netlify/functions/`, one file per route, each declaring its route with `config.path` (functions are matched before redirects; the `/api/*` → `/.netlify/functions/:splat` rewrite in `netlify.toml` remains the catch-all). All responses are JSON; request parameters are validated with zod against the shared contract in `packages/shared/src/schemas.ts`.

| Route | Returns |
|---|---|
| `GET /api/regions` | The five regions in document order: name, description, approved `colorHex`, country count |
| `GET /api/countries?region=<slug>&q=<text>` | Country summaries (all 54 without parameters): region, flag URLs (Flagpedia SVG, PNG template, self-hosted fallback), short profile fields, animal status, `needsReview`. `q` matches names, official names and ISO codes, accent-insensitively ("cote" finds Côte d'Ivoire) |
| `GET /api/countries/:iso3` | The full profile: long texts, scientific name, review notes and every cited source with its reliability tier and the fields it supports. Unknown or malformed codes are 404 |
| `GET /api/coverage?datasets=a,b` | Each dataset's provider, licence, attribution, coverage, "as of" date and last refresh; requested keys with no data yet are listed in `missing` |

- **Errors** always have the shape `{ "error": { "code", "message" } }`: `bad_request` (400, invalid query parameters), `not_found` (404), `method_not_allowed` (405; only GET and HEAD), `service_unavailable` (503, database not configured) and `internal_error` (500; details are logged, never returned).
- **Caching:** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` with a weak `ETag` (304 on `If-None-Match`). Errors are `no-store`.
- **Database:** the Neon HTTP driver with the read-only `bla_reader` role (`DATABASE_URL_READ`); every query is parameterised (`netlify/functions/_shared/queries.ts`). Search uses the `search_fold()` SQL function and the `v_country_summary` view (migration 0002).
- **Bundling:** functions import the shared contract by relative path (`_shared/contract.ts`), so Netlify's bundler inlines it. `npm run check:functions` builds the functions exactly as a deploy does and checks every bundle loads and answers.
- **Web client:** `apps/web/src/lib/api.ts` (typed by the same contract).

## The map

The home page (`apps/web/src/features/map/`) draws Africa on the **Equal Earth** projection (`d3-geo`), fitted to a box from Cabo Verde to Mauritius (far islands such as South Africa's Prince Edward Islands stay reachable by panning).

- **Fills** use the approved region colours as CSS variables (`--region-<slug>`), set from `/api/regions`, with the same colours in `tokens.css` as no-flash fallbacks (a test keeps them in sync with the approval).
- **Dark theme:** `darkThemePalette()` (`lib/colour.ts`) keeps every hue. It lifts a colour's OKLCH lightness only to reach 3:1 against the dark map ocean (WCAG 1.4.11), then lifts the lighter of any pair closer than ΔE 30 until they separate. With the approved colours this changes only East (`#72b6fe`) and Southern (`#2b5acd`).
- **Boundaries** are drawn once as meshes (borders and coastlines), with thin strokes that stay thin at any zoom. **Somaliland** is merged into Somalia (no internal line); Somalia's tooltip and profile explain this (declared independence in 1991, self-governing, not recognised by the African Union or UN), and screen readers hear the same note. **Western Sahara** is hatched, with the tooltip "Disputed territory". A note under the map states that boundaries do not imply endorsement of any claim.
- **Small states** (under 20,000 km² on the map: Cabo Verde, São Tomé and Príncipe, Comoros, Mauritius, Seychelles, The Gambia, Eswatini) get clickable circle markers. Lesotho (about 30,000 km²) is large enough to click.
- **Interaction:**
  - Hover or keyboard focus shows a tooltip with the flag, name and region.
  - Click or tap opens a short profile with "See in table": a popover on larger screens, a bottom sheet on phones. Escape closes it and returns focus.
  - The **legend** isolates a region (others dim) and links to `/countries?region=…`.
  - Zoom with the + / − / reset buttons, pinch, or Ctrl/⌘ + scroll; drag to pan. One-finger swipes still scroll the page on phones.
- **Keyboard:** one Tab stop into the map, arrow keys move between countries (alphabetical), Home/End jump, Enter opens. The countries table is the accessible equivalent and is linked under the map.
- Countries fade in by region (instant with reduced motion).

## The countries table

`/countries` (`apps/web/src/features/countries/`) lists all 54 countries with their flag, region, name meaning, national symbol and national animal.

- **Filters live in the URL**, so every view can be shared: `?region=<slug>`, `?q=<search>`, `?sort=<column>` (a leading `-` sorts descending, e.g. `sort=-animal`) and `?country=<ISO3>` (opens that country's drawer). Invalid values are ignored. Filter changes replace the current history entry rather than adding one.
- **Region chips** in the region colours, plus "All", each with its country count.
- **Search** ignores case and accents ("cote" finds Côte d'Ivoire). It matches names, official names, ISO codes and every visible column, so "eagle" finds the countries whose animal is an eagle. The list loads once (shared with the map) and filters instantly; the API's `q` parameter matches names and codes only.
- **Sorting:** every column but the flag. Ties sort by country name; regions sort in their display order (North → Southern). Phones get a "Sort by" menu.
- **Flags** come from Flagpedia (`flagcdn.com`, 1x/2x, explicit size, lazy-loaded, self-hosted fallback). Hovering or focusing a flag shows the document's flag text (summary, then the full description); a tap toggles it on touch screens. Escape dismisses it, and it stays inside the viewport.
- **Animal status:** anything short of official (de facto, inferred, sports nickname, contested) is badged in the table, so inference never reads as fact.
- **Drawer:** a click on a row (or Enter on the country name) opens the full profile in a modal dialog: a side panel on wide screens, a bottom sheet on phones. It shows the long texts, the etymology category (when assigned), the animal status with its meaning, every source with its reliability tier and the fields it supports, and a "Needs verification" marker that expands to the review notes. Somalia's drawer explains Somaliland. Escape, the close button or a click on the backdrop close it, and focus returns to where it was.
- **Phones (< 720px):** a stacked card list (flag, name, region), each expanding to the summaries and a button to the drawer.
- **Desktop:** the column headers stay visible below the ribbon while scrolling. The table is laid out to fit from 720px up, so there is no horizontal scrolling and no sticky first column is needed.
- Loading skeletons, an empty state with "Clear filters", and an error state with "Retry".

## The data ribbon and time range

The strip at the top of every page (`apps/web/src/features/coverage/`) shows the data behind the current view.

- **Route config:** each route declares its datasets and whether its data is a time series in its `handle` (`ROUTE_DATA` in `app/router.tsx`). The ribbon fetches `/api/coverage` for exactly those datasets (one cached request, shared with the time range).
- **Summary line:** the kind (reference data or time series), "as of" (the newest date among the datasets), each dataset's short label (with its covered range on time-series pages, e.g. `Gold price: Jan 1990–Sep 2026`) and "Refreshed 2 days ago" (the latest pipeline run). Datasets with no row yet show "(not loaded yet)". Phones show one line; the arrow opens the details.
- **Details:** for each dataset its full name, "as of", covered range, update cadence, last refresh (date and how long ago), provider and licence.
- **Dates** are calendar dates formatted in UTC (`14 Oct 2026`), so no time zone shifts them. Ranges use the dataset's granularity from its cadence: months (`Sep 2026`), quarters (`Q2 2026`) or years (`2024`).
- **Date-range control:** read-only on reference pages ("Not time-dependent", with the explanation on hover, focus or in the details). On time-series pages (`/dhahabu`) it is a year picker with presets (last 5 years, last 10 years, since 2000, all years) and From/To lists. It is bounded by the data's coverage and never goes beyond it. With no data loaded it shows "No data yet" instead of inventing a range.
- **URL:** the range lives in `?from=&to=` (years). The full coverage is the default and leaves no params; values outside the data are clamped and a reversed range is put in order, so shared links always resolve to a valid range. Reference pages ignore the params.

**For views (Dhahabu from milestone 15, and later modules):**

```ts
const { interactive, bounds, range, referenceYear, setRange } = useTimeRange();
// range: { start, end } years for charts; referenceYear (= range.end) for tables, maps and cards.
```

To add a dataset, add its key to `DATASET_KEYS` (`packages/shared/src/datasets.ts`), give it a short label in `strings.datasets`, and list it in the route's `handle`. Its coverage then appears in the ribbon and, for series, extends the range's bounds.

## Quality checks

| Command | What it runs |
|---|---|
| `npm run check` | ESLint + Stylelint, `tsc -b`, Vitest, production build |
| `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` | individually |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run check:functions` | Builds the Netlify Functions as a deploy does and checks each bundle loads and answers |
| `npm run e2e` | Playwright: desktop (1440×900) and mobile (390×844) projects; includes axe accessibility checks in light and dark mode and no-horizontal-scroll checks at 320px. It runs the **real API handlers** (`e2e/api-server.ts`) on an in-memory Postgres loaded with the committed seeds, proxied behind `vite preview`, so no Neon connection is needed |
| `npm run screenshots` | Captures every page at desktop and mobile, light and dark, into `screenshots/` (gitignored) for visual review |
| `uv run ruff check . && uv run ruff format --check .` | Python lint and format |
| `uv run mypy` | Python type-check (strict) |
| `uv run pytest` | Python tests (needs `npm install` for the PGlite-backed database tests) |

Vitest also checks the repository itself: `scripts/gitignore.test.ts` fails if `.gitignore` hides any source file, and `scripts/netlifyConfig.test.ts` keeps the production CSP out of `netlify dev`.

CI (`.github/workflows/ci.yml`) runs all of these on every push to `main` and on pull requests.

## Environment variables

Copy `.env.example` to `.env` for local work. **Each variable belongs in exactly one place:**

| Variable | Where it lives | Used by |
|---|---|---|
| `DATABASE_URL_READ` | Netlify site environment variables (and local `.env` for `npm run dev:netlify`) | Netlify Functions (read-only DB role) |
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
- **Favicon:** a dark-filled silhouette of Africa (mainland and Madagascar), built from the site's own Natural Earth boundaries (public domain) by `node scripts/build-favicon.mjs`. The SVG switches to a light fill when the browser uses a dark colour scheme, so it stays visible on dark tab strips; `favicon.ico` (16/32/48 px) is the fallback. The script also stamps the icon links in `index.html` with `?v=<hash of both files>`, so browsers that cached an older icon for the same address (another project on `localhost`, or a previous deploy) fetch the new one; a test checks the stamp is current. Material Symbols has no Africa icon. The home page's tab reads just "Bara La Afrika".

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
- **API routing:** each function declares its own route with `config.path` (Netlify matches functions before redirects). The specified `/api/*` → `/.netlify/functions/:splat` rewrite is kept as the catch-all for unknown API paths.
- **Malformed path codes are 404:** `/api/countries/KE` names a country that does not exist, the same as `/api/countries/XYZ`. Invalid query parameters are 400.
- **Shared contract by relative path in functions:** Netlify's function bundler keeps workspace packages external and does not package their TypeScript source, so functions import it through `_shared/contract.ts` (relative path, inlined). CI checks the built bundles.
- **Approved colours are pinned:** `load` writes the colours recorded in `region_colors_approval.json`, never a newer computation.
- **Map extent and markers:** the default view is fitted to a fixed box around the mainland and island states rather than to every geometry. The marker threshold (20,000 km²) is a `boundaries` option.
- **Somaliland:** merged into Somalia on the map, following the research document's 54 recognised states. Western Sahara is shown as disputed and is not one of the 54.
- **Natural Earth date:** the boundaries dataset's "as of" is the Natural Earth v4.1.0 release date (2018-05-23, from the GitHub release).
- **Wheel zoom needs Ctrl/⌘** so the full-width map never traps page scrolling; buttons and pinch always zoom.
- **Countries search is client-side:** the table filters the cached list of 54 instead of calling `/api/countries?q=` on each keystroke. It is instant, and it also searches the visible columns (meanings, symbols, animals).
- **"Needs verification" is shown in the drawer only:** every country currently has `needs_review` set (most cite low-reliability sources), so a marker on every row would carry no information. The drawer shows the marker and the reasons.
- **"As of" in the ribbon is the newest date among a view's datasets** (as in the specification's example). Each dataset's own date is in the details, so older sources (e.g. Natural Earth 2018) are never hidden.
- **Year granularity for the shared range:** the specification asks for a year-range control on `/dhahabu`, so `?from=&to=` are years. Monthly series can still be drawn month by month inside the chosen years.
- **Dev-tool advisories:** `npm audit` reports advisories in dev-only tooling (`netlify-cli`'s local server dependencies and Stylelint's glob dependencies). None of it ships to the browser or the deployed functions.

## Roadmap

v1 milestones (stop points for review are marked ⏸):

1. ✅ Scaffold
2. ✅ Data foundation: migrations, PDF extraction, seeds, review report ⏸
3. ✅ Flags and region colours ⏸ (colours approved 2026-10-15)
4. ✅ API (Neon connected)
5. ✅ Map
6. ✅ Countries table
7. ✅ Ribbon and coverage
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
