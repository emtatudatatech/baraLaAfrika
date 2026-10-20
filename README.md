# Bara La Afrika

**Bara La Afrika** (Swahili for "the continent of Africa") is a long-running project for uncovering, learning about and understanding Africa from historical and contemporary perspectives. Version 1 is a responsive web app with four sections:

| Section | Route | What it shows |
|---|---|---|
| Home | `/` | Interactive Equal Earth map of Africa, countries coloured by region |
| Countries | `/countries` | All 54 states: the meaning of their names, flags, national symbols and national animals (from the project's research document) |
| **Harim** | `/harim` | Africa's mountains and their heights, per country |
| **Dhahabu** | `/dhahabu` | Gold in Africa: deposits, mining, trade and central bank reserves |

History and Contemporary Africa appear in the navigation as "Coming soon".

> **Status:** milestones 1–16 of 17 are complete: scaffold, data foundation, flags with approved region colours, the API (connected to Neon), the **interactive map**, the **countries table**, the **data ribbon**, **Harim** in full (data, API and tables, statistics band, map and chart, ranges, peak pages and export), and **Dhahabu** in full: the source and licence check ([docs/dhahabu-sources.md](docs/dhahabu-sources.md)), the data ([coverage matrix](data/gold_coverage_matrix.md), [review report](data/gold_review_report.md)), the statistics band, country table, metric map, charts and country drawer, all driven by the ribbon's year range. Milestone 17 (polish and hardening) is done: prerendered and hydrated main pages, Lighthouse 97 / 100 / 100 / 100 on mobile for all four, a sitemap and per-page social cards, and the full deployment guide ([Deployment](#deployment-netlify)). The first production deploy needs the project owner's Netlify login. See [Roadmap](#roadmap).

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
- [Dhahabu: the gold page](#dhahabu-the-gold-page)
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

- **Frontend:** React 19, Vite 8, React Router 8 (data router, code-split routes), TypeScript (strict). Plain CSS with design tokens and CSS Modules; no Tailwind or CSS-in-JS. The four main pages are prerendered at build time and hydrated in the browser (see [Performance](#performance)).
- **API:** Netlify Functions in TypeScript. Input is validated with `zod`; every error uses the shape `{ error: { code, message } }`. Responses send `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` plus an `ETag`.
- **Database:** Postgres on Neon. Plain numbered SQL migrations. Statistics are defined in SQL views, not in the browser.
- **Pipelines:** Python 3.15, managed with `uv`. Every pipeline is idempotent, logs its runs and records dataset coverage.
- **Shared code:** `packages/shared` holds the API types, schemas and constants used by both the web app and the functions. Unit constants (e.g. troy ounces per tonne) are defined once in `config/constants.json` and read from TypeScript, Python and SQL.

## Repository layout

```
apps/web/                 React + Vite app
  index.html              Real HTML entry, incl. the no-flash theme bootstrap
  build/                  build steps: the CSP (_headers), page shells with route preloads,
                          sitemap.xml and robots.txt, and the prerender of the main pages
  public/                 favicon (Africa silhouette), boot.js, social images, map topojson, flags
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
docs/                     statistic definitions (harim-stats.md), gold sources and licences (dhahabu-sources.md)
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
| 6 | `uv run python -m pipelines gold` | Builds the Dhahabu data (see [Gold data](#gold-data-dhahabu)) → `db/seeds/gold_*.json`, `data/gold_coverage_matrix.md` and `data/gold_review_report.md` (needs `COMTRADE_API_KEY`) | ✅ (awaiting review) |
| 7 | `uv run python -m pipelines load` | Upserts the seeds into Neon (regions with the **approved** colours, countries, profiles, sources, citations, flag palettes, the mountain catalogue, the gold tables, datasets). Only rows whose values changed are written, so re-runs report 0 changes; each run is logged in `ingestion_runs` and refuses to start while migrations are pending | ✅ |

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

### Gold data (Dhahabu)

`python -m pipelines gold` runs seven steps (`pipelines/africa_pipelines/gold_*.py`), each also a command of its own. Every download is cached under `data/raw/gold/`; `--refresh` fetches again. Sources, licences and the owner's decisions are in [docs/dhahabu-sources.md](docs/dhahabu-sources.md): only sources usable without asking permission (the British Geological Survey and the World Gold Council are left out).

| Step | Source | Output |
|---|---|---|
| `gold-price` | World Bank Pink Sheet, monthly average (IMF PCPS as cross-check and fallback) | `gold_price.json`: 801 months from 1960 |
| `gold-production` | USGS Mineral Commodity Summaries 2022–2026 and the Minerals Yearbook country chapters (about 200 workbooks) | `gold_production.json`: every edition's figures, "included in other" rows, in-ground reserves, and the evidence each chapter gives (notes, artisanal splits, operations) |
| `gold-official-reserves` | IMF International Liquidity, one call for the 54 countries | `gold_reserves.json`: monthly holdings since 2000, valued at each month's price, and who reports late |
| `gold-trade` | UN Comtrade (HS 7108 without 7108.20), reported and mirror, 111 calls | `gold_trade.json`: flows, top 10 partners, total exports |
| `gold-mines` | Wikidata | `gold_mines.json`: candidate mines and the quality-bar verdict (the layer is off: it fails all three checks) |
| `gold-presence` | the above, plus `db/seeds/gold_presence_overrides.json` | `gold_presence.json`: each country's tier, evidence, confidence and source |
| `gold-profiles` | the above, plus `db/seeds/gold_profile_notes.json` | `gold_profiles.json`, then validation and the two reports |

- **Null, zero, "included in other":** never coerced into each other. "NA" in a source is no row; "--" is a reported zero; a country inside a source's "Other countries" is `included_in_other` with no tonnes (and only where the yearbook shows it producing).
- **One figure per country-year:** `v_gold_production` prefers a figure over "included in other", a reported figure over an estimate, then the newer edition (`gold_production_source_priority`), and values it at that year's mean monthly price (empty until all twelve months exist).
- **Presence tiers:** major producer (≥ 20 t in the latest year with a figure), producer (> 0 t), occurrences known (a cited source documents gold without a current figure), none identified (the USGS chapters consulted show none), unknown (no USGS production table). Trade is never evidence of deposits. Curated overrides and profile notes need a source and the exact quote, which every run re-checks against the source's text (a missing quote stops the run). Seven overrides (Togo, Somalia, Guinea-Bissau, Cabo Verde, The Gambia, São Tomé and Príncipe, Comoros) leave no country "unknown"; 53 curated notes cover 31 countries.
- **Validation** (the run fails otherwise): every country has a tier; no negative quantities; producers have production evidence; every US dollar value uses the price of its own year or month (never filled); every cited source exists; "none identified" uses the agreed wording.
- **Reports:** `data/gold_coverage_matrix.md` (country × metric, with the years available) and `data/gold_review_report.md` (tiers with their evidence, source conflicts, lumped countries, late reporters, trade gaps, the mines verdict, figures left out, what needs review).
- **Database:** migration `0007_dhahabu.sql` (tables, `v_gold_price_annual`, `v_gold_production`, and `troy_oz_per_tonne()`, which a test checks against `config/constants.json`). Migration `0008_dhahabu_api.sql` adds world production (the MCS world totals) and each central bank's reporting status (`gold_reserves_reporting`), `gold_country_metrics(year)` with `v_gold_country_latest` (each metric's latest value in or before a year, with its own year or date), and `v_gold_stats(region, year)`, the statistics band (definitions in [docs/dhahabu-stats.md](docs/dhahabu-stats.md), which a test keeps word for word in step with the SQL). Migration `0009_dhahabu_charts.sql` adds `gold_price_effect()` and `gold_holdings_change()`, the split of a change in holdings value into a price effect and a volume effect (they sum exactly to the change, by construction), and the 11th card, "Price effect" (the 0008 function is renamed `gold_stats_core` and `v_gold_stats` adds the card to its ten).

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

`.github/workflows/data-refresh.yml` runs weekly (and on demand): `migrate` → `flags --refresh` → `mountains --refresh` and the gold steps (first Monday of the month, or on a manual run; gold production only on a manual run) → `load` → `status`, then calls the Netlify build hook if `load` changed any rows. If upstream data changed the generated seeds, the run warns and uploads them (with the colour and mountain reports) as the `refreshed-data` artifact for you to review and commit; the approved region colours are never replaced automatically. Repository secrets: `DATABASE_URL_WRITE` (required), `COMTRADE_API_KEY` (for gold trade; without it the step is skipped with a warning) and `NETLIFY_BUILD_HOOK` (optional).

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
| `GET /api/gold/countries?region=&q=&presence=&sort=&year=` | One row per country (54 without filters): presence tier with its evidence and source; mine production (tonnes or "included in other", basis, year, and the value computed at that year's average price); gold exports and imports as reported and as partners report them (mirror); central bank holdings (tonnes, value, share of reserves, 12-month change, month) and reporting status; gold's share of merchandise exports. Each figure is the latest in or before `year` (default: latest available) and carries its own year or date. `sort=production` (default), `exports`, `holdings`, `share`, `name`, each reversible with `-` (no data last) |
| `GET /api/gold/stats?region=&year=` | The ten statistics cards from `v_gold_stats()`, in the Harim stats shape: value, unit, as-of date, details, entities (ties listed) and definition. 503 until the gold data is loaded |
| `GET /api/gold/export?format=csv&<filters>` | The country table as CSV (all 54, or filtered like `/api/gold/countries`): a `#` block with the reference year, filters, notes (nominal US dollars, computed values, null vs zero vs "included in other"), each dataset's licence and the required attributions (IMF wording with the transformation statement, World Bank, UN Comtrade, USGS) |
| `GET /api/gold/price?from=&to=&granularity=month\|year` | The gold price series (World Bank monthly average, US$ per troy ounce), or annual averages |
| `GET /api/gold/countries/:iso3?year=` | One country's drawer: its table row at the reference year, production by year (with computed values), trade by year (reported and mirror) and its top export partners, central bank holdings (each year's last month), in-ground reserves, curated notes and every source with what it supports. Unknown or malformed codes are 404 |
| `GET /api/gold/series?metric=production\|exports\|imports\|holdings_tonnes\|holdings_usd&countries=&region=&from=&to=&granularity=` | Chart series, one per country, pre-aggregated in SQL; production adds Africa's (or the region's) yearly totals with their completeness. At most 12 countries per request and 6,000 points (larger requests drop the earliest periods and say `capped`) |
| `GET /api/gold/holdings-change?countries=&from=&to=` | For each country with two or more reports in the years, its first and last holding and the change in value split into price and volume effects (`gold_holdings_change`) |

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
- **Link previews:** the build writes a page shell for `/countries`, `/harim`, `/dhahabu` and every mountain and range page (`apps/web/build/pageShells.ts`, from the committed seeds) with that page's title, description and Open Graph tags, so shared links show the right text; Netlify serves them before the single-page fallback (as does `vite preview`). The preview images are `public/og/harim.png` (Harim and its pages), `og/dhahabu.png` and `og/site.png` (the site and `/countries`), all from `node scripts/build-og-images.mjs`.
- **Peak drawer:** a click on any mountain or summit opens it: height in both units with its confidence, the source of the height and every other sourced height, prominence, isolation, coordinates, range, type, massif and summits (each opens in the same drawer), local names and name origin with their sources ("Unsourced" otherwise), notes, the "Needs verification" reasons and all sources by field.
- **URL state:** `?view=country|peaks`, `region`, `q`, `sort`, `country`, `minHeight`, `volcanic`, `range` and `peak` (the open drawer). Invalid values are ignored; `view=ranges` shows the by-country view with a note until the ranges view arrives (milestone 12). Switching to By country drops the peak-only filters. A `country` in the URL filters to that country and opens its row (the link from other pages).
- **Units:** a metres/feet toggle, remembered in this browser (`bla-units`) and applied everywhere on the page. Below sea level uses a true minus sign (`−155 m`).
- **Data loading:** the 54 summary rows load with the page; the catalogue (about 340 mountains) loads once when a row is expanded or All peaks is opened, and is then filtered and sorted in the browser with the same meaning as the API's parameters (search also matches a massif's summit names, so "Kibo" finds Kilimanjaro).
- **Layout:** stacked cards below 720px. The tables are laid out to fit their panel from 720px up (a test checks 720, 900, 1024 and 1280px), so nothing is clipped and the page never scrolls sideways. The lowest point and relief columns show from 1280px, can be switched on from 1024px, and otherwise appear in the expanded row; All peaks is a compact list below 1024px.
- Loading skeletons, empty states with "Clear filters", and error states with "Retry".

## Dhahabu: the gold page

`/dhahabu` (`apps/web/src/features/dhahabu/`) covers, for each of the 54 countries, whether gold is found, how much is mined and traded, and how much central banks hold. It is the first page driven by the ribbon's year range.

- **Reference year:** the end of the ribbon's year range. Every card and table figure is the latest in or before it, and shows its own year or month (countries report on different schedules). With the full range the page shows the latest available figures, and the API gets no `year`. A note above the table says which applies.
- **Statistics band** (`GoldStatsBand.tsx`, from `/api/gold/stats`; definitions and tie rules in [docs/dhahabu-stats.md](docs/dhahabu-stats.md)): eleven glass cards, each with a year or month chip, the definition behind "How is this calculated?", count-up (none with reduced motion) and an action.
  - **Hero cards:** gold-producing countries (of 54, with a segmented bar and legend by presence tier), Africa's mine production (tonnes, share of world output, change from the previous year), its value (computed at that year's average price, labelled so) and the largest producer (with its share).
  - **Compact cards:** central bank gold held (tonnes and value, with how many countries report), the largest holder (value and share of its reserves), the gold price ("monthly average, not live", with the change on a year earlier), the most gold-dependent exporter, the biggest reporting gap (neutral wording: "not evidence of wrongdoing"), the largest net buyer over 12 months ("No net buyer" when no holding grew) and the price effect (how much of the 12-month change in the value of central bank gold came from the price, and how much from tonnes bought or sold; "See the holdings chart").
  - **Production uses the latest complete year:** a year counts for Africa only when the producers missing from it (nearest figure within three years) make up at most 5% of the total, so Africa's total is never a partial sum. With the current data that is 2021: the USGS chapters stop around 2021–2023, and later years cover only the producers the MCS names.
  - Actions: "Sort by production" or "Sort by holdings" sorts the table and scrolls to it; "Show the country" clears any search or presence filter hiding the country, then highlights its row and moves focus to it.
  - Layout: from 1280px the four hero cards, then the compact cards four to a row (the price effect takes two places, so the rows end evenly); 720–1279px three columns (the first card spans two, so four rows fill evenly); phones a scroll-snap carousel with dots. Long figures ("US$36.8 bn", "4.79 million oz") scale down to fit their card.
- **Country table** (from 1024px; `GoldTable.tsx`): flag, country with region chip, presence badge, mine production, gold exports, central bank gold and share of exports. A click on a row (or its name, the keyboard way) opens the country's drawer. The headers sort (production, exports, holdings and share largest first, name A–Z; again to reverse; no data always last).
  - "—" is no data, "0 t" a reported zero, and "incl. in other" a country the source lumps into "other countries". Estimates say "est."; computed values say "computed" with the price and year on hover or focus.
  - Exports without the country's own report show what partners report importing (labelled). Where there is no holding, the reporting status shows instead ("Pooled (BCEAO)", "Not reported"); a late or old report's month explains the delay on hover or focus.
  - The presence badge has an icon, a text label and a gold ramp from major producer to occurrences known, with neutral grey for none identified and hatched grey for unknown. It was checked for colour-blind vision in both themes. Hover, focus or tap shows its evidence, confidence, year and source.
- **Below 1024px:** one card per country with production and central bank gold first and "More figures" for exports and share, plus a Sort menu.
- **Filters:** region chips, search (accent-insensitive) and presence tier, with a count, "Clear filters", empty and error states. The region also rescopes the band ("All Africa" or the region chip). `?region=`, `?q=`, `?presence=`, `?sort=`, `?metric=` (the map) and `?country=` (the open drawer) live in the URL with the ribbon's `?from=&to=`, so every view is shareable.
- **Units:** tonnes, kilograms or troy ounces (1 t = 32,150.7466 troy oz, the shared constant), remembered in this browser (`bla-gold-units`). Money is nominal US dollars throughout.
- **"How to read this page":** reserves vs in-ground reserves, dates, no data vs zero, computed values, mirror trade, "none identified", and the price as a monthly average (not financial advice).
- **Export:** this view or all 54 countries as CSV from `/api/gold/export`, with the attribution block.
- **Map** (`map/GoldMap.tsx`): the shared Equal Earth base with a metric switch (mine production, central bank gold, gold exports by value, share of exports, presence; buttons, or a menu on phones).
  - Metric maps use a five-step sequential gold ramp (tokens `--gold-seq-1…5`, one hue, light to dark in light mode and dim to bright in dark mode, the faintest step at least 2:1 on the surface, checked with a palette validator). The classes hold about equal numbers of countries, computed from all 54 so a region filter dims rather than recolours. "No data" is a dotted neutral pattern and "included in other countries" a striped one, each in the legend with its count; no data is never drawn as a value.
  - The presence map uses the tier colours, with hatching for unknown. Small states get markers; Western Sahara is hatched as on the other maps.
  - Hover or focus shows a tooltip (flag, country, the figure and its year or month, or why there is none: partners' figures, a pooled reserve, inconsistent data). A click or Enter opens the drawer; one Tab stop and arrow keys move between countries, each named with its figure for screen readers. Hovering a table row outlines its country, and hovering a country tints its row. The table is the map's accessible equivalent, and the map links to it.
- **Charts** (`charts/`), all following the ribbon's range and the region filter, each with an icon, direct labels and "Show the data as a table":
  - **Africa's mine production and the gold price:** two panels sharing the year axis (never two y-axes): yearly production, partial years hatched and labelled, above the annual average price (the current year marked as the months so far). When the range starts before the production figures (2012), the chart starts two years before them and says so.
  - **Top gold producers:** the ten largest producers in the latest complete year in the range, in region colours, estimates starred, with tonnes and the computed value at that year's price on hover.
  - **Gold dependence:** gold's share of each country's merchandise exports (same year for both parts), top 15 and "Show all".
  - **Central bank gold holdings:** monthly lines for the five largest holders, in tonnes (in the chosen unit) or US dollars, in five validated categorical colours with direct labels and a legend; it starts at the first report (2000). Below it, **Price or tonnes?** picks a bank and shows, as a bridge from the start value to the end value, how much of the change came from the price and how much from tonnes bought or sold, from `/api/gold/holdings-change`.
- **Country drawer** (`GoldDrawer.tsx`; side panel, bottom sheet on phones): the key figures at the reference year; presence with its evidence, confidence, year and source; production by year with bars and computed values; trade by year (reported and what partners report, with the neutral note) and the top destinations; central bank gold (each year's last month); **in-ground reserves** in a separate dashed block, with a US dollar value labelled "illustrative at a given price, not a realisable sum"; artisanal mining; curated notes with their source and date; every source with its reliability tier and what it supports. "Country profile" opens the country on `/countries`, whose drawer links back ("Gold in …").


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

## Performance

The target is Lighthouse ≥ 90 on mobile for Performance, Accessibility, Best Practices and SEO on `/`, `/countries`, `/harim` and `/dhahabu` (`npm run lighthouse`).

- **Prerendered first views:** the build renders each main page's first view (the layout, header, controls and loading skeletons, before any data) into its HTML file: `npm run build` runs the client build, a server build of `src/entry-server.tsx` and `build/prerender.ts`. The page paints as soon as its CSS arrives instead of after the app's script has run.
- **Hydration, not a second render:** on a bare URL the app hydrates that markup (`hydrateRoot`, after loading the matched route's code-split module, `app/hydration.ts`), so the painted page is kept. The first browser render must therefore equal the prerendered one: anything the server cannot know (the screen, the theme, `<body>` portals) uses `useSyncExternalStore` with a server snapshot or `useIsClient`, and settles straight after hydration. A URL with a query (filters, an open drawer) renders afresh instead, since its first view differs. An e2e test fails on any hydration error.
- **The app starts after the first paint:** a prerendered page loads `/boot.js`, which imports the app's entry once the page has painted, so the styles and fonts get the connection first; each page links its route's stylesheets directly. Pages without prerendered markup (peak and range pages, any other path via `app.html`) load the app's module and preload their route's chunk in the usual way.
- **No layout shift:** the skeletons reserve the loaded cards' heights and choose carousel or grid in CSS; region chips show their names (`REGION_NAMES`, checked against the seed) with counts pending until the data arrives.
- **Payload:** routes are code-split; the map's context land loads after the countries; Material Symbols is subset to the icons used (≈24 KiB); fonts are self-hosted Latin subsets; API time series are capped and pre-aggregated in SQL; images have explicit dimensions; `flagcdn.com` is preconnected.
- **Measured** (`npm run lighthouse`, mobile, local production build, 2026-10-20): Performance 97 on all four pages, and 100 for Accessibility, Best Practices and SEO. LCP is 2.0–2.1 s, TBT under 100 ms and CLS under 0.04. Deployed figures should be at least as good: Netlify's CDN adds Brotli and HTTP/2.

## Quality checks

| Command | What it runs |
|---|---|
| `npm run check` | ESLint + Stylelint, `tsc -b`, Vitest, production build |
| `npm run lint` / `npm run typecheck` / `npm test` / `npm run build` | individually |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run check:functions` | Builds the Netlify Functions as a deploy does and checks each bundle loads and answers |
| `npm run e2e` | Playwright: desktop (1440×900) and mobile (390×844) projects; includes axe accessibility checks in light and dark mode and no-horizontal-scroll checks at 320px. It runs the **real API handlers** (`e2e/api-server.ts`) on an in-memory Postgres loaded with the committed seeds, proxied behind `vite preview`, so no Neon connection is needed |
| `npm run screenshots` | Captures every page at desktop and mobile, light and dark, into `screenshots/` (gitignored) for visual review |
| `npm run lighthouse` | Lighthouse (mobile) on `/`, `/countries`, `/harim` and `/dhahabu` against the production build (run `npm run build` first) and the local API; fails below 90 in any category; HTML and JSON reports in `lighthouse/` (gitignored) |
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
| `ENABLE_WGC_IMPORT` | local `.env` (default `false`) | reserved for an optional manual WGC import, not built while the WGC is not used |
| `NETLIFY_BUILD_HOOK` | GitHub Actions secret (optional) | data-refresh workflow |

Functions never hold write credentials, and no secret is ever exposed to the client bundle.

## Deployment (Netlify)

`netlify.toml` configures:

- the build: `npm run build`, publishing `apps/web/dist`
- functions from `netlify/functions`
- the `/api/*` → `/.netlify/functions/:splat` redirect and the SPA fallback (`/*` → `/app.html`, the plain app; `index.html` is the prerendered home page, and each page with a shell is served from its own `index.html` first)
- security headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP
- cache headers: one-year immutable for hashed assets, revalidate for HTML

The **Content-Security-Policy** is generated at build time into `dist/_headers` by `apps/web/build/securityHeaders.ts`. It allows exactly the inline theme-bootstrap script, by SHA-256 hash, and blocks every other inline script. A unit test keeps the hash in sync with `index.html`.

The build also writes `sitemap.xml` (every page with a shell) and a `robots.txt` that points to it, using the deploy's address (`URL`, or `DEPLOY_PRIME_URL` for previews); local builds have no address and skip the sitemap.

### From clone to deployed site

1. **Database (once):** create the Neon project, run `db/roles.sql` and set the connection strings as in [One-time Neon setup](#one-time-neon-setup).
2. **Data (once, then on schedule):** from your machine, with `DATABASE_URL_WRITE` and `COMTRADE_API_KEY` in `.env`, run `uv run python -m pipelines migrate`, then `uv run python -m pipelines load` (it loads the committed seeds; regenerate them first with the pipeline commands in [First run](#first-run) if you want fresh data). `uv run python -m pipelines status` shows each dataset's freshness.
3. **Netlify site (once):** `npx netlify login`, then `npx netlify init` in the repository (or create the site in the Netlify UI from the GitHub repository). The build settings come from `netlify.toml`, so leave the UI fields empty.
4. **Environment variables:** in **Site configuration → Environment variables**, add `DATABASE_URL_READ` (the `bla_reader` connection string), scoped to Functions. Nothing else belongs on Netlify: `DATABASE_URL_WRITE` and `COMTRADE_API_KEY` are pipeline secrets (local `.env`, GitHub Actions).
5. **Deploy:** push to the production branch (Netlify builds every push), or from your machine run `npx netlify deploy --build` for a draft URL and `npx netlify deploy --build --prod` for production.
6. **Check:** open the site and `/api/regions` (it should list five regions). Run Lighthouse on the deployed pages (PageSpeed Insights, or Chrome DevTools in mobile mode).
7. **Scheduled refresh:** in GitHub → Settings → Secrets and variables → Actions, add `DATABASE_URL_WRITE`, `COMTRADE_API_KEY` and (optional) `NETLIFY_BUILD_HOOK`. `.github/workflows/data-refresh.yml` then refreshes the data weekly and monthly, and triggers a rebuild when something changed.

**Deploy previews** work out of the box: every pull request gets its own URL, and its functions read `DATABASE_URL_READ`. To keep previews off production data, create a Neon branch for previews and set a different `DATABASE_URL_READ` for the **Deploy previews** context in the Netlify UI.

**Refreshing data by hand:** run the pipeline for a dataset (e.g. `uv run python -m pipelines gold-price`), review the seed diff, commit it, then `uv run python -m pipelines load`. The site reads the database at request time (cached for an hour at the CDN), so no rebuild is needed for data. Rebuild only when page shells or the prerender should change (new peaks or ranges).

**Adding a dataset or tab:** add the dataset's key to `DATASET_KEYS` and a label in `strings.datasets`, a migration for its tables, a pipeline command that writes a committed seed, and a `TableSpec` in the loader. For a new tab, add its route (lazy module) and `handle` in `app/router.tsx`, its navigation entry, a function per API route (registered in `netlify/tests/functionRoutes.ts`), and, to prerender it, an entry in `PRERENDERED` (`build/prerender.ts`) and `ROUTE_MODULES` (`build/pageShells.ts`).

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
- **Charts:** hand-written React SVG with small, tested scale and path helpers (no charting library, not even d3-scale). This keeps the bundle smaller, themes charts directly from CSS tokens, and gives full control of focus, ARIA and data-table fallbacks. The map uses d3-geo and d3-zoom.
- **Prerendered pages hydrate only on a bare URL:** a URL with a query (filters, an open drawer, a map metric) renders afresh over the prerendered markup, since its first view differs; the page still paints early. Peak and range pages are not prerendered (about 380 pages of mostly data): they keep their link-preview shells and render in the browser.
- **The app starts after the first paint** on prerendered pages (`public/boot.js`). On a slow connection the page is readable a little before it is interactive, in exchange for an early, stable first paint (and LCP).
- **Lighthouse locally:** `npm run lighthouse` serves the production build with `vite preview` and the seed-backed local API, so its figures are a floor for the deployed site rather than a measurement of it.
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
- **Dhahabu sources:** only sources usable without permission (owner's decision, 2026-10-18). The British Geological Survey's history is replaced by the USGS Minerals Yearbook country chapters, so production runs to 2021–2023 for most countries (the MCS adds 2024–2025 for the producers it names). The World Gold Council is neither used nor linked, the `wgc_import` adapter is not built, and figures the USGS itself attributes to the WGC (Sudan 2017–2021 in one edition) are left out.
- **Non-monetary gold** is HS 7108 minus 7108.20 (`hs_code = '7108.1'`); the specification's "7108 (non-monetary gold)" includes monetary gold.
- **Central bank holdings** are valued at each month's World Bank average price (`valuation = computed`); gold's share of reserves uses the IMF's own SDR values, so it needs no price. The eight BCEAO members have no national holding (reserves are pooled at the regional central bank).
- **Togo is a producer, not a major producer:** the USGS figure (about 20 t a year) is, in the USGS's words, exports that mostly include gold transiting Togo, so a cited override downgrades it (owner's decision, 2026-10-18).
- **Notes avoid allegations:** profile notes leave out claims about smuggling or armed groups even where a cited source makes them; they cover artisanal mining, policy, mines and discoveries.
- **No mines layer yet:** Wikidata's gold mines fail the quality bar (coverage, operating status, South Africa's share), so the table stays empty and the report lists why.
- **Dhahabu production year:** Africa's production cards use the latest complete year (2021 with the current data), not the newest year with any figure, so the total is never a partial sum. The table still shows each country's newest figure.
- **Dhahabu below 1024px uses cards:** the table has seven columns of dated figures, which do not fit narrower panels without clipping; cards show the key figures first (production and holdings) and the rest on request.
- **Price effect split:** price effect = (P₁ − P₀) × troy ounces at the average of the two holdings; volume effect = the rest of the change. Averaging makes the split independent of which effect is counted first, and taking the volume effect as the remainder makes the two sum exactly to the change, so rounding never breaks it. The 11th card and the holdings chart use the same SQL function.
- **Dhahabu band layout:** with eleven cards, the specification's two-row layout (four hero cards over the compact cards in one row) would squeeze seven compact cards into one row; from 1280px the compact cards go four to a row instead.
- **Dhahabu charts start at their data:** production figures start in 2012 and holdings reports in 2000, so with the default range (from 1960) those charts start at their data rather than show decades of empty axis; the price stays in step with production on the shared axis. The range's end always applies.
- **Production and price as bars and a line:** the production panel shows Africa's total (not stacked by country) so partial years can be marked clearly; the top-producers chart carries the breakdown.
- **Map classes:** quantile classes (about equal numbers of countries) rounded to two significant figures, since production and reserves span four orders of magnitude.
- **Latest URL for quick changes:** view changes (filters, sort, metric, drawer, range) build on the live URL rather than the last render's, so two quick changes cannot bring back a cleared filter (found by an intermittent e2e failure on Harim's ranges view; fixed on every page).
- **Central bank gold held** counts countries whose latest report is within 12 months of the newest month, values them all at the newest month's price, and says how many are late, pooled or not reported.
- **Largest net buyer** is given to 0.001 t (the precision of the IMF series), so the headline and its detail always agree.
- **No mines endpoint or layer:** `/api/gold/mines` and the map's mines toggle are not built while the mines data fails the quality bar (the drawer has no "major mines" section for the same reason). No "Explore on Goldhub" links (owner's decision).
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
13. ✅ Dhahabu source and licence check ⏸ ([docs/dhahabu-sources.md](docs/dhahabu-sources.md); decided 2026-10-18)
14. ✅ Dhahabu data ⏸ ([coverage matrix](data/gold_coverage_matrix.md), [review report](data/gold_review_report.md); reviewed 2026-10-18)
15. ✅ Dhahabu API, table, band and live ribbon ⏸
16. ✅ Dhahabu map, charts and drawer
17. ✅ Polish, Lighthouse and deployment (prerender, Lighthouse ≥ 90, deployment guide; the first deploy waits for the owner's Netlify login)

**Not in v1:**

- **Dhahabu:** gold demand, jewellery and investment flows (including ETFs); company-level production and ownership data; artisanal-mining formalisation and responsible-sourcing indicators; a standalone page per country; inflation-adjusted values. Forecasts and investment advice will never be added.
- **Harim:** glaciers and volcanic activity (v1.1, after a data assessment); protected areas and UNESCO World Heritage mountain sites; an elevation-zones infographic; a west-to-east skyline chart; hillshade or 3D terrain; a "which is taller?" quiz; peak photos, climbing routes and first-ascent history.
- **General:** historical timelines; contemporary indicators (via a future `indicators` / `observations` time-series model); user accounts; a CMS; multi-language content; long-form search; offline/PWA support.

## Credits and licences

Credits are shown in the site footer and in data exports, including the attribution wording required by GeoNames (CC BY 4.0) and the IMF. Sources: the project's state-symbology research document, Natural Earth, Flagpedia, Material Symbols (Apache 2.0), Fraunces and Instrument Sans (SIL OFL 1.1), Wikidata (CC0), GeoNames (CC BY 4.0), the CIA World Factbook's final edition (public domain), Wikipedia (CC BY-SA 4.0, cited per item), the Harim prototype, the IMF, USGS, the World Bank and UN Comtrade. The Smithsonian Global Volcanism Program is linked for reference only; none of its data is republished. The British Geological Survey and the World Gold Council are neither used nor linked (owner's decision, 2026-10-18).

Boundaries are shown as published by Natural Earth and do not imply endorsement of any border or territorial claim.
