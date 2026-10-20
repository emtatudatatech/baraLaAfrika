# Dhahabu data sources and licences

This document records, for every source behind the Dhahabu (gold) tab:
- what the source provides;
- how it is accessed;
- its licence and the attribution it requires;
- its rate limits and update cadence.

Every terms page was re-read on **17 October 2026**, and every endpoint below was tested live that day with targeted calls. Quotes are verbatim. This is a practical reading of the terms, not legal advice. The owner's decisions of 18 October 2026 are recorded under [Decisions](#decisions): the site uses only sources that are freely available and usable without asking for permission, so the British Geological Survey and the World Gold Council are left out.

The licence and attribution of each source are also recorded in the `datasets` table (rows in [Recording in `datasets`](#recording-in-datasets)). The CSV export repeats them.

## At a glance

| Source | Used for | Access | Licence (as read) | Status |
|---|---|---|---|---|
| [World Bank Commodity Price Data (Pink Sheet)](#1-world-bank-commodity-price-data-pink-sheet) | Monthly gold price | XLSX download | CC BY 4.0 (World Bank default for datasets) | ✅ Primary price |
| [IMF Primary Commodity Prices (PCPS)](#2-imf-primary-commodity-prices-pcps) | Price fallback and cross-check | SDMX 3.0 API, no key | IMF data terms | ✅ Fallback |
| [IMF International Liquidity (IL)](#3-imf-international-liquidity-il) | Central bank gold holdings, total reserves | SDMX 3.0 API, no key | IMF data terms | ✅ Primary; 17 of 54 countries have no gold series |
| [USGS Mineral Commodity Summaries](#4-usgs-mineral-commodity-summaries-mcs) | Latest production and in-ground reserves | Gold chapter PDFs, editions 2022–2026 | CC0 / US public domain | ✅ Lists 2 to 6 African producers per edition |
| [USGS Minerals Yearbook, Africa](#5-usgs-minerals-yearbook-volume-iii-africa) | Production history by country (2012 on) | Country chapter XLSX files | US public domain | ✅ Main history; latest chapters 2020–21 to 2023 |
| [BGS World Mineral Statistics](#6-bgs-world-mineral-statistics) | — | OGC API, no key | Non-commercial academic and research use; republishing needs permission | ⛔ Not used (owner's decision) |
| [UN Comtrade](#7-un-comtrade) | Gold trade (reported and mirror), partners, total exports | REST API with key | Internal use; limited publication allowed | ✅ Used within the limited-publication allowance |
| [Wikidata](#8-wikidata) | Gold mines layer (optional) | SPARQL | CC0 | ✅ Evaluated; below the quality bar, so the layer is off |
| [Curated citations](#9-curated-citations-presence-overrides-and-profile-notes) | Presence evidence, profile notes | Manual citations | Per item | ✅ Facts and short quotes only |
| [World Gold Council (Goldhub)](#10-world-gold-council-goldhub) | — | — | Personal non-commercial use only | ⛔ Not used, not linked (owner's decision) |
| [LBMA Gold Price (IBA)](#11-lbma-gold-price) | Not used | — | Licence from IBA required | ⛔ Not used |

---

## 1. World Bank Commodity Price Data (Pink Sheet)

**Provides.** The monthly gold price in nominal US$ per troy ounce from 1960 (the file stores whole dollars), in the "Monthly Prices" sheet (column "Gold", unit "($/troy oz)"). The October 2026 file runs to **2026-M09 = 4,319** and is marked "Updated on October 02, 2026". It also includes an annual file, which we do not need: `v_gold_price_annual` computes the annual mean and year-end value from the monthly series.

**What the price is.** The workbook's Description sheet defines the series as:

> "Gold, spot average of daily rates, from June 2025; previously (UK), 99.5% fine, London afternoon fixing, average of daily rates"

It is a **monthly average**, not a spot price, and the UI labels it that way. Before June 2025 it is an average of the London afternoon fixing, which is the LBMA price. The World Bank's published monthly averages are used under its CC BY 4.0 dataset terms, not LBMA daily prices ([Decisions](#decisions)).

**Access.**
- Monthly: `https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx`
- The file name is stable, but the path's document ID changes with each release. The pipeline therefore reads the current link from `https://www.worldbank.org/en/research/commodity-markets` and falls back to the last cached file. One download per run.

**Licence.** Neither the commodity-markets page nor the workbook carries a dataset-specific licence. That page links to the World Bank's dataset terms (`https://www.worldbank.org/ext/en/legal/terms-conditions/datasets`), which say:

> "Unless specifically labeled otherwise, these Datasets are provided to you under a Creative Commons Attribution 4.0 International License (CC BY 4.0), with the additional terms below."

The same terms add:

> "Some datasets and indicators are provided by third parties, and may not be redistributed or reused without the consent of the original data provider… Where applicable, these conditions are included in the dataset or indicator metadata."

The workbook's metadata for gold carries no such restriction. Its general source note lists Bloomberg, Kitco, IMF IFS, the London Bullion Market and others.

The World Bank's general website terms ("non-commercial uses" only) cover its other materials, not datasets. We rely on the dataset terms.

**Attribution.** The required format is "The World Bank: Dataset name: Data source (if known)". We will use:

> The World Bank: Commodity Price Data (The Pink Sheet), monthly prices: World Bank Prospects Group. CC BY 4.0.

**Rate limits.** None stated for file downloads. The API terms ask for "reasonable request volume". We make one download a month.

**Cadence.** Monthly, early in the month. The page shows "Next update: November 3, 2026". The pipeline's monthly cron runs after the 5th.

## 2. IMF Primary Commodity Prices (PCPS)

**Provides.** The monthly gold price, US$ per troy ounce: series `G001.PGOLD.USD.M` in dataflow `IMF.RES/PCPS` (v9.0.0). It also has index forms we do not use (`INDEX`, `INDEX_PCH`, `INDEX_PCHY`). Latest: **2026-M09 = 4,334.75**.

**Access.** `GET https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/PCPS/+/G001.PGOLD.USD.M?c[TIME_PERIOD]=ge:<yyyy-mm>`. No key. One call per run.

**Use.** It is a fallback only, used if the World Bank series is unavailable or discontinued. It is also a cross-check: the pipeline warns when the two series differ by more than 2% in any month (September 2026 differs by 0.4%).

The two series are never mixed silently. Each month's row keeps its `source_id`, and the review report lists any month taken from the fallback.

**Licence and attribution.** As for [IMF IL](#3-imf-international-liquidity-il) below. Attribution: "Source: International Monetary Fund, Primary Commodity Price System (PCPS), https://data.imf.org/".

**Cadence.** Monthly.

## 3. IMF International Liquidity (IL)

**Provides.** Central bank gold holdings and total reserves. The IMF has moved its data platform: the former IFS reserves series now live in dataflow **`IMF.STA/IL`** (International Liquidity, v13.0.1). Its key is `COUNTRY.INDICATOR.UNIT.FREQUENCY`.

| Indicator | Meaning | Units available |
|---|---|---|
| `RGV_REVS` | Official reserve assets: gold, **volume** | `FTO` (fine troy ounces) |
| `RGOLDMV_REVS` | Official reserve assets: gold, **market value** | `XDR` only |
| `TRGMV_REVS` | Total reserves, including gold at market value | `USD`, `XDR` |

**Access.**
`GET https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/IL/+/<ISO3+ISO3…>.RGV_REVS+RGOLDMV_REVS+TRGMV_REVS.*.M?c[TIME_PERIOD]=ge:<yyyy-mm>`
- No key.
- All 54 countries fit in one targeted call: a monthly refresh is one or two calls, and the full history is fetched once and cached.
- Tested: Ghana held 790,264.206 fine troy ounces (24.58 t) in 2026-M07.

**Coverage of Africa (tested on 17 October 2026).** This is the main caveat:
- **24 countries** have reported gold volume since January 2024. The latest months are 2024-M06 (Burundi) to 2026-M09 (Mauritius).
- **13 countries** have only older series, and the last observation is too old to show as current:
  - Chad 2022-M09; Cameroon 2023-M09; Central African Republic 2023-M10;
  - Zambia 2021-M06; Eritrea 2019-M12; Mauritania 2019-M08;
  - Namibia 2019-M03; Congo 2019-M03; Gabon 2019-M01;
  - Malawi 2015-M11; Tanzania 2014-M12; Rwanda 2004-M12; Somalia 1990-M03.
- **17 countries have no gold series at all:**
  - **The 8 BCEAO members**: Benin, Burkina Faso, Côte d'Ivoire, Guinea-Bissau, Mali, Niger, Senegal and Togo. Their reserves, including gold, are pooled at the regional central bank, so there is no national figure.
  - **9 countries that report total reserves but no gold line**: Angola, Botswana, Djibouti, Eswatini, The Gambia, Madagascar, São Tomé and Príncipe, Seychelles and Sudan (last 2017).

  All 17 are stored as **no data (NULL)**, never as zero. The UI explains "Reserves pooled at the BCEAO" for the eight members.
- Several countries report a **zero** (Kenya, Ethiopia, Liberia, Uganda, DR Congo, Lesotho, Cabo Verde, Equatorial Guinea, Sierra Leone, South Sudan). That is a reported zero and is shown as 0 t.
- Some recent central bank gold purchases (Tanzania, for example) do not appear in IL. We show only what the IMF publishes, with its date, and the review report lists the late reporters.

**Valuation.**
- IL gives the gold value in XDR only. Following the spec, **USD values are computed** as tonnes × that month's average price (World Bank) and marked `valuation = computed`.
- This is end-of-month tonnage at a monthly-average price, so it will differ slightly from the IMF's own market valuation.
- `pct_of_total_reserves` is computed from **source values in the same currency and month** (`RGOLDMV_REVS` XDR ÷ `TRGMV_REVS` XDR). It needs no conversion and no price.

**Licence.** The IMF's Copyright and Usage terms (`https://www.imf.org/en/About/copyright-and-terms`, "Special Terms for Statistical Data") say:
- > "Users may download, extract, copy, create derivative works, publish, distribute, and use Data obtained from IMF Sites subject to these conditions"
- > "If material transformation occurs, it must be stated explicitly along with the required source citation."
- > "The IMF prohibits bulk download of information by automated technology without explicit permission"
- > "For any potential commercial reuse of IMF Data, email copyright@imf.org to request permission."

Our calls are targeted (one key list per run) and cached, which is not a bulk download.

**Attribution.** Required wording: "Source: International Monetary Fund, Database Name, <link to the dataset>". We will use:

> Source: International Monetary Fund, International Liquidity (IL), https://data.imf.org/. Transformed by Bara La Afrika: fine troy ounces converted to tonnes; US dollar values computed from the World Bank monthly average gold price; share of reserves computed.

**Rate limits.** None published on the API page. We make one or two calls per run.

**Cadence.** Monthly, with about a two-month lag; some countries report late or irregularly (see above). The monthly cron runs it with the price.

## 4. USGS Mineral Commodity Summaries (MCS)

**Provides.** The world table of each edition's gold chapter: mine production for two years (the second always an estimate) and reserves, for the countries it lists by name. The pipeline reads the editions 2022 to 2026. Between them they list six African producers:

| Edition | Years | African countries listed |
|---|---|---|
| 2022 | 2020, 2021e | Burkina Faso, Ghana, South Africa, Sudan, Tanzania |
| 2023 | 2021, 2022e | Burkina Faso, Ghana, Mali, South Africa, Sudan, Tanzania |
| 2024 | 2022, 2023e | Burkina Faso, Ghana, Mali, South Africa, Tanzania |
| 2025 | 2023, 2024e | Burkina Faso, Ghana, Mali, South Africa, Tanzania |
| 2026 | 2024, 2025e | Ghana, South Africa |

- **"Other countries."** Every other producer is inside the "Other countries" row. It is stored as `included_in_other` with null tonnes, never 0, and only where the yearbook (§5) shows the country producing gold in the five years before. A country with no gold output is not "included in other".
- **In-ground reserves.** MCS is the only source of in-ground reserves (`gold_inground_reserves`; definitions in MCS Appendix C). "NA" means no data, not zero.

  | Country | Reserves | Note |
  |---|---|---|
  | Ghana | 1,000 t | |
  | Mali | 800 t | |
  | Tanzania | 400 t | until the 2025 edition |
  | South Africa | 5,000 t | |

**Access.**
- **Gold chapter PDF.** `https://pubs.usgs.gov/periodicals/mcs<edition>/mcs<edition>-gold.pdf`, one PDF per edition, cached. The pipeline parses the world table from the text and refuses any value with a footnote number glued to it.
- **Data release (not used).** The 2026 data release (DOI `10.5066/P1WKQ63T`) sits on ScienceBase behind a Cloudflare challenge, which returns HTTP 403 to scripts.

**Licence.**
- **Data release:** CC0 1.0 (DataCite metadata for the DOI).
- **USGS policy:** "USGS-authored or produced data and information are considered to be in the U.S. Public Domain."

**Attribution.** USGS asks that "proper credit be given". We use:

> U.S. Geological Survey, Mineral Commodity Summaries 2022–2026: Gold, and Minerals Yearbook, volume III (Africa).

**Rate limits.** None; one PDF per edition.

**Cadence.** Annual, each January or February. When a new edition is out:
1. Add the edition to `gold_config.json`.
2. Run `gold-production` by hand, or as a manual workflow run.

## 5. USGS Minerals Yearbook, volume III (Africa)

**Provides.** Gold mine production by country, five years per edition. The figures come from each country chapter's production table (Table 1).

This is the main production history. The editions published as .xlsx since 2016 give figures from 2012 to between 2021 and 2023, depending on the country. Public domain.

- **Coverage.**
  - 37 countries have figures.
  - The latest chapters are the 2020–21 edition for most countries, 2022 for 23 countries and 2023 for a few.
  - Six countries have no production table in these editions: Cabo Verde, Comoros, The Gambia, Guinea-Bissau, São Tomé and Príncipe and Somalia.
- **Units and symbols.**
  - Figures are in kilograms, or in the table's default unit, and are converted to tonnes. "do." means ditto (the unit of the row above).
  - "--" is a reported zero.
  - "NA" is no data and is never stored as zero.
  - "e", as a flag or a trailing e on the row label, marks an estimate.
- **Splits.** Where a chapter gives artisanal and large-scale rows (Ghana, Liberia), the figure is their sum and the artisanal share is kept.
- **Notes kept as evidence.** Each figure's footnotes are kept verbatim. For example:
  - Mali: "Does not include artisanal gold production, which was estimated to be more than 6,000 kilograms."
  - Togo: "Data reported by the Government of Togo as exports predominately include artisanal gold mine production transiting Togo from neighboring countries…"
  - Some figures are reported exports or sales (Ethiopia, Madagascar, Eritrea).
- **Other evidence.** Two kinds of entry support the "occurrences known" tier:
  - a table note listing gold among commodities that "may have been produced", without an estimate;
  - gold operations in the structure-of-industry table (Table 2).
- **Left out.** Figures the USGS attributes to the World Gold Council are excluded, following the owner's decision to leave WGC data out. This affects Sudan 2017–2021 in the 2020–21 edition; Sudan's figures come from the other editions instead.

**Access.** Each country's page, `https://www.usgs.gov/centers/national-minerals-information-center/<country>`, links its chapters.
- The pipeline reads the .xlsx links. It prefers a final release to an advance release of the same edition.
- That is about 200 workbooks, each fetched once at one request a second and cached.

**Licence and attribution.** US public domain. Credit: "U.S. Geological Survey, Minerals Yearbook <edition>, volume III: <country>".

**Cadence.** Irregular, two to four years behind.

## 6. BGS World Mineral Statistics

**Not used.** On 18 October 2026 the owner decided to use only sources that need no permission. The notes below are kept for the record, in case permission is sought later.

**Provides.** Gold mine production by country and year, with notes. It is the longest and most complete series for Africa.
- The API holds records to **2024**. Its own description still says "1970 to 2022", but Mali has 2024 data.
- Mali, for example: 66,713 kg in 2024; the years up to 2019 are noted "Estimates."
- Values are in kilograms (metal content), converted to tonnes.

**Access.**
- OGC API – Features: `https://ogcapi.bgs.ac.uk/collections/world-mineral-statistics/items?f=json&country_iso3_code=<ISO3>&bgs_commodity_trans=gold, mine&bgs_statistic_type_trans=Production`
- No key. One call per country, paged at most once; 54 calls for a full refresh.
- Useful fields: `year`, `quantity`, `units`, `concat_figure_notes_text`, `data_precision_description`, `country_iso3_code`.

**Null versus zero.** BGS's download page warns: "API results only return 0 or NULL". The yearbook's symbols map as follows:

| Yearbook symbol | Meaning | API value |
|---|---|---|
| … | Figures not available | NULL |
| 0 | Less than half the unit shown | NULL |
| — | Nil | 0 |
| * | Estimated | 0 |

So an API NULL may hide a tiny non-zero output, and an API 0 may be an estimate rather than a reported zero. Therefore:
- API NULL is stored as NULL;
- API 0 is stored as 0 only when the year's note does not say it is estimated; otherwise it is NULL;
- both cases are listed in the review report.

The "Estimates." note maps to `basis = estimate`.

**Licence.** No Open Government Licence is stated. The terms page (`https://www.bgs.ac.uk/mineralsuk/statistics/world-mineral-statistics/bgs-mineral-statistics-terms-and-conditions-ipr/`) says:

> "You may adapt and use these tables for non-commercial academic and research purposes, however should you wish to use them for any commercial purpose or provide them to a third party, you need to satisfy yourself that you have permission from the original copyright owner (where NERC is providing tables with permission and is not the copyright holder) or seek NERC's permission where the copyright is held by NERC."

Publishing figures on a public website, and in a CSV export, arguably "provides them to a third party", which needs permission (ipr@bgs.ac.uk).

**Attribution (required wording).** "World Mineral Statistics contributed by permission of the British Geological Survey".

**Rate limits.** None stated. We make 54 small calls, cached.

**Cadence.** Annual; the production survey covers years up to about two years before publication.

## 7. UN Comtrade

**Provides.** Annual merchandise trade:
- gold exports and imports **as reported by each African country** (value in USD, net weight in kg);
- the **top 10 partners**;
- the **mirror**: what partners report importing from, or exporting to, each country;
- **total merchandise exports** (`cmdCode=TOTAL`), used for gold's share of exports.

**Access.** `GET https://comtradeapi.un.org/data/v1/get/C/A/HS`, with the key in the header `Ocp-Apim-Subscription-Key`, read from `COMTRADE_API_KEY`.
- **The key is set in `.env` and works:** one test call returned HTTP 200.
- Reporter and partner are M49 codes (Ghana = 288).

| Need | Parameters |
|---|---|
| Reported totals | `reporterCode=<country>&partnerCode=0&flowCode=X,M` |
| Top partners | `reporterCode=<country>&flowCode=X,M` (all partners; rank in the pipeline) |
| Mirror (both flows) | `partnerCode=<country>&flowCode=X,M` (all reporters; their imports are the country's exports) |
| Total exports | `cmdCode=TOTAL&reporterCode=<list of 18>&partnerCode=0&flowCode=X` |

Every call asks for heading 7108 and subheading 7108.20 together, for the years 2015 to last year.

**Pitfalls found while testing** (each becomes a pipeline rule and test):
- **Breakdown rows.** Without filters, the API returns one row per customs procedure and transport mode. Ghana 2023 came back as 4 rows with the same value, which would be counted 4 times. Every call pins `customsCode=C00&motCode=0&partner2Code=0`.
- **Net weight, not quantity.** Ghana 2023 exports report `netWgt` = 161,094 kg (161 t, plausible) but `qty` = 3,489,205 "kg" (impossible). We use `netWgt` only, and flag rows where it is missing or zero. When the World row has no weight but every partner row has one, the partners are summed, and the row says so. A mirror total needs every partner's weight; otherwise it has none.
- **Aggregate reporters.** The European Union (97) reports alongside its members, so it is excluded from mirror sums to avoid double counting.
- **HS 7108 also contains monetary gold.** 7108.11, .12 and .13 are non-monetary; 7108.20 is monetary gold. The spec calls 7108 "non-monetary gold", so we store 7108 minus 7108.20 as `hs_code = '7108.1'` (non-monetary gold).
- **Subheadings differ by country.** Ghana files 99.7% of its exports under 7108.13 (semi-manufactured) rather than 7108.12 (unwrought). Reported and mirror figures are compared at the 4-digit level only.

**Licence.**
- The Comtrade data-use policy (`https://uncomtrade.org/docs/policy-on-comtrade-data-use/`) says:
  > "UN Comtrade data are provided for internal use only and may not be re-disseminated in any form without UNSD's permission."
- The re-dissemination page (`https://uncomtrade.org/docs/re-dissemination-of-data/`) makes exceptions: no permission or fee is needed for
  > "Publication of limited amounts of UN Comtrade data in a few tables, graphs, visualization in printed or digital platform, regardless for profit or not-for-profit purposes"

  or for a
  > "Free-of-charge data extraction and/or streaming application offering only a small number of records (up to 100,000)"

  It also says:
  > "Transformed data from UN Comtrade is no longer subject to copyright restrictions."

  However, rounding, pivoting, filtering and format conversion do not count as transformation.

Our use is 6,930 records in the first build: 1,468 country-year flows, 5,000 partner rows and 462 total-export rows. That is well under 100,000, the "limited amounts" case, which needs no permission.

**Attribution.** The policy says "refer to the data source as 'UN Comtrade'". We will use:

> UN Comtrade, United Nations Statistics Division (HS 7108, annual).

**Rate limits.** Free tier: 500 calls a day, 1 call a second, up to 100,000 records per call.
- A full refresh is 111 calls, each with the list of years:
  - 54 for each country's own reports (World and partners);
  - 54 for the mirror;
  - 3 for total exports (18 reporters per call).
- The pipeline paces calls at 1.2 seconds and caches every response (never an error response). It stops at 450 calls a day and resumes from the cache on the next run.

**Cadence.** Annual data arrives country by country, often one to two years late, and is revised. The scheduled refresh re-fetches everything monthly: 111 calls, within the free tier.

## 8. Wikidata

**Provides.** Candidate gold mines with coordinates for the optional map layer.
- **Selection:** items in the 54 countries whose "product or material produced" (P1056) is gold (Q897) or gold ore (Q12528662).
- **Kept:** items that are a mine, gold mine, surface mining or artisanal mining site, with coordinates.
- **Shipping rule:** the layer ships only if it passes the quality bar in `gold_config.json` (spec 5.6.6). Every dropped item is listed with the reason.

**Result of the first build: not enabled.** Of 189 items, 155 were kept and 34 dropped. The layer fails all three checks:

| Check | Result | Bar |
|---|---|---|
| Producing countries covered | 54% | 60% |
| Operating status known | 0% | 50% |
| Largest single-country share (South Africa) | 59% | 40% at most |

No curated additions were made. The largest mines would each need a cited source, and the layer would still lack operating status.

**Access.** The Wikidata Query Service (SPARQL), with a descriptive User-Agent and cached results, as in the Harim pipeline. Query budget: a 60-second limit per query; two or three queries per run.

**Licence and attribution.** CC0 for structured data, so no attribution is required. We credit "Wikidata" anyway, with each item's QID linked.

**Cadence.** On demand (`gold-mines`).

## 9. Curated citations (presence overrides and profile notes)

**Provides.** Evidence for `presence_tier` where the USGS tables are silent or misleading, and the short `gold-profiles` notes (artisanal mining, national gold purchase and trading policies, major mines and discoveries).

**Access.** Manual curation in `db/seeds/gold_presence_overrides.json` and `db/seeds/gold_profile_notes.json`. Each entry carries a citation (title, URL, type and reliability tier), the exact quote it relies on, the date the quote refers to and the date it was checked.

**Quote checks.** Every run fetches each cited source (cached under `data/raw/gold/citations/`), reads it as text (HTML page, PDF report or .xlsx table) and checks that the quote is there word for word, ignoring only case, punctuation and spacing. A missing quote stops the run; a source that cannot be fetched marks the entry for review. An entry without a full citation is loaded as `needs_review`. Notes avoid allegations about governments, companies or individuals (smuggling, armed groups) even where a source makes them.

**Presence overrides (7, owner's decisions of 18 October 2026):**

| Country | Tier | Evidence |
|---|---|---|
| Togo | Producer (low confidence) | USGS Minerals Yearbook 2019: the ~20 t a year are exports that "predominately include artisanal gold mine production transiting Togo from neighboring countries and, to a lesser extent, domestic artisanal mine production". Downgraded from major producer. |
| Somalia | Occurrences known (medium) | Global Initiative Against Transnational Organized Crime (2026): artisanal gold mining at Milxo, "one of Africa's least-known gold booms". |
| Guinea-Bissau | Occurrences known (low) | Wikipedia, Geology of Guinea-Bissau: "Some small, low-grade gold anomalies exist in the northeast of Guinea-Bissau." |
| Cabo Verde, The Gambia, São Tomé and Príncipe | None identified (low) | USGS Minerals Yearbook 2019, "Other Countries of Africa": the minerals that may have been produced are listed, and gold is not among them. |
| Comoros | None identified (medium) | USGS Minerals Yearbook 2022, Indian Ocean Islands: Comoros "did not produce any minerals". |

No country is left as "unknown".

**Profile notes (53 curated, for 31 countries, plus the USGS footnotes quoted automatically, §5).** Mostly from the USGS Minerals Yearbook chapters' prose (public domain; the 2019 to 2022 editions, so each note carries its date). Recent policy notes come from:
- Ghana: the Ghana Gold Board's own site (GoldBod as sole buyer and exporter, 2025);
- Tanzania: FB Attorneys' legal update on the 20% set-aside for local sale (October 2024) and The Chanzo's report of the Bank of Tanzania Governor's statement on gold bought by 13 June 2025;
- Zimbabwe: FactCheckZW's explainer on the ZiG currency (April 2024).

**Licence.** Varies by publisher. We store facts and short quotations with attribution, never tables or substantial extracts.

**Attribution.** The citation shown with each note and tier, and in the drawer.

**Cadence.** Quotes are re-checked on every run; entries are reviewed when production or trade data change a country's tier.

## 10. World Gold Council (Goldhub)

**Not used, and not linked** (owner's decision, 18 October 2026).
- The site has no "Explore on Goldhub" links and no WGC figures.
- `wgc_import.py` (spec 5.6) is not built for now, and `ENABLE_WGC_IMPORT` stays `false`.
- Figures the USGS attributes to the WGC are left out too (§5).
- Central bank holdings come from the IMF directly, which is where the WGC's own figures come from.

**Terms**, read 17 October 2026 (`https://www.gold.org/terms-and-conditions`), for the record:
- > "You are permitted to save, display or print out information contained on this Website only for your personal, non-commercial use."
- > "Except as otherwise permitted by these terms and conditions, you are not permitted to modify, copy, scrape, distribute, transmit, display, reproduce, duplicate, publish, license, frame, link, create derivative works from, transfer or otherwise use in any manner, in whole or in part, this Website or the information and materials on this Website without the prior written authorisation of WGC and with suitable accreditation to WGC."
- On LBMA prices shown by the WGC: > "LBMA Gold Price information provided by WGC … may not be disclosed by you to anyone else."

## 11. LBMA Gold Price

**Not used.** LBMA (`https://www.lbma.org.uk/prices-and-data`):
> "A licence from IBA is required in order to obtain, use or redistribute real-time or historical benchmark data"

ICE Benchmark Administration confirms the prices are "available under licence from IBA". No LBMA price is fetched, stored or shown. The site's price is the World Bank's monthly average (§1).

---

## Decisions

The owner decided on 18 October 2026: "Ignore the BGS and WGC sources for now. Just use what is freely available and allowed without the requirement of seeking approval."

1. **BGS:** not used. Production history comes from the USGS Minerals Yearbook country chapters (§5) and the MCS (§4), both public domain.
2. **WGC:**
   - not used and not linked;
   - no import adapter for now;
   - figures the USGS attributes to the WGC are left out.
3. **UN Comtrade:** used under the re-dissemination policy's "limited amounts" allowance, which needs no permission (6,930 records). The key is set locally; add it as the GitHub Actions secret `COMTRADE_API_KEY` for the scheduled refresh.
4. **Gold price:** the World Bank's monthly averages, under its CC BY 4.0 dataset terms (no permission needed). No LBMA prices.
5. **HS code:** non-monetary gold is 7108 minus 7108.20, stored as `hs_code = '7108.1'`.
6. **Central bank holdings in US dollars:** tonnes × that month's World Bank average price (`valuation = computed`). Gold's share of reserves uses the IMF's own SDR values.

## Recording in `datasets`

The `gold-*` pipelines upsert these rows. Licence and attribution are shown in the ribbon, the drawer and the CSV export.

| `key` | Licence | Attribution text |
|---|---|---|
| `gold-price` | CC BY 4.0 | The World Bank: Commodity Price Data (The Pink Sheet), monthly prices: World Bank Prospects Group. CC BY 4.0. (The IMF PCPS attribution if the fallback is ever used.) |
| `gold-official-reserves` | IMF Copyright and Usage terms | Source: International Monetary Fund, International Liquidity (IL), https://data.imf.org/. Transformed by Bara La Afrika: fine troy ounces converted to tonnes; US dollar values computed from the World Bank monthly average gold price; share of reserves computed. |
| `gold-production` | US public domain (MCS data release CC0) | U.S. Geological Survey, Mineral Commodity Summaries 2022–2026: Gold, and Minerals Yearbook, volume III (Africa). |
| `gold-trade` | UN Comtrade terms (limited publication) | UN Comtrade, United Nations Statistics Division (HS 7108, annual). |
| `gold-presence` | Derived data; each tier cites its source | Presence tiers derived by Bara La Afrika from the cited sources. |
| `gold-mines` | CC0 | Gold mine locations from Wikidata (CC0). Loaded only when the layer passes its quality bar. |

## Schedule

| Pipeline | Source | Runs |
|---|---|---|
| `gold-price` | World Bank (IMF PCPS fallback) | Monthly (first Monday; the World Bank publishes early in the month) |
| `gold-official-reserves` | IMF IL | Monthly, after `gold-price` (values need that month's price) |
| `gold-production` | USGS MCS and Minerals Yearbook | By hand, or as a manual workflow run, when a new edition is out (MCS: January or February) |
| `gold-trade` | UN Comtrade | Monthly, within the daily call budget |
| `gold-mines` | Wikidata | On demand |
| `gold-presence`, `gold-profiles` | Derived plus curated | After the others, every monthly run (`gold-profiles` also validates and writes the two reports) |

`python -m pipelines gold` runs them all in order. Every run updates `datasets.as_of`, `coverage_start` and `coverage_end`, so the ribbon shows each source's range.
