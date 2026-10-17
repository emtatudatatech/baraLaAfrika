# Bara La Afrika

**Bara La Afrika** (Swahili for "the continent of Africa") is a long-running project for uncovering, learning about and understanding Africa from historical and contemporary perspectives. Version 1 is a responsive web app with four sections:

| Section | Route | What it shows |
|---|---|---|
| Home | `/` | Interactive Equal Earth map of Africa, countries coloured by region |
| Countries | `/countries` | All 54 states: the meaning of their names, flags, national symbols and national animals (from the project's research document) |
| **Harim** | `/harim` | Africa's mountains and their heights, per country |
| **Dhahabu** | `/dhahabu` | Gold in Africa: deposits, mining, trade and central bank reserves |

History and Contemporary Africa appear in the navigation as "Coming soon".

> **Status:** milestones 1–12 of 17 are complete: scaffold, data foundation, flags with approved region colours, the API (connected to Neon), the **interactive map**, the **countries table**, the **data ribbon**, and **Harim** in full (data, API and tables, statistics band, map and chart, ranges, peak pages and export). Next: the Dhahabu source and licence check (milestone 13). See [Roadmap](#roadmap).

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
- [Harim: the mountains page](#harim-the-mountains-page)
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
    components/           Icon, IconButton, GlassCard, PageHeader, Tooltip, Drawer, RegionFilter…
    styles/               tokens.css, glass.css, base.css, media.css, fonts.css
    lib/                  strings (i18n dictionary), api client, units (m/ft), storage, theme
packages/shared/          types, zod schemas and constants shared by web + functions
netlify/functions/        API functions (_shared/ holds HTTP and DB helpers)
netlify/tests/            function tests (kept outside functions/ so they never deploy)
db/migrations/            numbered .sql migrations
db/roles.sql              one-time read/write role setup (run in the Neon SQL editor)
db/tests/                 schema and seed tests against PGlite
db/seeds/                 generated, reviewable JSON seeds (committed)
pipelines/                Python package: `python -m pipelines <command>`
scripts/                  build helpers (Material Symbols subsetting, favicon, social images)
config/constants.json     single source of truth for unit constants
e2e/                      Playwright suites (desktop 1440×900, mobile 390×844)
data/source/              the research PDF (raw downloads go to data/raw/, gitignored)
docs/                     statistic definitions (harim-stats.md)
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
| 5 | `uv run python -m pipelines mountains` | Builds the Harim catalogue (see [Mountain data](#mountain-data-harim)) → `db/seeds/{mountains,mountain_ranges,country_low_points}.json` and `data/mountains_review_report.md` | ✅ (awaiting review) |
| 6 | `uv run python -m pipelines load` | Upserts the seeds into Neon (regions with the **approved** colours, countries, profiles, sources, citations, flag palettes, the mountain catalogue, datasets). Only rows whose values changed are written, so re-runs report 0 changes; each run is logged in `ingestion_runs` and refuses to start while migrations are pending | ✅ |

`uv run python -m pipelines status` prints every dataset's "as of" date, last refresh, cadence and last run (flagging overdue datasets).

`migrate --dry-run` lists pending migrations. `extract-pdf --check` validates without writing and fails if the committed seeds are stale; the pytest suite runs it.

### Mountain data (Harim)

`python -m pipelines mountains` (`pipelines/africa_pipelines/harim*.py`) builds a catalogue covering all 54 countries. Every download is cached under `data/raw/` (gitignored), so re-runs are reproducible and offline; `--refresh` fetches again.

- **Sources:**
  - the Harim prototype at a pinned commit (`harim.html` and `README.md`), which decides which peaks exist;
  - Wikidata: peaks per country, each country's P610 highest point and P1589 lowest point, prominence, isolation and GeoNames IDs (the class IDs used are checked against Wikidata on every run);
  - the CIA World Factbook's **final edition** (public domain; discontinued in February 2026), via the factbook.json mirror at a pinned commit, as an independent check of every country's highest and lowest point;
  - GeoNames dumps (CC BY 4.0), for elevation cross-checks (surveyed elevations only);
  - Wikipedia, only for curated facts, each quoted;
  - the Smithsonian Global Volcanism Program's volcano numbers, read from Wikidata (P1886) and linked from each volcano (none of the GVP's data is copied).
- **Volcanoes:** a mountain is a volcano when Wikidata gives it a volcanic class (stratovolcano, shield volcano and others) or the Global Volcanism Program lists it. Many volcanoes (Mount Meru, Ol Doinyo Lengai, Nabro) are typed only as "mountain" in Wikidata, so the class alone would miss them. Older volcanoes the GVP does not list (it covers recent volcanism) are added in the curation file's `volcanoes` section, each with a quoted source (Mount Kenya: an extinct stratovolcano). Status (active, dormant, extinct) is recorded only where a source states it (a Wikidata class or the curated source); nothing is inferred, so most statuses are unknown.
- **Elevation:** the value most of the most reliable sources agree on (within 10 m); every other value is kept in `elevation_alternatives`. Confidence is high when they agree within 10 m, medium within 50 m (or with one reliable source), low otherwise; any disagreement above 10 m, including the prototype's, sets `needs_review`. Values that bulk-imported Wikidata items copied from GeoNames count as GeoNames.
- **Selection:** every country high point, every peak of 3,000 m or more, every prototype peak, and up to 8 notable peaks per country. Little-known points within 1.5 km of a mountain, or within a massif's radius, are parts of it, not separate mountains. Territory peaks (Réunion, the Canary Islands, Madeira…) are kept separate.
- **Hierarchy:** massif → summit, two levels, only where a cited source names the summits (Kilimanjaro → Kibo, Mawenzi, Shira; Mount Kenya → Batian, Nelion, Point Lenana; and others). A massif counts as one mountain and stands exactly as high as its highest summit.
- **Range descriptions:** 27 of the 30 ranges have a short description (and a formation note, type and length where the source states them), each sourced to its Wikipedia article with exact quotes re-checked every run; the review report lists them. Sinai, the Tunisian Dorsal and Moka have none yet, and their pages say so.
- **Curation:** `pipelines/africa_pipelines/reference/harim_curation.json` holds the pinned commits, thresholds, prototype matches, massifs, sourced elevations, curated volcanoes, ranges (with their descriptions), territories and the decisions where Wikidata and the Factbook disagree on a country's high or low point. `db/seeds/mountain_names.json` holds local names and name origins. Every text claim has a source URL and the exact quote; the run re-checks each quote against the cached source and fails if it is missing, so nothing is invented.
- **Validation** (the run fails otherwise):
  - every country has one high point and a low point below it;
  - the hierarchy is valid and massif heights match their summits;
  - slugs are unique and elevations sane;
  - coordinates lie inside or within 5 km of every listed country on the map's own boundaries (island states are warned instead);
  - any disagreement between sources on a country's high or low point needs a recorded decision.
- **Report:** `data/mountains_review_report.md` lists the per-country high points, every decision and conflict, each prototype entry, elevations to review, the hierarchy, exclusions, territories, low points, ranges and names.
- **Database:** migration `0003_harim.sql` enforces the same rules: 0–6,000 m, Africa's bounding box, summits under massifs, massif height checked at commit, one high point per country (never a summit), no territory peak in a country, sea-level coasts at 0 m, and sourced name origins.

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

`.github/workflows/data-refresh.yml` runs weekly (and on demand): `migrate` → `flags --refresh` → `mountains --refresh` (first Monday of the month, or on a manual run) → `load` → `status`, then calls the Netlify build hook if `load` changed any rows. If upstream data changed the generated seeds, the run warns and uploads them (with the colour and mountain reports) as the `refreshed-data` artifact for you to review and commit; the approved region colours are never replaced automatically. Repository secrets: `DATABASE_URL_WRITE` (required) and `NETLIFY_BUILD_HOOK` (optional).

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
| `GET /api/mountains/summary?region=&q=` | One row per country (54), highest peak first: the highest peak (with a massif's top summit and the countries it is shared with), number of mountains, mean height, ranges, lowest point and relief |
| `GET /api/mountains?region=&country=&range=&q=&minHeight=&volcanic=&sort=` | The catalogue (counted mountains: standalone and massifs, each once; summits are nested in their massif). `country` lists a shared peak under each of its countries; `volcanic=1` any volcano, or `active`/`dormant`/`extinct`/`unknown`; `sort=height` (default), `-height`, `prominence` (unknown last) or `name`. `territories=1` lists the territory peaks instead; `summits=1` adds summits as rows. Returns `count`, `total` and `capped` (the list is capped at 600) |
| `GET /api/mountains/:slug` | One mountain: height with its source and every other sourced height, prominence, isolation, coordinates, range, type, volcanic status, massif and summits, local names and name origin (each with its source), notes, review notes and sources by field. Unknown or malformed slugs are 404 |
| `GET /api/mountains/ranges?region=&q=` | The ranges with catalogued mountains, tallest first: type, length, mountain count, tallest peak, their heights, the countries spanned (most peaks first), regions and the card tint (`v_range_summary`, migration 0006) |
| `GET /api/mountains/ranges/:slug` | One range: its sourced description and formation note, source, review notes and its mountains. Unknown, malformed or empty ranges are 404 |
| `GET /api/mountains/export?format=csv\|geojson&<filters>` | A download of the catalogue, filtered like `/api/mountains` (never capped). CSV starts with a `#` block, GeoJSON carries a `metadata` member: as-of date, filters, each dataset's version, licence and attribution, and the other sources. Rows include the height's source and a link to the peak's page |
| `GET /api/mountains/stats?region=` | The statistics band's figures from `v_harim_stats()` (for All Africa, or one region), each with its definition; ties are listed, never resolved at random. Each card's details and entities have their own schema in the shared contract. 503 until the mountain data is loaded |

- **Errors** always have the shape `{ "error": { "code", "message" } }`: `bad_request` (400, invalid query parameters), `not_found` (404), `method_not_allowed` (405; only GET and HEAD), `service_unavailable` (503, database not configured) and `internal_error` (500; details are logged, never returned).
- **Caching:** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` with a weak `ETag` (304 on `If-None-Match`). Errors are `no-store`.
- **Database:** the Neon HTTP driver with the read-only `bla_reader` role (`DATABASE_URL_READ`); every query is parameterised (`netlify/functions/_shared/queries.ts` and `harimQueries.ts`). Search uses the `search_fold()` SQL function and the `v_country_summary` view (migration 0002). The Harim routes read `v_mountains`, `v_country_mountain_summary` and `v_harim_stats()` (migration 0004; 0005 adds each height's confidence and other sourced heights to the statistics, and names the region in the lowest point's label). Every statistic's definition and tie rule is in [`docs/harim-stats.md`](docs/harim-stats.md), word for word as the SQL returns it (a test keeps them identical).
- **Routing:** `/api/mountains/:slug` excludes the fixed paths (`summary`, `stats`, `export`, `ranges`), and a test checks every API path reaches exactly one function.
- **Files:** a handler may return a ready `Response` (the export), with the same caching and ETag as JSON.
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
- **Shared base:** `features/map/MapBase.tsx` holds what every map has: the fitted Equal Earth projection, context land, graticule, borders and coastlines, d3-zoom with the + / − / reset buttons, and a controller for camera moves (fit a box, centre a point, animated unless the viewer prefers reduced motion). The home map and the Harim map add their own layers on top.

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

## Harim: the mountains page

`/harim` (`apps/web/src/features/harim/`) answers "what are Africa's mountains, how high are they, and where are they, country by country?"

- **By country** (the default): one row per country, highest peak first, with the flag, the region chip, the highest peak (a massif's top summit beneath it, and "Shared with …" for border peaks), its height with a proportional bar, the number of mountains, the ranges, the lowest point and the relief. Click a row (or its name) to expand it to the country's mountains: height in metres and feet, range, type and volcanic status, a confidence badge, "National high point" and "Shared with …" badges, and a massif's summits nested beneath it (it counts as one mountain). "Country profile" opens the country's drawer on `/countries`.
- **All peaks:** the whole catalogue as one list, sortable by name, height or **prominence** (unknown prominence shows "—" and sorts last), with a "Most prominent peaks" preset and an "Ultra-prominent" badge from 1,500 m. Filters: region, country, range, volcanic status and a minimum-height slider.
- **Territory peaks** (Réunion, the Canary Islands, Madeira…) are listed apart, in a collapsed group loaded on first open, and never counted with the countries.
- **Statistics band** (`features/harim/stats/`): nine glass cards under the header, all figures from `/api/mountains/stats` (computed in the database; definitions in [`docs/harim-stats.md`](docs/harim-stats.md)).
  - **Hero cards:** mountains catalogued (with countries and territory peaks), volcanic mountains (a bar and legend by status), the tallest mountain (a massif with its top summit, and the flag), and the lowest national high point ("Africa's lowest 'highest point'", never "the shortest mountain").
  - **Compact cards:** peaks above 4,000 m (a bar and legend of the four height bands), the most mountainous country, the busiest range with its tallest peak, the lowest point and the greatest relief. Ties are listed, each with its own button.
  - **Scope:** "All Africa", or the selected region as a chip in its colour, always shown above the cards; the figures recompute for the region (the previous figures stay, dimmed, while the new ones load). Screen readers hear the scope with each card's name, and the lowest-point card names the region ("Lowest point in East Africa").
  - **Each card does something:** open the peak's drawer (tallest, lowest high point), filter All peaks (volcanoes; peaks above 4,000 m from 4,001 m, since the bands are strict; the most mountainous country's peaks of 3,000 m or more; the busiest range's peaks until range pages exist in milestone 12), or open the country's row (lowest point, greatest relief). The page then scrolls to the list. The whole card is the target, through its own button (keyboard and screen readers).
  - **"How is this calculated?":** the "i" button shows the API's definition over the card; Escape or Close returns focus to the button.
  - **Caveats:** a height whose confidence is low, or whose other sources differ by more than 10 m, gets a "Sources disagree" marker listing the other heights; a low point marked for review gets "Needs verification".
  - **Motion and states:** numbers count up on first load (800 ms, never with reduced motion; screen readers get the final figure only); skeletons while loading; an error with Retry.
  - **Layout:** from 1280px the four hero cards, then the five compact cards in one row; 720–1279px three columns; phones a scroll-snap carousel (hero cards first) with dots, scrolling inside itself so the page never scrolls sideways.
  - **Most prominent peak** is not shown: the card needs prominence for at least 80% of the mountains of 3,000 m or more, and the catalogue has it for about a third (Wikidata's coverage). It appears automatically if that changes.
  - **Colours:** height-band and volcanic-status tokens (`--band-*`, `--volcanic-*` in `tokens.css`), tuned for each theme and shared with the map; text always gives the same numbers.
- **Map** (`features/harim/map/`): the shared Africa map with countries in a muted tint of their region colour, and the mountains on top.
  - **Glyphs:** a triangle per mountain, its size on a square-root scale of height, coloured by height band (above 5,000 m, 4,000–5,000, 3,000–4,000, 3,000 m or lower). Shared border peaks get a dotted ring; territory peaks are grey. A legend gives each band's count.
  - **Decluttering:** at first the map shows every national high point and the 25 tallest other peaks; more appear as you zoom, and all from 4×. Peaks close enough for their glyphs to touch are drawn as one (the tallest, with a count bubble), named by their range when they share one ("Virunga ×3"); a group opens a list of its peaks. Smaller maps (phones) get smaller glyphs and fewer peaks.
  - **Labels:** a greedy placer, tallest first, tries four spots around each glyph and keeps the first that overlaps no other label, glyph or map control; the rest stay unlabelled, so more names appear as you zoom.
  - **Interaction:** hover or keyboard focus shows a tooltip (name, height in both units, flags); a click or Enter opens a card with "Full details" (the drawer) and "Show in the table". The peaks are one tab stop: arrow keys move between them, tallest first, and each is named for screen readers ("Mount Kenya, 5,199 metres, Kenya").
  - **Linked with the table:** hovering a row highlights its peak on the map; "Show on the map" (a pin button on every row, and "Show on the map" for an expanded country) centres the map on the peak or country and opens the card; "Show in the table" opens the country's row (or finds the row in All peaks), highlights it and moves focus to it. Expanding a country, choosing a country or region, or opening a peak's drawer also moves the map there. "Fit the map to …" appears when a country is chosen.
  - **"Area of influence"** (off by default): golden dashed circles that grow with height, captioned as illustrative only, not a geological or administrative boundary.
  - The map follows the same filters as the table; peaks under the zoom buttons are left out so no tap target hides beneath them.
- **Chart: "Highest peak by country"** (`features/harim/chart/`): a horizontal bar per country in its region colour, highest first or A to Z, following the region filter, with a dashed line at Kilimanjaro. Hover or tap a bar for its peak and height; "Show the data as a table" is the accessible equivalent.
- **Geology card:** "Why are Africa's highest mountains where they are?", adapted from the prototype's notes and checked against eight Wikipedia articles (linked). The prototype called the High Atlas a remnant of ancient events; it rose mainly in the last 66 million years, so the card says so. Open on larger screens, collapsed on phones.
- **Cross-links:** the Countries drawer shows "Highest peak: …", linking to `/harim?country=<ISO3>` (that country's row, expanded, and the map fitted to it); each Harim row links back to the country's profile.
- **By range** (`?view=ranges`): a card per range, tinted with the region colour of the country holding most of its peaks (neutral when split), with its type, tallest peak, mountain count, countries and a mini bar of its peaks' heights. Region chips and search apply (search also matches the ranges' mountains); sort by tallest peak (default), most mountains or name. The map shows the listed ranges' mountains.
- **Range pages** (`/harim/ranges/:slug`): the sourced description and formation note with its source ("needs verification" where unsourced; "no sourced description yet" where there is none), type, length, mountain count and tallest peak, the countries it spans (their mountains and profiles), the map fitted to the range, and its peaks (each opening its page).
- **Peak pages** (`/harim/peaks/:slug`, and "Open full page" in the drawer): name, height in both units, flags, range and volcanic status; the height's confidence, source and every other sourced height; prominence, isolation, coordinates (with a copy button), type, massif and summits; local names and name origin with sources ("Unsourced" otherwise); a locator map; nearby peaks (same range or country, nearest first); sources; and a copy-link button.
- **Export:** "Export" by the result count downloads the current view or the whole catalogue as CSV or GeoJSON from `/api/mountains/export`; a message confirms the download or reports a failure.
- **Link previews:** the build writes a page shell for `/harim` and every mountain and range page (`apps/web/build/pageShells.ts`, from the committed seeds) with that page's title, description and Open Graph tags, so shared links show the right text; Netlify serves them before the single-page fallback (as does `vite preview`). The preview image is the generic Harim card, `public/og/harim.png`; the site's is `og/site.png` (both from `node scripts/build-og-images.mjs`).
- **Peak drawer:** a click on any mountain or summit opens it: height in both units with its confidence, the source of the height and every other sourced height, prominence, isolation, coordinates, range, type, massif and summits (each opens in the same drawer), local names and name origin with their sources ("Unsourced" otherwise), notes, the "Needs verification" reasons and all sources by field.
- **URL state:** `?view=country|peaks`, `region`, `q`, `sort`, `country`, `minHeight`, `volcanic`, `range` and `peak` (the open drawer). Invalid values are ignored; `view=ranges` shows the by-country view with a note until the ranges view arrives (milestone 12). Switching to By country drops the peak-only filters. A `country` in the URL filters to that country and opens its row (the link from other pages).
- **Units:** a metres/feet toggle, remembered in this browser (`bla-units`) and applied everywhere on the page. Below sea level uses a true minus sign (`−155 m`).
- **Data loading:** the 54 summary rows load with the page; the catalogue (about 340 mountains) loads once when a row is expanded or All peaks is opened, and is then filtered and sorted in the browser with the same meaning as the API's parameters (search also matches a massif's summit names, so "Kibo" finds Kilimanjaro).
- **Layout:** stacked cards below 720px. The tables are laid out to fit their panel from 720px up (a test checks 720, 900, 1024 and 1280px), so nothing is clipped and the page never scrolls sideways. The lowest point and relief columns show from 1280px, can be switched on from 1024px, and otherwise appear in the expanded row; All peaks is a compact list below 1024px.
- Loading skeletons, empty states with "Clear filters", and error states with "Retry".

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
- **Signature:** every page ends with "© {year} Michael Maina Mwangi. All rights reserved." and "Proudly built in Kenya." with the self-hosted Kenyan flag (`SiteFooter.tsx`). The year comes from the visitor's clock, so it never goes stale.
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
- **Mountain confidence:** the specification's "more than 50 m apart → low confidence" is applied to the reliable sources, so a wrong prototype height alone does not make a well-sourced peak low-confidence. An outlier against a value two independent sources agree on gives medium; the disagreement is still flagged for review.
- **The World Factbook as a cross-check:** it was discontinued in February 2026; its final edition (public domain) is used from a pinned mirror.
- **Unsourced massif summits are not invented:** Mount Emin, Mount Gessi and Mount Luigi di Savoia are modelled as single mountains because no consulted source names their summits.
- **Volcanoes from the Global Volcanism Program:** Wikidata's "instance of" misses many volcanoes (Mount Meru and Ol Doinyo Lengai are typed only as "mountain"), so a Global Volcanism Program ID (P1886) also makes a mountain a volcano. This was found while building the tables in milestone 9 and changed 34 peaks' type from "peak" to "volcano" (nothing else in the catalogue changed). Volcanoes neither identifies are curated with a quoted source (Mount Kenya so far). Volcanic status is taken only from what a source states, so it is unknown for most volcanoes.
- **Statistics band:** "Most prominent peak" is hidden because prominence is known for only about a third of the mountains of 3,000 m or more (the specification's 80% rule). "Busiest range" filters All peaks to the range until the range pages exist (milestone 12). "Peaks above 4,000 m" filters from 4,001 m because the bands are strict (Abuye Meda, exactly 4,000 m, is in the 3,000–4,000 m band).
- **Height-band colours:** the prototype's red, orange, yellow and green are kept, but their lightness now steps in order (so the order also reads without colour) and adjacent bands were checked for normal and colour-blind vision with a palette validator, in both themes. Pale bands get a dark outline on the light map; the legend always gives the counts in text.
- **Map selection opens a card first:** a click on a peak opens a small card ("Full details", "Show in the table") rather than scrolling the page away from the map; "Show in the table" then highlights the row and moves focus to it.
- **Close groups stay grouped:** peaks a few kilometres apart (the Rwenzori summits, parts of the Virunga) can still touch at the closest zoom, so they remain a group whose list opens on click.
- **Map before chart, below the table:** the page keeps the specification's order (statistics, table, map, chart). The table is too wide to sit beside the map without clipping, so the two are linked by the actions above instead.
- **Heights never wrap from their unit:** heights use a no-break space (`5,895 m`).
- **Social images:** link previews use one generic Harim image rather than one per peak. Rendering about 90 images (every national high point and peak above 4,000 m) needs a headless browser during the build, which the deploy build does not provide, and committing them would add several megabytes. Each page still gets its own title and description in the preview.
- **Ranges the data does not support:** the specification lists the Eastern Arc and Mulanje among ranges to cover. The catalogue includes none of the Eastern Arc's main peaks (such as Kimhandu, Shengena or Mtorwi), so there is no Eastern Arc page; Mulanje is catalogued as a massif with Sapitwa as its summit, not as a range.
- **Export metadata in CSV:** a block of `#` lines before the header, since CSV has no metadata field; spreadsheet apps show it as the first rows.
- **Harim tables:** the region chip sits under the country name (one column fewer), so the By country table fits from 720px. All peaks uses the compact list below 1024px, because its six columns cannot fit a narrower panel without clipping.
- **Low-point types** add `river` and `salt_flat` to the specification's examples (many landlocked countries' lowest points are rivers; several North African ones are salt flats).
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
8. ✅ Harim data ⏸
9. ✅ Harim API and table
10. ✅ Harim statistics band ⏸
11. ✅ Harim map and chart
12. ✅ Harim ranges, peak pages and export
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

Credits are shown in the site footer and in data exports, including the attribution wording required by GeoNames (CC BY 4.0) and the IMF. Sources: the project's state-symbology research document, Natural Earth, Flagpedia, Material Symbols (Apache 2.0), Fraunces and Instrument Sans (SIL OFL 1.1), Wikidata (CC0), GeoNames (CC BY 4.0), the CIA World Factbook's final edition (public domain), Wikipedia (CC BY-SA 4.0, cited per item), the Harim prototype, the IMF, USGS, BGS, the World Bank and UN Comtrade. The World Gold Council's Goldhub and the Smithsonian Global Volcanism Program are linked for reference only; none of their data is republished.

Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim.
