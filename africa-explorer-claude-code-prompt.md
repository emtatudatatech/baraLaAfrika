# Claude Code Prompt: Bara La Afrika, v1

> Working name: **Bara La Afrika**.

---

## 0. How I want you to work

You are building v1 of a long-running project about uncovering, learning and understanding Africa from historical and contemporary perspectives. v1 is the foundation: a beautiful, responsive web app that presents (a) the attached research on the symbology of all 54 African states, (b) **Harim**, a tab on Africa's mountains and their heights per country, and (c) **Dhahabu**, a tab on gold across Africa (deposits, mining, trade and reserves), on top of an architecture that later modules (history timelines, contemporary indicators, etc.) can plug into without rework.

1. **Start in plan mode.** Read this whole prompt and the source PDF, then present a short plan (architecture, repo layout, milestones, and any decisions you are taking where I was ambiguous). Don't ask me more than 3 questions. Make sensible defaults and list them.
2. Work in **milestones** (section 12). After each milestone, summarize what has been achieved for me to commit. You can provide a clear message for each commit. After each milestone, run lint, type-check, tests and a production build, and fix failures before moving on.
3. **Verify visually**. Use Playwright to screenshot the landing page, the countries tab, the Harim tab and the Dhahabu tab at desktop (1440×900) and mobile (390×844), in light and dark mode. Look at the screenshots and fix problems (contrast, overflow, clipped tooltips) before declaring done.
4. Never hard-code secrets. Provide `.env.example`. If you need credentials (Neon `DATABASE_URL`), stop and tell me exactly what to set and where.
5. At the end, give me: what was built, how to run it locally, how to deploy it, the decisions you made, and anything you could not verify.
6. Ensure that the README captures everything you've done and what is required for a project README in a neat organized way.

---

## 1. Product scope for v1

**Landing page (`/`)**: an interactive map of Africa, country boundaries visible, rendered in the **Equal Earth projection**, with countries coloured by region (section 7.1) and a region legend.

**First tab after the landing page (`/countries`)**: all 54 African countries in a table, with a region filter, presenting the research document's content (section 7.2).

**Second tab (`/harim`)**: **Harim**, the mountains of Africa. It opens with a **band of summary-statistics cards**, then a **table summarising the mountains and their heights per country**, followed by a **geographic map** that presents the same data visually, plus a small ranking chart. Sub-views cover mountain ranges and individual peak pages. It upgrades my prototype (section 7.5). The tab shares the region colours, flags, theme, ribbon and API conventions of the rest of the app.

**Third tab (`/dhahabu`)**: **Dhahabu**, gold in Africa. For each of the 54 countries it covers whether gold deposits are present, how much gold is mined and traded (volume and value), and how much gold is held in reserve (volume and value in USD), plus useful context statistics. It opens with a band of summary cards, then a country table, a map with a metric switcher, and charts. It is the first page driven by the **ribbon's date range** (section 7.4), because its data is genuinely time-series. See 7.6.

Everything else (history, contemporary data, etc.) is **out of scope for v1**, but the navigation, data model, ribbon and API must make it easy to add. Show those future sections in the nav as disabled "Coming soon" items so the shape of the product is clear.

Nav order: **Home · Countries · Harim · Dhahabu · (disabled: History, Contemporary Africa)**.

---

## 2. Tech stack (fixed)

| Concern | Choice |
|---|---|
| Frontend | React + Vite, TypeScript (strict), React Router |
| Styling | Plain CSS with design tokens (CSS custom properties) + CSS Modules per component. No Tailwind, no CSS-in-JS. |
| Backend / API | Netlify Functions (Node, TypeScript), thin and typed, input validation with `zod` |
| Database | Postgres on **Neon**, accessed from functions via `@neondatabase/serverless` |
| Data pipelines | **Python 3.15** (`pipelines/`), managed with `uv`; `psycopg` for DB writes |
| Deployment | **Netlify** (static site + functions), `netlify.toml` |
| Map | `d3-geo` (`geoEqualEarth`), `d3-zoom`, `topojson-client`, boundaries from Natural Earth |
| Charts | React SVG components built on `d3-scale` / `d3-shape` (or `visx`). Your call; justify it in the plan. Charts must be themeable, accessible and keyboard-focusable. |
| Icons | Google **Material Symbols** (see 8.3) |
| Tests | Vitest (unit), Playwright (e2e, desktop + mobile projects), pytest (pipelines) |
| CI | GitHub Actions: lint, type-check, test, build; plus the scheduled pipeline job (section 5.4) |

Use current stable versions of everything at build time. Check before assuming APIs.

**Hard requirement: genuinely separated files.** Real component files (`Component.tsx` + `Component.module.css`), real `index.html`, real modules. No single-file app, no build-time retrofit script that stitches things together, no inline mega-`<style>` blocks.

---

## 3. Repository layout

```
/
├─ apps/web/                     # React + Vite
│  ├─ index.html
│  ├─ public/                    # favicon, og image, self-hosted flag fallbacks, topojson
│  └─ src/
│     ├─ app/                    # router, providers, layout shell
│     ├─ features/
│     │  ├─ map/                 # AfricaMap, MapLegend, CountryPopover, hooks
│     │  ├─ countries/           # CountriesTable, RegionFilter, FlagCell, CountryDrawer
│     │  ├─ harim/               # HarimPage, StatsBand (StatCard), MountainSummaryTable, MountainMap, PeakMarker, PeakPopover,
│     │  │                       # HeightChart, RangesView, RangePage, PeakPage, ExportMenu, hooks
│     │  ├─ dhahabu/             # DhahabuPage, GoldStatsBand, GoldCountryTable, GoldMap, GoldDrawer,
│     │  │                       # TopProducersChart, ProductionPriceChart, HoldingsChart, hooks
│     │  └─ coverage/            # DataRibbon, TimeRangeContext
│     ├─ components/             # GlassCard, IconButton, Icon, ThemeToggle, Tooltip, Skeleton…
│     ├─ styles/                 # tokens.css, glass.css, base.css, themes
│     ├─ lib/                    # api client, formatting, a11y helpers
│     └─ types/
├─ netlify/functions/            # regions.ts, countries.ts, country.ts, coverage.ts, mountains.ts, mountain-summary.ts, mountain-stats.ts, mountain-ranges.ts, mountain-export.ts,
│                                  #   gold-countries.ts, gold-stats.ts, gold-series.ts, gold-price.ts, gold-export.ts, _shared/
├─ db/migrations/                # numbered .sql files
├─ db/seeds/                     # generated JSON/SQL seeds (committed, reviewable)
├─ pipelines/                    # Python
│  ├─ africa_pipelines/          # package: extract_pdf.py, flags.py, boundaries.py, region_colors.py, load.py, runs.py,
│  │                             #          mountains_baseline.py, mountains_wikidata.py, mountains_geonames.py, mountains_reconcile.py,
│  │                             #          country_low_points.py, mountain_hierarchy.py, mountain_names.py,
│  │                             #          gold_price.py, gold_production.py, gold_reserves.py, gold_trade.py, gold_presence.py,
│  │                             #          gold_mines.py, gold_profiles.py, wgc_import.py (disabled by default, see 5.6)
│  ├─ tests/
│  └─ cli.py                     # `python -m pipelines <command>`
├─ data/source/                  # the PDF + raw/cached downloads (gitignored where large)
├─ .github/workflows/
├─ netlify.toml
├─ .env.example
└─ README.md
```

---

## 4. Database design (Neon Postgres)

Write plain SQL migrations (`db/migrations/0001_*.sql`…) and a small runner (`python -m pipelines migrate`). Use `snake_case`, `timestamptz`, foreign keys, sensible indexes, and `CHECK` constraints / enums where values are closed sets. For each table, you can also add comments on each table and column created.

Core tables:

- `regions` — `id`, `slug`, `name`, `description`, `color_hex` (computed, section 5.2), `sort_order`
- `countries` — `id`, `iso2`, `iso3`, `iso_numeric`, `name`, `official_name?`, `region_id`, `flag_url_template`, `centroid_lon`, `centroid_lat`, `is_microstate_marker boolean`
- `country_profiles` (1:1 with countries). Store **both** a short value for table cells and a long value for detail views:
  - `etymology_summary`, `etymology_detail`, `etymology_category` (nullable enum: `geographic_feature | ethnic_group | kingdom_or_ruler | colonial_or_translation`)
  - `flag_design_summary` (the short text from the document's tables, used in tooltips), `flag_design_detail` (the prose description)
  - `national_symbol_summary`, `national_symbol_detail`
  - `national_animal_name`, `national_animal_scientific?`, `national_animal_detail`
  - `animal_status` enum: `official | de_facto | inferred | sports_nickname | contested`
  - `needs_review boolean default false`, `review_notes text`
- `flag_palette` — `country_id`, `hex`, `area_share` (so region colours are reproducible and auditable)
- `sources` — `id`, `ref_no` (the numbered citation in the PDF), `title`, `url`, `source_type`, `reliability_tier` (`primary | reference | secondary | low`)
- `country_sources` — `country_id`, `source_id`, `field`
- `datasets` — `id`, `key`, `name`, `provider`, `license`, `attribution`, `coverage_start date?`, `coverage_end date?`, `as_of date`, `last_refreshed_at`, `refresh_cadence`
- `ingestion_runs` — `id`, `dataset_id`, `started_at`, `finished_at`, `status`, `rows_upserted`, `log`

Create two DB roles in the migration notes: a **read-only role** for Netlify Functions and a **write role** used only by pipelines. Functions must never hold write credentials.

Document the extension path (don't build it): future `indicators` and `observations (country_id, indicator_id, date, value)` tables for time-series data.

### 4.2 Harim tables (mountains)

A mountain can sit on a border, so use a junction table rather than a single `country_id`.

- `mountain_ranges` — `id`, `slug`, `name` (e.g. Atlas, Rwenzori, Virunga, Drakensberg, Simien, Tibesti, Hoggar/Ahaggar, Eastern Arc), `range_type` (nullable enum: `volcanic | fold | rift_shoulder | massif | plateau_escarpment | other`), `description`
- `mountains` — `id`, `slug`, `name`, `alt_names text[]`, `range_id?`, `elevation_m int` (the **chosen** value), `elevation_source_id`, `elevation_confidence` (`high | medium | low`), `elevation_alternatives jsonb` (other sourced values, e.g. `[{"m":4566,"source":"…"},{"m":4562,"source":"…"}]`), `latitude`, `longitude`, `peak_type` (nullable enum: `stratovolcano | shield_volcano | volcano | massif | peak | other`), `volcanic_status` (nullable: `active | dormant | extinct`), `prominence_m?`, `isolation_km?`, `summit_kind` (enum: `standalone | massif | summit`), `parent_id?` (self-reference: a `summit` points to its `massif`; two levels only), `local_names jsonb` (e.g. `[{"name":"Kibo","language":"Swahili"}]`), `name_origin text?`, `name_origin_source_id?`, `notes`, `wikidata_qid?`, `geonames_id?`, `territory_name?` (set for non-sovereign places such as Réunion), `needs_review`, `review_notes`
- `mountain_countries` — `mountain_id`, `country_id`, `is_country_high_point boolean`, `is_shared boolean` (peak lies on a border, so it appears under each country)
- `mountain_sources` — `mountain_id`, `source_id`, `field`
- `country_low_points` — `country_id`, `name`, `elevation_m int` (can be **negative**: below sea level), `latitude`, `longitude`, `feature_type` (e.g. `depression | lake | coast | other`), `source_id`, `wikidata_qid?`, `needs_review`. One row per country (coast-level countries get 0 m, "sea level", with the feature named as such).
- `mountain_ranges` also gets `length_km?` and `formation_note text?` (short, sourced; `needs_review` if unsourced).

Constraints: `elevation_m` between 0 and 6000; coordinates within Africa's bounding box (including Indian and Atlantic Ocean island states); exactly one `is_country_high_point` per country (deferrable constraint or a validation check in the pipeline); `summit` rows must have a `parent_id` that points to a `massif`, no cycles; a `massif`'s `elevation_m` equals its highest summit's. **Counting rule used everywhere:** a "mountain" is a `standalone` or `massif` row; `summit` rows are parts of a massif and are never counted as separate mountains. Peaks shared between countries count once. Territory peaks are counted separately.

A **view** `v_country_mountain_summary` returns, per country: `highest_peak_name`, `highest_peak_m`, `peak_count`, `mean_peak_m`, `range_names`, whether the high point is shared, `lowest_point_name`, `lowest_point_m`, and `relief_m` (highest minus lowest). The summary table is built from this view, not recomputed in the browser.

A second **view or SQL function** `v_harim_stats(scope_region)` computes every statistic behind the summary cards (7.5.1) in one place, so the definitions live in the database, are testable, and respect the counting rule above.

### 4.3 Dhahabu tables (gold)

These are **time-series** tables: every row carries its own year or date, and the API serves ranges so the ribbon's date control works.

- `gold_price_monthly` — `month date`, `usd_per_troy_oz numeric`, `source_id`. A view `v_gold_price_annual` gives the annual mean and the year-end value.
- `country_gold_profiles` — `country_id`, `presence_tier` (enum: `major_producer | producer | occurrences_known | none_identified | unknown`), `presence_basis text` (the evidence), `presence_confidence` (`high | medium | low`), `presence_as_of_year`, `commercial_mining boolean?`, `asm_present boolean?` (artisanal and small-scale mining), `asm_share_pct_estimate numeric?` with `asm_source_id?`, `summary text`, `needs_review`, `review_notes`
- `gold_production_annual` — `country_id`, `year int`, `tonnes numeric`, `basis` (enum: `reported | estimate | included_in_other`), `source_id`, `notes`. Unique on (`country_id`, `year`, `source_id`). A view `v_gold_production` picks the preferred source per country-year (priority list in config) and **computes** `value_usd = tonnes × 32,150.7466 × annual mean price`, with `value_is_computed = true`.
- `gold_trade_annual` — `country_id`, `year`, `flow` (`export | import`), `hs_code` (default `7108`, non-monetary gold), `net_weight_kg numeric?`, `value_usd numeric`, `basis` (enum: `reported | mirror`), `source_id`. "Mirror" rows are what trading partners report importing from (or exporting to) that country, kept so the gap with the country's own reports can be shown.
- `gold_trade_partners` — `country_id`, `year`, `flow`, `partner_name`, `partner_iso3?`, `value_usd`, `basis`, `rank` (top 10 per country-year-flow).
- `country_total_exports_annual` — `country_id`, `year`, `value_usd` (merchandise exports, to compute gold's share).
- `gold_official_reserves` — `country_id`, `as_of date` (month or quarter end), `tonnes numeric`, `value_usd numeric`, `pct_of_total_reserves numeric?`, `valuation` (enum: `market | national | computed`), `source_id`. These are **central bank holdings**.
- `gold_inground_reserves` — `country_id`, `year`, `tonnes_contained numeric`, `definition text`, `source_id`. These are **geological reserves** (gold still in the ground that is economically extractable by a given source's definition). This is a different concept from central bank holdings and must never be mixed with them.
- `gold_mines` (optional layer) — `id`, `name`, `country_id`, `latitude`, `longitude`, `status`, `operator?`, `wikidata_qid?`, `source_id`, `needs_review`.

**Conventions (enforce in code and tests):** tonnes means metric tonnes of fine gold; 1 tonne = 32,150.7466 troy ounces, defined as a single constant and unit-tested; all money is **nominal USD** (label it so); **`NULL` means no data, `0` means a reported zero, and a country lumped into a source's "other countries" row is `included_in_other` with null tonnes. Never coerce one into another.** Views `v_gold_country_latest` (the latest value of each metric per country, each with its own year or date) and `v_gold_stats(scope_region, as_of_year)` (all summary cards, 7.6.1) hold the definitions in the database.

---

## 5. Data pipelines (Python)

All pipelines are **idempotent** (upserts keyed on natural keys), log to `ingestion_runs`, update `datasets.last_refreshed_at`, and are runnable locally via `python -m pipelines <command>` and in CI.

### 5.1 `extract-pdf`: from the research PDF to structured seed data
- Parse `data/source/africa-state-symbology.pdf` (try `pdfplumber`/`pymupdf`). The per-country **prose paragraphs** are the richest source; the regional **summary tables** wrap badly in extraction, so use them for the short `*_summary` fields and cross-check against prose.
- Strip the stray citation numerals that follow sentences in the PDF text (e.g. "…of Ptah, … 4"). Preserve them as `ref_no` links to `sources` instead of leaving them in the text.
- Region assignment follows **the document's grouping** (it is the project's source of truth): North 6, West 15, Central 9, East 16, Southern 8 = **54**. Note that this differs from UN geoscheme in places (e.g. Mauritania is North, Sudan is East, Chad and Angola are Central). Keep this as data so it can be changed later.
- Output `db/seeds/countries.json` and `db/seeds/sources.json`. Add a **validation step** that fails loudly unless: 54 countries, region counts 6/15/9/16/8, unique ISO codes, every country has all summary fields, no leftover citation digits in text.
- Emit `data/review_report.md` listing everything flagged `needs_review` (see section 11).

### 5.2 `flags`: Flagpedia assets and region colours
- Flagpedia's CDN is `flagcdn.com` (e.g. `https://flagcdn.com/ke.svg`, `https://flagcdn.com/w320/ke.png`). Use Flagpedia's African list (https://flagpedia.net/continent/africa) as the cross-check for which flags to fetch. Cache SVGs locally and copy them to `apps/web/public/flags/` as an offline/fallback copy.
- **Region colour = the mode colour across all flags in that region.** Algorithm (implement exactly, and make parameters configurable):
  1. Rasterize each flag SVG at ~320px width (`cairosvg` + Pillow).
  2. Convert pixels to CIELAB; cluster each flag into ≤8 colours; merge clusters across flags whose ΔE₂₀₀₀ < 10.
  3. For each region, sum pixel area per merged colour across all its flags. The highest total is the region's mode colour.
  4. **Default: exclude achromatic colours** (white, black, greys — low chroma) from the ranking, because white/black would win in most regions and are unusable as map fills. Make this a flag (`--include-neutrals`) and **report both results**.
  5. **Uniqueness:** if two regions' winners are within ΔE < 20, give the tie to the region where that colour has the larger share and move the other to its next-ranked colour.
  6. Store the per-flag palettes in `flag_palette` and the winners in `regions.color_hex`.
- Write `data/region_colors_report.md` (and print it) with, per region, the top 5 candidate colours with swatches, their area share, and the final pick. I will review it, so make the output easy to read. **Do not silently "improve" the colours** (no manual tweaking). If the strict result is a problem, say so in the report.

### 5.3 `boundaries`: map geometry
- Source: Natural Earth admin-0 countries at **50m** (e.g. via `world-atlas` `countries-50m.json`), filtered to Africa, processed into a lean TopoJSON in `apps/web/public/geo/africa.topo.json` (plus a muted "context" layer for neighbouring land). Record version and license in `datasets`.
- Join to `countries` by ISO numeric / alpha-3. **Beware `-99` ISO codes** in Natural Earth (e.g. Somaliland); handle explicitly.
- **Edge cases to handle deliberately:**
  - *Somaliland* → styled as Somalia (the document covers 54 recognised states).
  - *Western Sahara* → not one of the 54; render with a neutral hatched fill and tooltip "Disputed territory".
  - *Island and micro-states* (Cabo Verde, São Tomé and Príncipe, Comoros, Mauritius, Seychelles; also check Eswatini, Lesotho, The Gambia) may be tiny or missing at some resolutions. Add circle **markers** (`is_microstate_marker`) so they are visible and clickable on the map.
  - Add a footer note on the map: boundaries are shown per Natural Earth and do not imply endorsement of any border claim.

### 5.4 `load` and scheduling
- `python -m pipelines load` upserts regions, countries, profiles, sources, palettes and datasets.
- Netlify scheduled functions are Node-only, so schedule the Python refresh with a **GitHub Actions cron** workflow (weekly) and `workflow_dispatch`. It reads `DATABASE_URL_WRITE` from repo secrets. On a data change, it triggers a Netlify build hook (if `NETLIFY_BUILD_HOOK` is set).
- Add `python -m pipelines status` to print the freshness of every dataset.

### 5.5 Mountains (Harim)

**Goal:** a dataset covering **every one of the 54 countries**, with at least each country's **highest point**, plus the notable peaks and ranges that make the map worth exploring. My prototype only covers about 30 countries, so the pipeline must expand it.

1. **`mountains-baseline`**: clone/fetch my repo `https://github.com/emtatudatatech/harim` (public). It contains `README.md` and `harim.html`. The data is a JS array `mountainsData` inside `harim.html` (38 entries with `name, country, height, lat, long`; shared peaks are written as `"Uganda / DRC"`). The README separately lists 15 peaks, including several Rwenzori peaks (Stanley, Speke, Baker, Emin, Gessi, Luigi di Savoia) that the HTML does not contain. Parse both, take the **union**, de-duplicate, split `"A / B"` country strings into `mountain_countries` rows with `is_shared = true`, split names like `"Jebel Toubkal (Atlas Mountains)"` into peak name + range, and map country names to ISO codes (e.g. "Cape Verde" → Cabo Verde, "DRC" → Democratic Republic of the Congo). Treat this as the **curated baseline**: it wins ties on *which peaks exist*, but not automatically on *heights* (see 11.2).
2. **`mountains-wikidata`**: query the Wikidata SPARQL endpoint for mountains/volcanoes/peaks located in each of the 54 countries (with elevation, coordinates, range, QID), and for each country's "highest point" (property P610). Respect rate limits, send a descriptive User-Agent, cache raw responses under `data/raw/`.
3. **`mountains-geonames`** (optional enrichment): GeoNames dump filtered to feature class `T` (mountain, hill, volcano) for African countries to fill gaps and cross-check elevations. GeoNames is CC-BY, so record attribution.
4. **`mountains-reconcile`**:
   - Match records across sources by QID/GeoNames ID, then by normalised name + distance (< ~5 km).
   - Elevation selection: prefer the source with the highest `reliability_tier`; keep all other values in `elevation_alternatives`. If values disagree by more than **10 m**, set `needs_review = true` and list it in `data/mountains_review_report.md`. If they disagree by more than 50 m, mark confidence `low`.
   - Guarantee **one high point per country**. If a country has none, fail the pipeline with a clear message naming the country rather than guessing.
   - Cap the catalogue to something curated and legible: always include every country high point and every peak above **3,000 m**; include up to ~8 further notable peaks per country. Make the thresholds config values.
   - Territories (e.g. Réunion's Piton des Neiges, Mayotte, Canary Islands, Madeira, St Helena) are **not among the 54**. Load them with `territory_name` set and no `is_country_high_point`, show them on the map with a distinct neutral marker, and keep them out of the per-country summary table (list them in a collapsed "Territories" group under it).
5. **`country-low-points`**: for each of the 54 countries, fetch the lowest point (Wikidata's "lowest point" property; look up the current property ID rather than assuming) with elevation and coordinates. Examples to expect from data: Lake Assal (Djibouti), the Qattara Depression (Egypt), the Danakil Depression (Ethiopia). Coastal countries with no depression get 0 m "sea level". Landlocked countries need a real named feature. Anything missing or implausible (low point above the high point, or an unexplained value) goes to the review report.
6. **`mountain-hierarchy`**: model **massif → summit** (two levels only). Examples: Kilimanjaro (massif) → Kibo, Mawenzi, Shira; Mount Kenya (massif) → Batian, Nelion; each of the six Rwenzori "mountains" in my README (Stanley, Speke, Baker, Emin, Gessi, Luigi di Savoia) is really a **massif** with its own summits (Stanley → Margherita, Alexandra…) inside the Rwenzori **range**. Resolve my prototype's mixed naming this way (Mount Stanley vs Margherita Peak; Kilimanjaro vs Kibo). Derive each massif's elevation from its highest summit. Also pull **prominence** (and isolation where available) from Wikidata; leave null rather than guess.
7. **`mountain-names`**: curate a seed file `db/seeds/mountain_names.json` of **local names and name origins** for at least every peak above 4,000 m and every country high point where a reliable source exists (e.g. Kirinyaga for Mount Kenya, Ol Doinyo Lengai as "Mountain of God"). Name origins are easy to get wrong, so every entry needs a cited source; entries without one are loaded with `needs_review = true` and shown with a "needs verification" marker. Never invent an etymology.
8. Output `db/seeds/mountains.json`, `db/seeds/mountain_ranges.json`, `db/seeds/country_low_points.json`, and the review report. Add the datasets (`mountains-baseline@<commit sha>`, Wikidata snapshot date, GeoNames dump date) to `datasets` so the ribbon can display their "as of" dates.
9. Validation, failing loudly: all 54 countries have a high point **and a low point** (and low < high); every `summit` has a valid massif parent with no cycles; massif elevation equals its highest summit; no mountain is counted twice in a stat (a massif and its own summit, or a shared peak under two countries); no duplicate slugs; coordinates fall inside or very near the country (point-in-polygon check against the Natural Earth boundaries, with a tolerance for border peaks and a warning for island states); elevations are sane; shared peaks appear under every country they belong to.

### 5.6 Gold (Dhahabu)

**Source policy (read this first).** You'll find the World Gold Council's Goldhub (`gold.org`) tempting, but **do not scrape it or republish its data.** Its terms limit use of site content to personal, non-commercial purposes, prohibit scraping and other automated access, require written permission for republishing or commercial use, and its data dashboard and downloads sit behind a login. Its central bank reserves data is itself compiled from the IMF's International Financial Statistics, so go to the IMF directly. Use `gold.org` for **methodology reference and "Explore on Goldhub" deep links** only. Provide an optional manual adapter `wgc_import.py` that reads XLSX files **I download myself** into `data/source/wgc/`, and keep it **off by default** (`ENABLE_WGC_IMPORT=false`); I will turn it on only if I get written permission. Re-read every source's current terms at implementation time, record licence and attribution in `datasets`, write `docs/dhahabu-sources.md` (what each source provides, access method, licence, required attribution, rate limits, update cadence), and **stop and show it to me before building on it** (milestone 13). I'm not asking you for legal advice; flag anything unclear.

All pipelines follow the conventions in section 5 (idempotent, logged, cached raw responses, descriptive User-Agent, polite rate limits, no bulk crawling).

1. **`gold-price`**: World Bank commodity price data (monthly gold, US$ per troy ounce) into `gold_price_monthly`; fall back to the IMF primary commodity prices if needed. Do not pull LBMA data directly (its redistribution is restricted). Verify the licence of whichever series you use. The price is a **monthly average, not a live spot price**; label it that way everywhere.
2. **`gold-production`**: gold mine production by country from the USGS Mineral Commodity Summaries (look for the ScienceBase data release or CSV first; otherwise parse the tables from the published PDF) for the latest editions, plus the British Geological Survey's World Mineral Statistics for longer history (check the licence; it has historically been the Open Government Licence). The same USGS tables give **in-ground reserves** for the countries it lists, which go to `gold_inground_reserves`. Countries that the source lumps into "other countries" are stored as `included_in_other` with null tonnes. **Never write 0 for them.**
3. **`gold-official-reserves`**: central bank gold holdings from the IMF's International Financial Statistics via the **current IMF data portal API**. Look up the live endpoint and series codes rather than assuming them (the IMF has moved its data platform). Fetch gold holdings (volume and value) and total reserves for the 54 countries, with targeted calls only. Convert fine troy ounces to tonnes where needed, compute `pct_of_total_reserves`, and where the source gives no USD value compute it at that date's price and mark `valuation = computed`. IMF terms require the attribution wording "Source: International Monetary Fund, <Database Name>, <link to the dataset>" and an explicit statement when data has been materially transformed; automated bulk downloading is prohibited without permission, so keep calls targeted and cached. Show clearly which countries report late or irregularly.
4. **`gold-trade`**: UN Comtrade, HS heading 7108 (non-monetary gold), annual. For each African country fetch **exports and imports as reported by that country** (USD and net weight), the **top 10 partners**, **total merchandise exports** (for gold's share), and the **mirror**: what partner countries report importing from each African country. Use a free Comtrade API key from `COMTRADE_API_KEY` (I will provide it). Free tiers are rate-limited, so spread requests across runs and resume from cache. Record `basis = reported` or `mirror`. Large gaps between the two are normal and informative; they are not an error.
5. **`gold-presence`**: classify every country into a `presence_tier` **with evidence**. Default rules, all configurable: `major_producer` if production is at least 20 t in the latest year; `producer` if above 0 t reported; `occurrences_known` if there is no reported production but a cited source (a national geological survey, USGS, or peer-reviewed work) documents gold occurrences, artisanal mining or exploration; `none_identified` if the sources consulted show nothing; `unknown` if there is not enough information. Store the evidence and a confidence level for each. The UI must say **"No significant gold deposits identified in the sources consulted"**, never "no gold". Curated overrides go in `db/seeds/gold_presence_overrides.json`, each with a citation; anything unsourced is `needs_review`.
6. **`gold-mines`** (optional map layer): Wikidata entries for gold mines and deposits with coordinates, plus curated additions for the largest operating mines. Keep the layer only if coverage and quality are acceptable, and list what you dropped and why.
7. **`gold-profiles`**: short factual notes per country (significance of artisanal mining, national gold purchase or reserve policies, major discoveries or export bans), each with a cited source and date; anything else is `needs_review`. **No unsourced allegations about governments, companies or individuals**, especially about smuggling or illicit flows. Either attribute a claim precisely to a named report ("estimated by …") or leave it out.
8. **Schedule:** price and reserves monthly; production and trade when new annual editions are released. Use GitHub Actions cron plus `workflow_dispatch`, and update `datasets.as_of`, `coverage_start` and `coverage_end` on every run so the ribbon is accurate.
9. **Validation, failing loudly:** every country has a `presence_tier`; no negative tonnes; no producer-tier country without production evidence; **every USD value uses the price for its own year or date** (fail if the price is missing, never fill it); the tonne/ounce constant is used from one place; and mismatches are listed instead of fixed silently. Emit `data/gold_coverage_matrix.md` (country × metric, with the years available) and `data/gold_review_report.md` (conflicts such as production versus presence tier, trade versus production, reserves tonnes versus value, late reporters, lumped countries).

---

## 6. API layer (Netlify Functions, Node + TS)

Routes via `netlify.toml` redirect `/api/*` → `/.netlify/functions/:splat`. All JSON, typed with shared types, validated with `zod`, consistent error shape `{ error: { code, message } }`.

- `GET /api/regions` → regions with `color_hex`, country counts
- `GET /api/countries?region=<slug>&q=<search>` → list (summaries + flag URLs); omit params for all 54
- `GET /api/countries/:iso3` → full profile (summaries + details + sources + needs_review flag)
- `GET /api/coverage?datasets=a,b` → dataset coverage/as-of info for the ribbon
- `GET /api/mountains/summary?region=<slug>&q=` → one row per country from `v_country_mountain_summary` (highest peak, height, peak count, ranges, region, flag URL, shared-high-point flag)
- `GET /api/mountains?country=<iso3>&range=<slug>&minHeight=&region=&q=&sort=` → mountains with elevation, confidence, coordinates, country list; paginated or capped with a stable sort (default: height descending)
- `GET /api/mountains/:slug` → full record, including `elevation_alternatives` and sources
- `GET /api/mountain-ranges` → ranges with peak counts, max height, countries spanned; `GET /api/mountain-ranges/:slug` → one range with its peaks and description
- `GET /api/mountains/stats?region=<slug>` → the summary cards (7.5.1) as an array of `{ key, label, value, unit, detail, entities (mountain slug / country iso3 / range slug), definition, scope, asOf }`. The `definition` string is shown to users in each card's "How is this calculated?" popover.
- `GET /api/mountains/export?format=csv|geojson&scope=all|view&<same filters as /api/mountains>` → file download. Include a header/metadata block with `as_of`, dataset versions, and **required attributions and licences** (GeoNames is CC-BY). CSV is one row per mountain with countries joined by `;`.
- `GET /api/mountains?...&sort=prominence` is supported; rows without prominence data sort last and show "—".
- `GET /api/mountains/:slug` also returns `parent`, `summits`, `local_names`, `name_origin` (with source and review flag), `prominence_m`, and `isolation_km`.
- `GET /api/gold/countries?region=<slug>&q=&year=<yyyy>&sort=` → one row per country for the table and map: presence tier, production (tonnes, computed USD value, data year), exports and imports (USD, tonnes, data year, basis), central bank holdings (tonnes, USD, % of reserves, change over 12 months, as-of date), gold's share of exports. **Every metric carries its own year or date.** `year` omitted means latest available per metric.
- `GET /api/gold/countries/:iso3` → full detail with series (production, trade, holdings), top partners (reported and mirror), in-ground reserves (separately labelled), mines, profile notes, and sources
- `GET /api/gold/stats?region=<slug>&year=` → the summary cards (7.6.1) in the same shape as the Harim stats endpoint
- `GET /api/gold/series?metric=production|exports|imports|holdings_tonnes|holdings_usd&countries=iso3,iso3&from=&to=&granularity=year|month` → chart series; hard cap on points returned; pre-aggregate in SQL
- `GET /api/gold/price?from=&to=&granularity=month|year` → price series
- `GET /api/gold/mines?country=<iso3>` → optional mine points
- `GET /api/gold/export?format=csv&scope=all|view` → file download including `as_of`, source list and **required attributions** (IMF wording, and other licences). Include the "nominal USD" and "computed value" notes in the metadata.
- `GET /api/coverage` also returns, for each Dhahabu dataset, `coverage_start`, `coverage_end` and `as_of`, so the ribbon can show per-source ranges.

Caching: reference data changes rarely. Send `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` plus `ETag`. Reuse a pooled/HTTP Neon client appropriate for serverless. Use the **read-only** DB role.

---

## 7. Frontend requirements

### 7.1 Landing page: the map
- Full-viewport hero with the map of Africa, **Equal Earth** (`geoEqualEarth`), `fitExtent`-ed to Africa, resizing responsively. Country **boundaries clearly visible** (stroke tuned per theme, with thin strokes at default zoom, scaled with zoom).
- Fill each country with its **region colour** from the API (`regions.color_hex`). These colours **are the region identity from here on**: reuse them for the legend, filter chips, table accents, and drawer headers across the app (as CSS custom properties, e.g. `--region-west`).
- **Region legend** (glass card): swatch, region name, country count. Clicking a region isolates/highlights it on the map (others dim); clicking again clears it. A "View in table" link goes to `/countries?region=<slug>`. On mobile, the legend collapses into a bottom sheet/collapsible chip row.
- Interactions: hover/focus tooltip (flag, name, region); click/tap opens a country popover/drawer with a short profile and "See in table"; zoom/pan with `d3-zoom` plus visible `+ / − / reset` buttons (pinch and two-finger drag on mobile); keyboard navigable countries (`tabindex`, `role="img"`/button semantics, `aria-label` with country and region); respects `prefers-reduced-motion`.
- Subtle entrance animation (countries fade/stagger in by region). Don't let it hurt performance. Render SVG; only switch to canvas if you measure a problem.
- Dark mode: map ocean/graticule/context land adapt; region colours keep their **hue identity** (adjust lightness/chroma in OKLCH via tokens if needed for contrast, not hue).

### 7.2 `/countries`: the table
- Shows **all 54 countries** by default, with a **region filter** (chips in region colours, plus "All"), a search box, sortable columns, and a result count. Filter state lives in the URL (`?region=`, `?q=`, `?sort=`) so views are shareable.
- Columns: **Flag Design (rendered flag image)**, Country, Region, Etymology, National Symbol, National Animal. The first column(s) must make the flag the visual anchor.
- **Flag Design cell:** render the **actual flag image from Flagpedia** (`flagcdn.com`, using `srcset` for 1x/2x, explicit `width/height` to avoid layout shift, `loading="lazy"`, `alt="Flag of <Country>"`, `onError` fallback to the self-hosted copy). On **hover and keyboard focus**, show a glass tooltip containing the document's flag text for that country (`flag_design_summary`, then the fuller `flag_design_detail`). On touch devices, tap toggles the same content as a popover (no hover-only affordances). Tooltips must be accessible (`aria-describedby`, Esc to dismiss, no clipping at viewport edges).
- Etymology / symbol / animal cells show the short summaries; clicking a row opens a **detail drawer** (bottom sheet on mobile) with the long text, the animal status badge (`official`, `de facto`, `inferred`…), source list, and a subtle "needs verification" marker where `needs_review` is true.
- Mobile (<720px): the table becomes a stacked **card list** (flag + country + region chip, expandable), not a horizontally scrolling squeeze. Sticky header and first column on desktop for wide tables.
- Loading skeletons, empty state ("No countries match"), and an error state with retry.

### 7.3 Global shell
- **Top-level layout:** persistent **data ribbon** (7.4) → main nav (Home / Countries / Harim / disabled "Coming soon": History, Contemporary Africa) → content → footer (credits and licenses: Natural Earth, Flagpedia, Material Symbols, Wikidata, GeoNames (CC-BY, attribution required), my Harim prototype, the IMF (with its required attribution wording), USGS, BGS, the World Bank, UN Comtrade, links to the World Gold Council's Goldhub, plus the border-disclaimer).
- **Light/dark toggle** in the nav: follows `prefers-color-scheme` initially, persists the user's choice (localStorage, with try/catch), sets `data-theme` on `<html>` **before first paint** (inline bootstrap in `index.html`) to avoid a flash. Smooth but reduced-motion-safe transition.
- Router, 404 page, and error boundary.

### 7.4 Persistent top ribbon (date range for data-dependent aspects)
- A sticky glass strip at the top of every page showing the **date range / currency of the data behind the current view**. Each route declares which `datasets` it depends on (in a route config); the ribbon fetches `/api/coverage` for them and renders e.g. `Reference data · as of 13 Oct 2026 · Boundaries: Natural Earth vX · Flags: Flagpedia · Last refreshed 2 days ago`.
- For v1 these datasets are **not time-series**, so show "as of" dates and an explicit "Not time-dependent" state for the countries table. But build the real mechanism: a `TimeRangeContext` (`{ start, end }`), a date-range control in the ribbon (**read-only on pages whose data is not time-dependent**, with the tooltip "This page's data is not time-dependent", and **fully interactive on `/dhahabu`**, the first time-series page; the same control is reused by later modules), and a clear API for future views to read the range and register their coverage. On mobile the ribbon condenses to one line with an expandable detail sheet.
- On `/harim` the ribbon shows the mountain datasets' "as of" dates (curated baseline commit, Wikidata snapshot, GeoNames dump) and the same "Not time-dependent" state, since elevations are treated as static reference data.
- On `/dhahabu` the ribbon is **live**. It shows each gold dataset's own coverage (e.g. `Price: monthly, <start>–<month>` · `Production: <start>–<year>` · `Trade: <start>–<year>` · `Central bank reserves: <start>–<quarter>`) with "last refreshed" dates, and an interactive **year-range control** with presets (last 5 years, last 10 years, since 2000, all). The range drives the time-series charts; its **end year is the reference year** for the table, map and cards (default "latest available"). Changing it updates the URL (`?from=&to=`) and everything on the page together. Never extrapolate beyond a dataset's coverage; show a visible "no data" state instead.

### 7.5 `/harim`: the mountains tab

Harim ("mountains") answers: *what are Africa's mountains, how high are they, and where are they, country by country?* It upgrades my prototype, so first understand what I built and what to keep or fix.

**What the prototype does (keep the good ideas):** a Leaflet map on OpenStreetMap tiles; pin markers **coloured by height band** (>5000 m red `#d73027`, >4000 orange `#fdae61`, >3000 yellow `#fee090`, ≤3000 green `#4d9221`); marker clustering; a click popup with name, country and height; and a bottom-right height legend. **What the README promised but the code never delivered:** markers **sized proportionally to height**, **name labels** beside peaks, and a golden dotted "cluster boundary" circle around each peak whose size scales with height. **What to improve:** data lives in a database instead of an inline array; all 54 countries are covered; it follows the app's Equal Earth map, region colours, glass theme and dark mode instead of a generic Mercator basemap; it is accessible and mobile-friendly; and the table comes first.

**Page structure (top to bottom; on desktop ≥1024px the map and table can sit side by side with linked selection):**
1. **Header card** with a Material Symbols icon (`landscape` or `terrain`), title "Harim · Mountains of Africa", and a one-line description.
2. **Summary-statistics band**: a row of beautiful glass cards at the very top of the page, directly under the header. Full spec in **7.5.1**.
3. **Summary table, per country** (the starting view). One row per country, default sort by highest peak descending, with: flag, country, region chip (region colour), **highest peak**, **height (m)** with an inline proportional bar, **peak count**, mountain ranges, **lowest point** (name and metres, which can be negative, so use a true minus sign) and **relief** (highest minus lowest). The last two columns sit behind a column toggle on narrower desktops and appear in the expanded row on mobile. Each row **expands** to list that country's mountains (name, height in m and ft, range, type, volcanic status, confidence badge, "shared with …" badge for border peaks). Massifs show their summits nested beneath them (e.g. Kilimanjaro → Kibo, Mawenzi, Shira) and count as one mountain. A view switch offers **By country** (default), **All peaks** (flat list sortable by height or **prominence**, with a "Most prominent peaks" preset; filterable by country, region, range, volcanic status and a minimum-height slider; show an "ultra-prominent" badge at ≥1,500 m prominence where known) and **By range** (the ranges view, 7.5.2). Peaks with no prominence data show "—" and sort last. Region filter chips (same as the Countries tab), search, and URL-synced state (`?region=&q=&view=country|peaks|ranges&sort=&minHeight=&volcanic=&range=`). Mobile (<720px) uses stacked cards instead of a squeezed table. Show heights as `5,895 m` with a secondary `19,341 ft` toggle (metres/feet, persisted).
4. **Map** (the "visual" of the same data), built on the same `AfricaMap` base as the landing page: Equal Earth, country boundaries, countries tinted with a **muted** version of their region colour so the peaks stand out.
   - **Peak markers:** a mountain/triangle glyph **sized proportionally to height** (use a square-root scale and set minimum and maximum sizes), coloured by the **height-band scale** above (re-tuned for contrast in light and dark themes). Shared peaks get a subtle ring. Territory peaks get a neutral marker. Include the height-band legend as a glass card.
   - **Labels:** names shown beside peaks with collision avoidance (a greedy label placer that prioritises taller peaks), revealing more labels as the user zooms in.
   - **Declutter instead of Leaflet-style clustering:** at low zoom, show only the country high points and the top N peaks overall; group tight clusters (e.g. the six Rwenzori peaks, the Virunga volcanoes) into one badge such as "Rwenzori ×6" that expands on zoom or click; show all peaks when zoomed in. Zoom/pan with `d3-zoom` and `+ / − / reset` buttons; pinch and two-finger pan on mobile.
   - **Optional "area of influence" halo layer (toggle, off by default):** my README's idea of a golden dotted circle around each peak whose radius scales with height. If implemented, label it clearly as **illustrative, not a geological or administrative boundary**, and use a golden dashed stroke with a low-opacity fill.
   - **Interactions:** hover/focus tooltip (name, height, country flag); click/tap opens the same peak popover/drawer as the table (height in m and ft, country or countries, range, type, volcanic status, confidence, alternative sourced heights, sources, "needs verification" marker). **Linked selection:** hovering or selecting a table row highlights and centres the peak(s) on the map, and selecting a peak scrolls to and highlights its table row. A "Fit to country" action zooms to a country's peaks. Region filters and country filters apply to both table and map.
   - Keyboard accessible: peaks are focusable with `aria-label="Mount Kenya, 5,199 metres, Kenya"`; the table is the accessible equivalent of the map and the map links to it.
5. **Chart: "Highest peak by country"**, a horizontal bar chart of each country's highest-point height, bars in region colours, sortable and filtered by the same region state, with a Material Symbols icon in the chart header and an accessible data-table fallback. Add a thin reference line for Kilimanjaro (Africa's highest). Keep it a small, clean chart, not a dashboard.
6. **Cross-links:** from the Countries drawer, "Highest peak: …" links to `/harim?country=<iso3>`; from a Harim row, "Country profile" opens the Countries drawer.

**Geology context (optional card):** a short "Why are Africa's highest mountains where they are?" panel (East African Rift volcanoes and rift shoulders such as Kilimanjaro, Kenya, Virunga and Rwenzori; ancient eroded ranges such as the Atlas and Drakensberg; stable cratons). Take the text from my README's "Geological Significance" section, tightened and fact-checked. Collapse it by default on mobile.

### 7.5.1 Summary-statistics band (the cards at the top of `/harim`)

A single section of glass cards, designed to be the first thing people see and to make the tab feel alive. All values come from `GET /api/mountains/stats`, which is computed in the database (section 4.2), never in the browser.

**Behaviour common to every card**
- Material Symbols icon in the card header, a short label, one large number (display typeface, tabular figures), and one line of supporting detail. Where a country is named, show its **flag** from Flagpedia beside it (both flags for a shared peak).
- **Scope tag:** the band shows continental figures ("All Africa") by default and **recomputes for the active region filter** with a chip in that region's colour; the tag must always be visible so nobody misreads a regional number as continental.
- Each card is clickable and does something useful: opens the peak drawer, filters the table and map, or jumps to the relevant range or country. Hover, focus and press states are clearly visible, with a keyboard-reachable action.
- Each card has an **"i" popover, "How is this calculated?"**, showing the `definition` string from the API. This matters for honesty (see the "catalogued" and "lowest national high point" notes below).
- Count-up animation on first load (≤800 ms; disabled for `prefers-reduced-motion`), skeleton placeholders while loading, graceful error state with retry. Where a figure has `low` confidence or sources disagree, show a small marker with the alternatives in a tooltip.
- Layout: ≥1280px a two-row grid (4 hero cards, then the 5 compact cards); 720–1279px a 3-column grid; <720px a horizontal **scroll-snap carousel** (hero cards first) with pagination dots. The carousel scrolls internally; the page must never scroll horizontally. Each card is an `<article>` with `aria-labelledby`; any mini-visual has a text equivalent.

**Hero cards (large)**
1. **Mountains catalogued** (`landscape`): the total number of mountains in the dataset, with the detail line "across N countries" and "+N in territories" if applicable. Counting follows the rule in 4.2 (massifs once, summits not counted separately, shared peaks once, territories excluded from the headline). **Wording matters:** this is a *curated catalogue* (every national high point, every peak above 3,000 m, plus notable peaks), **not a census of all African mountains**. Say so in the definition popover and never label the card "Mountains in Africa".
2. **Volcanic mountains** (`volcano`): count of volcanic mountains, with a segmented bar and legend for **active / dormant / extinct / unknown**. Click filters the table and map to volcanic peaks (`?volcanic=1`).
3. **Tallest mountain** (`altitude`): name, height in m (and ft per the units toggle), country with flag. Show the massif and summit properly (e.g. "Kilimanjaro · Kibo, Tanzania"). Click opens the peak drawer.
4. **Lowest national high point** (`south`): this is the card that stands in for "shortest mountain". It shows the lowest of the 54 countries' *highest* points: name, height, country with flag. **Do not call it "the shortest mountain in Africa".** The catalogue deliberately omits small hills, so a "shortest mountain" figure would just reflect the catalogue's cutoff, and some of these high points are hills or flat terrain rather than mountains. The label, caption ("Africa's lowest 'highest point'") and definition popover must say that clearly.

**Compact cards (smaller, same visual language)**
5. **Peaks above 4,000 m** (`filter_hdr` or similar): the count, with a mini stacked bar of all four height bands (>5,000 / 4,000–5,000 / 3,000–4,000 / ≤3,000 m) in the map's band colours and counts in the legend.
6. **Most mountainous country** (`flag`): the country with the most peaks of 3,000 m or higher, with flag and count (the catalogue includes every such peak, so this does not depend on the curation cutoff). Show ties explicitly instead of silently picking one (alphabetical order is only for display).
7. **Busiest range** (`terrain`): the range with the most peaks above 3,000 m, with its tallest peak in the detail line. Click opens the range page.
8. **Lowest point in Africa** (`arrow_downward`): from the country low points data (expected to be Lake Assal in Djibouti, but take it from the data), with depth in metres below sea level, country and flag.
9. **Greatest relief** (`height`): the country with the largest gap between its highest and lowest points, with both figures in the detail line.

**Optional 10th card, shown only if the data supports it:** **Most prominent peak** (`trending_up`), shown only when prominence is known for at least 80% of peaks above 3,000 m. Otherwise hide the card and note in the README why.

**Implementation rules**
- Write the definition and tie-breaking rule for every statistic in `docs/harim-stats.md` and implement them once, in `v_harim_stats`. Ties are returned as a list, never resolved at random.
- Unit tests with fixtures covering: shared peaks counted once; a massif and its summits not double-counted; territories excluded from headline counts; negative elevations; ties; region scoping; a region with no volcanic peaks (card shows 0, not an error).
- Verify icon names exist in the current Material Symbols set before using them, and substitute the closest valid icon if not.

### 7.5.2 Ranges view (`/harim?view=ranges` and `/harim/ranges/:slug`)

- **Range cards** in a responsive grid: range name with a type icon, tallest peak and height, number of catalogued peaks, countries spanned (flags), and a mini bar of its peaks' heights. Tinted with the region colour of the country where it has most peaks (or neutral if split). Sort by tallest peak by default; search and region filter apply.
- **Range page**: short description and formation note (from the curated seed; show a "needs verification" marker where unsourced), a map fitted to the range with its peaks, a peaks table, and cross-links to the countries involved. Cover at least the Atlas, Rwenzori, Virunga, Drakensberg, Simien, Ethiopian Highlands, Tibesti, Hoggar (Ahaggar), Eastern Arc, Mulanje, and Cameroon Line volcanoes, subject to what the data supports.

### 7.5.3 Peak detail pages (`/harim/peaks/:slug`)

A full page for each mountain, also reached from "Open full page" in the peak drawer. It contains:
- Hero: name, height (m/ft), flag(s), range, and a volcanic-status badge.
- Facts grid: elevation with confidence and the alternative sourced values, prominence and isolation (where known), coordinates (with a copy button), countries, peak type, parent massif and summits.
- **Names:** local names with language, and the name origin with its source (with the "needs verification" marker when unsourced).
- A small locator map (Equal Earth inset) and a "nearby peaks" list (same range or country).
- Sources, a copy-link button, and proper `<title>`/meta tags. Generate static social images at build time for country high points and peaks above 4,000 m if feasible; otherwise fall back to a generic Harim image and say which you did.

### 7.5.4 Export

An "Export" menu on the table section with **CSV** and **GeoJSON** downloads, for either the current filtered view or the whole dataset, from `GET /api/mountains/export`. Files include `as_of`, dataset versions and the required attributions and licences in the metadata. Disable nothing silently; show a short toast on success or error.

### 7.6 `/dhahabu`: gold in Africa

Dhahabu answers: *where is gold found in Africa, how much is mined and traded, how much do central banks hold, and what is it worth?* It shares the app's region colours, flags, glass theme and conventions. Its own accent is a warm gold, but **region colours still identify regions** (chips, bars, accents), and map fills for a metric use a separate **sequential gold ramp**. Chart and map colour must be colour-blind safe, work in light and dark, and never rely on colour alone.

**Honesty rules (these shape every label in the tab):**
- **Two meanings of "reserves", always separate.** *Central bank gold reserves* (what governments hold; the usual meaning in the news) and *in-ground reserves* (an estimate of gold still in the ground that is economically extractable). Use different labels and icons, never add or compare them, and show the USD value of in-ground reserves only in the country drawer, labelled "illustrative at a given price, not a realisable sum".
- **Every number shows its year or date** in small type. Countries report on different schedules, so the table header says "latest available".
- **Null, zero and "included in other countries" look different** (e.g. "—", "0" and "incl. in other"), with a legend entry. "No data" is never drawn as zero.
- **Values are nominal USD**, and computed values (production × average price) are marked as computed, with the price used visible on hover.
- **"Traded" means recorded trade** in non-monetary gold (HS 7108) as reported to UN Comtrade. Artisanal and informal flows are often unrecorded, so show the **mirror gap** and explain it neutrally: it can reflect timing, valuation, classification or unrecorded flows, and **is not evidence of wrongdoing**.
- Never present "no deposits" as fact. Use "No significant gold deposits identified in the sources consulted", with the evidence and a confidence level.

**Page structure (top to bottom):**
1. **Header card** (Material Symbols icon, title "Dhahabu · Gold in Africa", one-line description), a units control (tonnes / kg / troy oz; USD stays nominal USD), and a short "How to read this page" popover covering the honesty rules above.
2. **Summary-statistics band** (7.6.1).
3. **Country table** (all 54): flag, country, region chip, **presence** badge (Major producer / Producer / Occurrences known / None identified / Unknown, with an evidence popover), **mine production** (tonnes, computed USD value, year), **gold exports** (USD and tonnes, year, reported basis), **central bank holdings** (tonnes, USD value, % of reserves, 12-month change, as-of date), and **gold's share of exports**. Region filter chips, search, sortable columns, a "presence" filter, URL-synced state (`?region=&q=&presence=&sort=&from=&to=&metric=`), and a **CSV export** (`/api/gold/export`). Clicking a row opens the **country drawer**. Mobile (<720px) uses stacked cards with the key figures first and the rest in an expandable section. Loading skeletons, empty state and error state with retry.
4. **Map**: Equal Earth, same `AfricaMap` base as the landing page, with a **metric switcher** (Mine production · Central bank holdings · Gold exports value · Gold's share of exports · Presence tier). Metric maps use the sequential gold ramp with a legend and a distinct pattern for "no data" and "included in other". The presence tier map is categorical (use a colour-blind-safe palette plus hatching or icons). Hover and focus tooltips (flag, country, metric with its year), click opens the drawer, zoom and pan as elsewhere, micro-state markers, Western Sahara handled as on the other maps, and linked selection with the table. A toggle adds the **major mines layer** if the data passed the quality bar in 5.6; the table is the accessible text equivalent of the map, and the map links to it.
5. **Charts** (each with a Material Symbols icon in its header, an accessible data-table fallback, direct labels where possible and no dual axes):
   - **Top gold producers**: horizontal bars for the reference year, bars in region colours, with tonnes and computed value on hover.
   - **Africa's mine production and the gold price**: two stacked small-multiple panels sharing the time axis for the ribbon's range, production (Africa total, optionally stacked by the top five countries plus "others") above, price in USD per troy ounce below.
   - **Central bank gold holdings**: lines for the largest African holders over the ribbon's range, with a toggle between **tonnes** and **USD value**. The two lines diverging is the point: show the **price effect versus volume effect** (for a chosen country and range: how much of the change in USD value came from the price rising and how much from tonnes bought or sold).
   - **Gold dependence** (optional): gold's share of merchandise exports by country, for those with data.
6. **Country drawer** (bottom sheet on mobile): presence tier with evidence and confidence; production history; trade (reported versus mirror, top partners); **central bank reserves** (tonnes, USD, % of reserves, 12-month change); **in-ground reserves** in a separate, clearly labelled block; artisanal mining note; major mines; curated notes with source and date; all sources with reliability tier; "needs verification" markers; and "Explore on Goldhub" and other source deep links (outbound links only).
7. **Cross-links:** from the Countries drawer, "Gold in <country>" opens `/dhahabu?country=<iso3>`; from the Dhahabu drawer, "Country profile" opens the Countries drawer.

### 7.6.1 Summary-statistics band

Same behaviour, layout, accessibility and implementation rules as 7.5.1 (scope tag that follows the region filter, "How is this calculated?" popovers, click actions, count-up animation with reduced-motion fallback, skeletons, carousel on mobile, tabular figures, flags beside countries). Definitions and tie-breaking go in `docs/dhahabu-stats.md` and are implemented once, in `v_gold_stats`. The cards use the **reference year** from the ribbon and show it on each card.

**Hero cards (large)**
1. **Gold-producing countries** (`diamond`): the number of the 54 with reported production, with a segmented bar of presence tiers (major / producer / occurrences known / none identified / unknown). This card answers "presence or absence of gold deposits".
2. **Africa's gold mine production** (`savings`): tonnes in the reference year, Africa's share of world output, and the change from the previous year.
3. **Value of that production** (`paid`): USD at that year's average price, labelled computed, with the price in the detail line (e.g. "at $X per oz, annual average").
4. **Largest producer** (`flag`): country with flag, tonnes, and its share of Africa's total. Show ties explicitly.

**Compact cards**
5. **Central bank gold held in Africa** (`account_balance`): tonnes and USD value at the latest date, with the as-of date.
6. **Largest African holder** (`workspace_premium` or similar): country with flag, tonnes, USD value, and gold's share of its reserves.
7. **Gold price** (`show_chart`): latest monthly average and the change versus a year earlier. Label it "monthly average, not live".
8. **Most gold-dependent exporter** (`local_shipping` or similar): the country with the highest gold share of its recorded merchandise exports, with flag.
9. **Biggest reporting gap** (`compare_arrows` or similar): the country where partner-reported imports exceed its own reported gold exports by the most. Use the neutral wording from the honesty rules.
10. **Largest net buyer in the last 12 months** (`add_shopping_cart` or similar): the African central bank with the largest net purchase in tonnes (or "no net buyer" if none).

**Optional 11th card:** **Price effect** (`trending_up`): how much of the 12-month change in the USD value of African central bank holdings came from price versus tonnes.

Verify each icon exists in the current Material Symbols set and substitute the closest valid one if not.

---

## 8. Design system

### 8.1 Visual theme: latest glassmorphism
- Target the current "liquid glass" direction: translucent layered panels using `backdrop-filter: blur() saturate()`, soft inner highlights/specular edge (1px gradient borders), subtle depth shadows, and refracted/ambient colour behind the glass. Research current references before designing, and avoid the dated frosted-card cliché.
- Put the glass over a deliberate background (soft mesh/gradient that relates to the region colours) so the effect is visible; the map sits on it in the hero.
- **Accessibility guardrails:** text on glass must hit WCAG AA (4.5:1) in both themes. Add scrim/tint layers as needed. Provide fallbacks for `@supports not (backdrop-filter)` (solid translucent surface) and for `prefers-reduced-transparency` / `prefers-contrast: more`. Keep blur radius sane for mobile GPU performance (limit stacked blurred layers).
- Use `frontend-design` skill principles: **distinctive typography** (self-hosted variable fonts, a characterful display face paired with a clean text face, not default system/Inter-only), a coherent spacing/radius/elevation scale, and a restrained, intentional palette. All tokens in `styles/tokens.css` with light and dark sets.

### 8.2 Responsive
- Mobile-first. Breakpoints defined as tokens (e.g. 480 / 720 / 1024 / 1440). Check **no horizontal page scroll** at 320px width. Touch targets ≥ 44px. Use `dvh` units for the hero, handle iOS safe areas, and test landscape.
- Both desktop and mobile will be checked, so include Playwright projects for each and fail CI on layout regressions in the smoke tests (e.g. no overflow, tooltip within viewport).

### 8.3 Icons
- Google **Material Symbols** (https://fonts.google.com/icons) for **cards, chart/map panel headers, nav, filters and controls**. Self-host the variable font via the npm package (`material-symbols`) or an optimized subset, not a render-blocking third-party CSS request. Provide a single `<Icon name="…" />` component with `aria-hidden` by default, and a labelled variant for icon-only buttons. Suggested (verify each exists in the current set): `landscape`, `terrain`, `volcano`, `altitude`, `download`, `diamond`, `savings`, `paid`, `account_balance`, `show_chart`, `map`, `public`, `flag`, `pets`, `history_edu`, `filter_alt`, `dark_mode`/`light_mode`, `date_range`, `info`, `zoom_in`/`zoom_out`/`fit_screen`.

---

## 9. Quality bar

- **Accessibility:** semantic HTML, landmarks, skip link, visible focus rings, full keyboard operation of map, legend, table, tooltips and drawers; correct ARIA; axe checks in Playwright; map has a text alternative (the table is the accessible equivalent, so link to it).
- **Performance:** target Lighthouse ≥ 90 (Performance, Accessibility, Best Practices, SEO) on mobile for `/`, `/countries`, `/harim` and `/dhahabu`. Time-series endpoints must return capped, pre-aggregated points. Budget the map payload (compressed TopoJSON, lazy-load the context layer), code-split routes, preconnect to `flagcdn.com`, set image dimensions.
- **SEO/meta:** titles, descriptions, Open Graph/Twitter cards (generate an OG image), `lang`, favicon, `robots.txt`, sitemap.
- **Testing:** unit tests (projection helpers, region filter logic, colour-mode algorithm with fixture flags), API function tests with a mocked DB, pytest for PDF parsing validation and region-colour determinism, Playwright e2e (landing renders 54 coloured countries, legend isolates a region, filter updates URL and rows, tooltip shows document text, theme toggle persists, mobile card layout; Harim: all 54 countries have a high point in the summary table, rows expand, region filter and `minHeight` update URL/table/map together, selecting a row highlights its peak and vice versa, metres/feet toggle persists, no label overlap or overflow at 390px). Unit-test the height scale, label placer, declutter/grouping logic and the reconcile rules (fixtures with conflicting elevations). Also test: every statistic in `v_harim_stats` (7.5.1), the massif/summit counting rule, negative-elevation formatting, the CSV/GeoJSON export (attribution block present, filters respected), the ranges view and a peak detail page (including a peak with no prominence or no name origin), and the stats band carousel at 390px with no horizontal page scroll. **Dhahabu tests:** the tonne/ounce constant; production value computed with the right year's price (and a failure when the price is missing); null versus zero versus `included_in_other` in the API and in the UI; each presence-tier rule with fixtures; the mirror-gap statistic; the price-versus-volume decomposition (it must sum exactly to the total change); the ribbon range driving URL, charts and cards together; the CSV export's attribution block; `wgc_import` doing nothing unless `ENABLE_WGC_IMPORT=true`; and Playwright flows for table sorting and filtering, the map metric switcher, the country drawer and range changes, at desktop and 390px.
- **Security:** read-only DB role in functions, parameterized queries only, input validation, sensible security headers via `netlify.toml`, no secrets in client bundle. API keys such as `COMTRADE_API_KEY` exist only in pipeline environments (local `.env`, GitHub Actions secrets), never in Netlify function or client environments.
- **i18n-ready:** put UI strings in a single module/dictionary now (English only in v1). Country names carry proper diacritics (Côte d'Ivoire, São Tomé and Príncipe).

---

## 10. Deployment (Netlify)

- `netlify.toml`: build command and publish dir for `apps/web`, `functions = "netlify/functions"`, `/api/*` redirect, SPA fallback redirect to `index.html`, security and cache headers (long-cache hashed assets, short-cache HTML).
- Env vars: `DATABASE_URL_READ` (functions, Netlify), `DATABASE_URL_WRITE` (pipelines only, GitHub Actions secret / local `.env`), optional `NETLIFY_BUILD_HOOK`. Pipelines also use `COMTRADE_API_KEY` (a free UN Comtrade key; I will provide it) and `ENABLE_WGC_IMPORT` (default `false`; see 5.6). Document which belongs where.
- Deploy previews work out of the box. Recommend (in the README) one Neon branch for production and optional per-preview branches.
- README sections: prerequisites, one-time Neon setup, `migrate → extract-pdf → flags → boundaries → load` first-run sequence, local dev (`netlify dev`), tests, deployment, how to refresh data, how to add a new dataset or tab.

---

## 11. Known data caveats: handle these in the data model, not by ignoring them

The research document is a good starting point but is **not fully verified**. Many citations are Reddit, Quora, Facebook, Scribd, a fan wiki (CountryHumans) and aggregator sites. Treat accuracy as a first-class concern:

- Tag each cited source with a `reliability_tier` (`low` for forums/social/fan wikis). Surface "needs verification" on records that rely mainly on low-tier sources.
- **Animal status matters.** Many "national animals" in the document are explicitly *inferred* (e.g. Mauritania, Djibouti, Seychelles, São Tomé, Madagascar, Eswatini) or derived from **football team nicknames** (e.g. Cabo Verde's Blue Shark, Mali's Eagle, Gambia's Scorpion). Set `animal_status` accordingly and show it in the UI so the app never presents inference as official fact.
- **Internal inconsistencies to flag in `review_report.md`** (non-exhaustive; look for more): DRC etymology differs between the table ("Republic of the Mountain/River") and the prose ("river swallowing rivers"); Benin's table etymology mixes "Bight of Benin" and "Vexation", and the Yoruba "Land of Vexation" gloss is shaky; Mali's "hippopotamus" etymology is stated as fact but is contested; Rwanda's prose says the pre-2001 flag was red-black-green, which looks wrong (it was red, yellow, green with a black "R"); Equatorial Guinea's cited "Silvery-cheeked Hornbill" is not a species typical of that country; the South African and Libyan flag-colour "meanings" are presented as official but are mostly informal readings; the Togo flag is said to "mimic" Liberia's, which is a stretch.
- Etymology categories are defined in the document's introduction but **not assigned per country**. Leave `etymology_category` nullable and propose an assignment in the review report instead of presenting guesses as data.
- I will correct the data via the seed files, so make the loop easy: edit `db/seeds/*.json` → `load` → done, with `needs_review` cleared by me.

### 11.2 Harim data caveats (from my prototype)

My prototype was assembled quickly and **has errors and inconsistencies that must not flow into the new database unchecked.** Verify against Wikidata/GeoNames and reputable sources, and record every discrepancy in `data/mountains_review_report.md`. Known issues (non-exhaustive; look for more):

- **Wrong or doubtful values:** Emba Soira (Eritrea) is listed at 2,586 m, but its commonly cited height is about 3,018 m. Cathedral Peak (3,004 m) is listed as South Africa's entry, but South Africa's highest point is believed to be Mafadi (about 3,450 m) in the Drakensberg. Check Mount Meru (README says 4,562 m, HTML says 4,566 m), Ras Dashen (sources give roughly 4,533–4,550 m), and all other heights. Also check Mont Nimba's tripoint status (Guinea / Côte d'Ivoire / Liberia) and its coordinates.
- **Labelling issues:** "Cape Verde" should be Cabo Verde; Piton des Neiges is in Réunion (a French overseas department, not one of the 54); several names bundle a range in brackets and need splitting; Mount Stanley/Margherita naming differs between README and HTML.
- **Claims that don't hold in the file:** the HTML says the array is "sorted by height", but it is not (e.g. M'Goun, 4,071 m, comes after Mount Cameroon, 4,040 m). Never rely on source order; sort in the database/API.
- **Coverage gaps:** about 30 of the 54 countries appear. Countries with no entry must be filled by the pipeline; some countries are genuinely low-relief (e.g. The Gambia, Seychelles, Mauritius), so their "highest point" is modest. They still get a row, which is part of the story.
- **Shared peaks** (Margherita, Karisimbi, Elgon, Nimba and others) must appear under each country, flagged `is_shared`, and be counted once in Africa-wide statistics. Make sure no summary double-counts them.
- **Source mix:** heights from different sources can differ by tens of metres because of survey datum and measurement method. Always store the source and alternatives, and never present a single number as unquestionable. The UI shows the confidence badge and, in the drawer, the alternatives.
- **Statistics are only as meaningful as their definitions.** "Total mountains" is the size of a curated catalogue, not of Africa's mountains; "shortest mountain" is not a well-defined quantity (it depends on where you draw the line between a mountain and a hill), which is why the card is the *lowest national high point*. Keep these definitions visible in the UI.
- **Massifs vs summits:** several names in my prototype and README mix levels (Kilimanjaro/Kibo, Mount Stanley/Margherita Peak, and the Rwenzori "mountains" that are really massifs). Resolve them through the hierarchy in 5.5 and list every merge in the review report.
- **Name origins and local names** are easy to get wrong; require a cited source or show the "needs verification" marker.
- **Low points:** some national low points are depressions or lakes, some are sea level, and some have disputed or poorly surveyed elevations. Show the feature name, flag low-confidence values, and never present a negative elevation without its unit and the words "below sea level" somewhere nearby.

### 11.3 Dhahabu data caveats

- **Source licensing.** The World Gold Council's site terms restrict use to personal non-commercial purposes and prohibit scraping and republishing without written permission, and its downloads require login. That is why the pipelines use the IMF, USGS, BGS, World Bank and UN Comtrade directly and link out to Goldhub. This is a practical reading of the terms, not legal advice; I will confirm anything I intend to publish commercially.
- **Gold production figures are estimates with real uncertainty.** Several African countries have large artisanal and small-scale mining (ASM) sectors whose output is only partly recorded. Some sources round heavily, revise earlier years, or lump smaller producers into "other countries". Do not present a single figure as unquestionable; show the source and year.
- **Trade data has structural gaps.** Not every African country reports to UN Comtrade every year; classification of gold can differ; and partner-reported (mirror) figures often differ from reported ones. Show both, say which is which, and keep the language neutral.
- **Reserves are two different things.** Central bank holdings (IMF data, two-month reporting lag, some countries report late or irregularly) versus in-ground reserves (a geological estimate that changes with price and definitions). Keep them apart everywhere.
- **Vintage mismatch.** Production may be for 2025 while trade is for 2024 and holdings for a recent month. Never compute a ratio across different years without saying so (for example, gold's share of exports must use the same year for both parts).
- **Price effects dominate value comparisons.** Gold's USD price has moved a lot in recent years, so a country's holdings can rise in value while its tonnes are unchanged. Use the price-versus-volume decomposition and avoid wording that implies buying or discovery when the change is price.
- **Absence is hard to prove.** "None identified" means none found in the sources consulted. Keep the evidence and confidence visible.
- **Sensitive contexts.** Conflict-affected countries and disputed territories (Sudan, South Sudan, Libya, Somalia, the DRC, Western Sahara, among others) have poor or contested data. Mark low-confidence figures, avoid inference about who controls mines or flows, and never include unsourced allegations.
- **Not financial advice.** The tab is informational. Don't show forecasts, recommendations or price targets.

---

## 12. Milestones

1. **Scaffold:** monorepo, tooling, lint/format/type-check, CI skeleton, `netlify.toml`, design tokens, theme toggle, layout shell with ribbon stub.
2. **Data foundation:** migrations, PDF extraction + validation, seeds, review report. *Stop and show me `review_report.md`.*
3. **Flags + region colours:** flag fetch, palette extraction, region colour report. *Stop and show me `region_colors_report.md` for approval before wiring colours into the UI.*
4. **API:** functions, shared types, tests; Neon connected.
5. **Map:** boundaries pipeline, `AfricaMap`, legend, interactions, micro-state markers, dark mode.
6. **Countries table:** filters, flags, tooltips, drawer, mobile cards, URL state.
7. **Ribbon & coverage:** real data from `/api/coverage`, `TimeRangeContext`, route dataset config.
8. **Harim data:** baseline import from my repo, Wikidata/GeoNames enrichment, reconcile, **massif/summit hierarchy, prominence, national low points, local names and name origins**, migrations 4.2, seeds, validation. *Stop and show me `data/mountains_review_report.md` and the per-country high-point list before building the UI on it.*
9. **Harim API and table:** functions, `v_country_mountain_summary` and `v_harim_stats`, `docs/harim-stats.md`, per-country summary table with expandable rows, "All peaks" view with prominence sort, filters, units toggle, URL state.
10. **Harim statistics band:** the cards in 7.5.1 with scope tag, definition popovers, click actions, carousel on mobile, and tests. *Show me screenshots (desktop and mobile, light and dark) of the band before moving on.*
11. **Harim map and chart:** height-proportional peak glyphs, labels, declutter/grouping, optional halo layer, linked selection with the table, "highest peak by country" chart, cross-links with the Countries tab, geology card.
12. **Harim ranges, peak pages and export:** ranges view and range pages (7.5.2), peak detail pages (7.5.3), CSV/GeoJSON export (7.5.4).
13. **Dhahabu source and licence check:** write `docs/dhahabu-sources.md` (5.6): for each source, what it provides, how it is accessed, licence and attribution, rate limits, cadence. *Stop and show it to me, including anything needing my decision (the Comtrade key, WGC permission, unclear terms).*
14. **Dhahabu data:** migrations 4.3, price, production, official reserves, trade (reported and mirror), presence classification, optional mines, profiles, seeds, validation. *Stop and show me `data/gold_coverage_matrix.md` and `data/gold_review_report.md` before building the UI on the data.*
15. **Dhahabu API, table, stats band and live ribbon:** functions, `v_gold_country_latest`, `v_gold_stats`, `docs/dhahabu-stats.md`, country table with filters and CSV export, the 7.6.1 cards, and the interactive ribbon date range with URL sync. *Show me desktop and mobile screenshots (light and dark) of the band and table before moving on.*
16. **Dhahabu map, charts and drawer:** metric-switching map, optional mines layer, top producers chart, production-and-price small multiples, holdings chart with the price-versus-volume view, country drawer, cross-links with the Countries tab.
17. **Polish & hardening:** accessibility pass, performance pass, Playwright suites (desktop + mobile, all three tabs), Lighthouse, README, deploy to Netlify.

### 12.1 v1.1 milestone (do NOT build this as part of v1; start only after I accept v1)

**Harim: glaciers and volcanic activity.** It reuses the interactive ribbon date range introduced for Dhahabu in v1 (on these panels only).

1. **Data assessment first, then stop.** Write `docs/harim-v1.1-data-assessment.md` covering what data actually exists, its licence, temporal coverage, consistency and how it could be ingested. Candidates to evaluate (not guaranteed to be suitable): the Smithsonian Global Volcanism Program for eruption histories, and glacier inventories (GLIMS / Randolph Glacier Inventory) plus published ice-extent studies for Kilimanjaro, Mount Kenya and the Rwenzori. Show me the assessment and wait for my decision.
2. If approved: add `volcanic_events` (`mountain_id`, `start_date`, `end_date?`, `vei?`, `source_id`) and `mountain_glacier_observations` (`mountain_id`, `observed_on`, `area_km2`, `method`, `source_id`) tables, new `datasets` rows with `coverage_start` / `coverage_end`, and pipelines in the existing style.
3. UI: an "Ice and fire" section on Harim with an eruption timeline and an ice-extent-over-time chart for the glaciated peaks, driven by the ribbon's time range via `TimeRangeContext`.
4. **Honesty rules:** never fabricate or interpolate data. If a glacier series has only a handful of survey years, show dated points with source labels instead of a smooth line, and say where the record starts and ends.

---

## 13. Definition of done

- [ ] `/` shows Equal Earth map of Africa, visible country boundaries, 54 countries coloured by region (mode flag colour), legend works, micro-states visible, Western Sahara and Somaliland handled as specified
- [ ] `/countries` lists all 54, region filter + search + sort work and are URL-synced; flag images come from Flagpedia; hover/focus/tap shows the document's flag text
- [ ] Light/dark toggle, persists, no flash; glass theme meets AA contrast in both
- [ ] `/harim` opens with a per-country summary table covering **all 54 countries** (highest peak, height, peak count, ranges), expandable to each country's mountains, with region filter, search, flat "All peaks" view, metres/feet toggle and URL-synced state
- [ ] Harim map uses the Equal Earth base, height-proportional peak glyphs coloured by height band, labels without overlap, grouped clusters that expand on zoom, linked selection with the table, and a legend; shared and territory peaks handled as specified
- [ ] Harim data is loaded from the database (not an inline array), reconciled from my repo + Wikidata (+ GeoNames), with conflicts and known prototype errors listed in `mountains_review_report.md`
- [ ] "Highest peak by country" chart and cross-links with the Countries tab work
- [ ] Harim opens with the **statistics band** (7.5.1): total mountains catalogued, volcanic mountains, tallest mountain with country, lowest national high point with country, and the compact cards; scope tag follows the region filter; definition popovers present; wording follows the honesty rules; renders as a carousel on mobile with no horizontal page scroll
- [ ] Every country shows its lowest point and relief range; massif/summit hierarchy is respected in the table, counts and map
- [ ] Ranges view and range pages, peak detail pages (with local names and name origins marked as sourced or "needs verification"), prominence sort, and CSV/GeoJSON export all work
- [ ] `/dhahabu` covers all 54 countries with presence tier and evidence, mine production (tonnes and computed USD value), recorded gold trade (reported and mirror), central bank holdings (tonnes, USD value, % of reserves), and in-ground reserves in a separate labelled block
- [ ] Dhahabu summary band, table, map with metric switcher and charts work together; the ribbon's year range updates URL, charts and cards; every number shows its year or date; null, zero and "included in other" are visually distinct; the honesty rules in 7.6 are followed in the UI wording
- [ ] No World Gold Council data was scraped or republished; `wgc_import` is off by default; `docs/dhahabu-sources.md` records licence and attribution for every source; required attributions (including the IMF wording) appear in the footer and in exports
- [ ] Nothing from the v1.1 milestone (12.1) has been built
- [ ] Persistent ribbon shows per-view dataset coverage (including the Harim datasets' "as of" dates); the time-range control is interactive on `/dhahabu` and read-only elsewhere
- [ ] Material Symbols used for card/panel headers and controls
- [ ] Python pipelines run end to end from an empty Neon database and are idempotent; scheduled refresh workflow exists
- [ ] Functions use a read-only DB role; no secrets in the client
- [ ] Desktop and mobile Playwright suites pass; Lighthouse ≥ 90 mobile on `/`, `/countries` and `/harim`; no horizontal scroll at 320px
- [ ] README lets a new developer go from clone to deployed site
- [ ] Review reports and your list of decisions/unverified items delivered at the end

## 14. Out of scope for v1 (but don't block it)

Dhahabu roadmap items to list in the README but **not build in v1**: gold demand, jewellery and investment flows (including ETFs), company-level production and ownership data, artisanal mining formalisation and responsible-sourcing indicators, a full standalone page per country, inflation-adjusted values, and anything that looks like forecasts or investment advice (which should never be added).

Harim roadmap items to list in the README but **not build in v1**: glaciers and volcanic activity (see 12.1), protected areas and UNESCO World Heritage mountain sites, an elevation-zones infographic (e.g. Kilimanjaro from rainforest to ice cap), a west-to-east "skyline" chart of country high points, hillshade/terrain basemaps and 3D views, and a light "which is taller?" quiz. Also out of scope: peak-level photos, climbing routes and first-ascent history, archiving or redirecting my original `emtatudatatech/harim` repo (leave it untouched), historical timelines, contemporary indicators (World Bank / UN data via the Python pipelines and `observations` table), user accounts, CMS/admin editing UI, multi-language content, search across long-form content, offline/PWA support.
