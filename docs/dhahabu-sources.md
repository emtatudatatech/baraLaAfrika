# Dhahabu data sources and licences

This document records, for every source behind the Dhahabu (gold) tab:
- what the source provides;
- how it is accessed;
- its licence and the attribution it requires;
- its rate limits and update cadence.

Every terms page was re-read on **17 October 2026**, and every endpoint below was tested live that day with targeted calls. Quotes are verbatim. This is a practical reading of the terms, not legal advice. Anything unclear is listed under [Decisions needed](#decisions-needed) rather than resolved here.

The licence and attribution of each source are also recorded in the `datasets` table (proposed rows in [Recording in `datasets`](#recording-in-datasets)). The CSV export repeats them.

## At a glance

| Source | Used for | Access | Licence (as read) | Status |
|---|---|---|---|---|
| [World Bank Commodity Price Data (Pink Sheet)](#1-world-bank-commodity-price-data-pink-sheet) | Monthly gold price | XLSX download | CC BY 4.0 (World Bank default for datasets) | ✅ Primary price |
| [IMF Primary Commodity Prices (PCPS)](#2-imf-primary-commodity-prices-pcps) | Price fallback and cross-check | SDMX 3.0 API, no key | IMF data terms | ✅ Fallback |
| [IMF International Liquidity (IL)](#3-imf-international-liquidity-il) | Central bank gold holdings, total reserves | SDMX 3.0 API, no key | IMF data terms | ✅ Primary; 17 of 54 countries have no gold series |
| [USGS Mineral Commodity Summaries 2026](#4-usgs-mineral-commodity-summaries-mcs) | Latest production and in-ground reserves | Data release (CC0) or the chapter PDF | CC0 / US public domain | ✅ Only Ghana and South Africa are listed for Africa |
| [USGS Minerals Yearbook, Africa](#5-usgs-minerals-yearbook-volume-iii-africa) | Country production cross-check | XLSX download | US public domain | ✅ Latest Africa tables are the 2020–21 edition |
| [BGS World Mineral Statistics](#6-bgs-world-mineral-statistics) | Production history by country (1970–2024) | OGC API, no key | Non-commercial academic and research use; republishing needs permission | ⚠️ Decision needed |
| [UN Comtrade](#7-un-comtrade) | Gold trade (reported and mirror), partners, total exports | REST API with key | Internal use; limited publication allowed | ✅ Key works; ⚠️ confirm the publication allowance |
| [Wikidata](#8-wikidata) | Gold mines layer (optional) | SPARQL | CC0 | ✅ |
| [Geological surveys and literature](#9-national-geological-surveys-and-literature) | Presence evidence, profile notes | Manual citations | Per item | ✅ Facts and short quotes only |
| [World Gold Council (Goldhub)](#10-world-gold-council-goldhub) | Methodology reference; optional manual import | None automated | Personal non-commercial use only | ⛔ Not scraped or republished; ⚠️ linking needs a decision |
| [LBMA Gold Price (IBA)](#11-lbma-gold-price) | Not used | — | Licence from IBA required | ⛔ Not used |

---

## 1. World Bank Commodity Price Data (Pink Sheet)

**Provides.** The monthly gold price in nominal US$ per troy ounce from 1960, in the "Monthly Prices" sheet (column "Gold", unit "($/troy oz)"). The October 2026 file runs to **2026-M09 = 4,319** and is marked "Updated on October 02, 2026". It also includes an annual file, which we do not need: `v_gold_price_annual` computes the annual mean and year-end value from the monthly series.

**What the price is.** The workbook's Description sheet defines the series as:

> "Gold, spot average of daily rates, from June 2025; previously (UK), 99.5% fine, London afternoon fixing, average of daily rates"

It is a **monthly average**, not a spot price, and the UI labels it that way. Before June 2025 it is an average of the London afternoon fixing, which is the LBMA price; see [decision 5](#decisions-needed).

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

**Provides.** World mine production (2024 and 2025e) and reserves by country, from the gold chapter of MCS 2026.
- **Only Ghana and South Africa** are listed individually for Africa:
  - Ghana: 149 t (2024), 150 t (2025e), reserves 1,000 t;
  - South Africa: 90 t and 90 t, reserves 5,000 t.
- Every other African producer is inside "Other countries" (1,020 t in 2024; 1,000 t in 2025e). Those countries are stored as `included_in_other` with null tonnes, never 0.
- MCS is therefore the latest-year source for two countries and the **only source of in-ground reserves** (`gold_inground_reserves`, defined in MCS Appendix C). In-ground reserves exist only for Ghana and South Africa.

**Access.**
- Data release: "Mineral Commodity Summaries 2026 Data Release", DOI `10.5066/P1WKQ63T`, CSV `MCS2026_Commodities_Data.csv`. ScienceBase sits behind a Cloudflare challenge, so scripts get HTTP 403.
- The pipeline therefore parses the gold chapter PDF, `https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-gold.pdf`. It is accessible, and the spec allows this route.
- If you download the CSV by hand into `data/source/usgs/`, the pipeline prefers it.

**Licence.**
- The data release is **CC0 1.0** (DataCite metadata for the DOI).
- USGS policy: "USGS-authored or produced data and information are considered to be in the U.S. Public Domain."

**Attribution.** USGS asks that "proper credit be given". We will use:

> U.S. Geological Survey, Mineral Commodity Summaries 2026: Gold (doi:10.5066/P1WKQ63T).

**Rate limits.** None; one PDF per edition.

**Cadence.** Annual, each January or February. The pipeline is run by hand when a new edition is out.

## 5. USGS Minerals Yearbook, volume III (Africa)

**Provides.** Gold mine production by African country, five years per edition. Public domain.
- The latest Africa summary workbook is the **2020–21 edition** (`myb3-2021-Africa_Summary-ERT.xlsx`, data through 23 June 2021), so it is several years behind BGS.
- Its notes are informative. For example: "Data reported by the Government of Togo as gold exports that predominantly include artisanal gold mine production transiting Togo from neighboring countries".

**Access.** XLSX links on `https://www.usgs.gov/centers/national-minerals-information-center/africa-and-middle-east`. No key.

**Use.** A cross-check for BGS in overlapping years, and a fallback production history if BGS cannot be used ([decision 2](#decisions-needed)).

**Licence and attribution.** US public domain. Credit: "U.S. Geological Survey, Minerals Yearbook, volume III, Area Reports: International—Africa".

**Cadence.** Irregular, a few years behind.

## 6. BGS World Mineral Statistics

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

Publishing figures on a public website, and in a CSV export, arguably "provides them to a third party". See [decision 2](#decisions-needed). Contact: ipr@bgs.ac.uk.

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
| Mirror exports | `partnerCode=<country>&flowCode=M` (all reporters) |
| Mirror imports | `partnerCode=<country>&flowCode=X` (all reporters) |
| Total exports | `cmdCode=TOTAL&reporterCode=<country>&partnerCode=0&flowCode=X` |

**Pitfalls found while testing** (each becomes a pipeline rule and test):
- **Breakdown rows.** Without filters, the API returns one row per customs procedure and transport mode. Ghana 2023 came back as 4 rows with the same value, which would be counted 4 times. Every call pins `customsCode=C00&motCode=0&partner2Code=0`.
- **Net weight, not quantity.** Ghana 2023 exports report `netWgt` = 161,094 kg (161 t, plausible) but `qty` = 3,489,205 "kg" (impossible). We use `netWgt` only, and flag rows where it is missing or zero.
- **HS 7108 also contains monetary gold.** 7108.11, .12 and .13 are non-monetary; 7108.20 is monetary gold. The spec calls 7108 "non-monetary gold". See [decision 6](#decisions-needed).
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

Our use is about 54 countries × about 10 years × 2 flows, plus the top 10 partners and the mirror aggregates. That is an estimated 15,000 to 25,000 records, well under 100,000. It looks like the "limited amounts" case. See [decision 3](#decisions-needed).

**Attribution.** The policy says "refer to the data source as 'UN Comtrade'". We will use:

> UN Comtrade, United Nations Statistics Division (HS 7108, annual).

**Rate limits.** Free tier: 500 calls a day, 1 call a second, up to 100,000 records per call.
- A full refresh is about 250 calls:
  - 54 for reported totals and partners;
  - 54 for mirror exports and 54 for mirror imports;
  - a few for total exports with reporter lists;
  - all with a list of periods per call.
- The pipeline paces calls at 1.2 seconds, caches every response, stops at 450 calls a day and resumes from the cache on the next run.

**Cadence.** Annual data arrives country by country, often one to two years late. The pipeline runs monthly and fetches only years not yet cached or recently revised.

## 8. Wikidata

**Provides.** Candidate gold mines and deposits with coordinates for the optional map layer: items whose "instance of" is a mine (Q820477) or a subclass, with gold among their products, in an African country. Curated additions cover the largest operating mines. The layer ships only if coverage and quality are acceptable (spec 5.6.6), and every dropped item is listed with the reason.

**Access.** The Wikidata Query Service (SPARQL), with a descriptive User-Agent and cached results, as in the Harim pipeline. Query budget: a 60-second limit per query; two or three queries per run.

**Licence and attribution.** CC0 for structured data, so no attribution is required. We credit "Wikidata" anyway, with each item's QID linked.

**Cadence.** On demand, with production.

## 9. National geological surveys and literature

**Provides.** Evidence for `presence_tier` where there is no reported production: documented occurrences, artisanal mining or exploration. It also supports the short `gold-profiles` notes: national purchase programmes, export bans and major discoveries.

**Access.** Manual curation into `db/seeds/gold_presence_overrides.json` and the profile seed. Each entry carries:
- a citation (title, publisher, date, URL);
- the exact quote it relies on;
- the date it was checked.

As in Harim, quotes are checked against the cached source text, and anything unsourced is `needs_review`.

**Licence.** Varies by publisher. We store facts and short quotations with attribution, never tables or substantial extracts.

**Attribution.** The citation shown with each note and in the drawer.

**Cadence.** Reviewed when production or trade data change a country's tier.

## 10. World Gold Council (Goldhub)

**Provides.** Nothing automated. It is used for methodology reference only, plus an optional manual import that is **off by default**.

**Terms.** `https://www.gold.org/terms-and-conditions`, read 17 October 2026:
- > "You are permitted to save, display or print out information contained on this Website only for your personal, non-commercial use."
- > "Except as otherwise permitted by these terms and conditions, you are not permitted to modify, copy, scrape, distribute, transmit, display, reproduce, duplicate, publish, license, frame, link, create derivative works from, transfer or otherwise use in any manner, in whole or in part, this Website or the information and materials on this Website without the prior written authorisation of WGC and with suitable accreditation to WGC."
- On LBMA prices shown by the WGC: > "LBMA Gold Price information provided by WGC … may not be disclosed by you to anyone else."

**What we do.**
- No scraping, no automated access, and no WGC figures in the database or UI.
- `wgc_import.py` reads only XLSX files that you download yourself into `data/source/wgc/`, and only when `ENABLE_WGC_IMPORT=true`. It is currently **false** in `.env`.
- Central bank holdings come from the IMF directly, which is where the WGC's own figures come from.

**Linking.** The list of prohibited acts includes "link". The spec asks for "Explore on Goldhub" deep links. See [decision 4](#decisions-needed).

## 11. LBMA Gold Price

**Not used.** LBMA (`https://www.lbma.org.uk/prices-and-data`):
> "A licence from IBA is required in order to obtain, use or redistribute real-time or historical benchmark data"

ICE Benchmark Administration confirms the prices are "available under licence from IBA". No LBMA price is fetched, stored or shown. The site's price is the World Bank's monthly average (§1).

---

## Decisions needed

1. **Comtrade key: ✅ nothing needed.** The key is set and works. Please also add it as the GitHub Actions secret `COMTRADE_API_KEY` before the scheduled refresh runs (milestone 14 sets up the workflow).

2. **BGS licence: ⚠️ your decision.** BGS allows "non-commercial academic and research purposes". It requires permission to "provide them to a third party", which a public website arguably does. BGS is our only multi-year production series for most African countries: USGS lists only Ghana and South Africa individually, and the USGS Africa yearbook stops at 2020–21. Options:
   - **(a) Recommended:** email ipr@bgs.ac.uk describing the site (educational, free, with attribution, figures shown per country and in a CSV export) and ask for permission. Meanwhile, build the pipeline and load BGS data, but keep it **unpublished** (the API omits BGS rows) until you confirm. The site then shows USGS figures where they exist and "No data" elsewhere.
   - **(b)** Treat the site as non-commercial educational use and publish now, with the required acknowledgement.
   - **(c)** Drop BGS and use the USGS yearbook (public domain, but stops at 2020–21) plus MCS for Ghana and South Africa.

3. **Comtrade publication: ⚠️ please confirm.** Our use looks like the "limited amounts … in a few tables, graphs, visualization" exception, which applies whether or not the site makes money. Our volume (about 15,000 to 25,000 records, including the CSV export) is under the 100,000-record mark. My default is to proceed. Optionally, confirm with subscriptions@un.org.

4. **Goldhub links: ⚠️ your decision.** The WGC terms list "link" among acts that need written authorisation. Options:
   - **(a) Recommended:** no hyperlinks for now. Name Goldhub as the WGC's portal in text only, with the "Explore on Goldhub" links built behind a setting that stays off.
   - **(b)** Link anyway as ordinary citations.
   - **(c)** Ask the WGC, ideally in the same message as a request for permission to import its data (`ENABLE_WGC_IMPORT`).

5. **Price lineage: ⚠️ please confirm.** The World Bank's gold series was, until May 2025, the average of the London afternoon fixing (the LBMA price). We republish the World Bank's published **monthly averages** under its CC BY 4.0 dataset terms, not LBMA daily prices. The gold metadata carries no third-party restriction. My reading is that this is permitted. If you prefer extra caution, the IMF PCPS series is an alternative, but its terms are similar and its sources overlap.

6. **HS code: ℹ️ my default unless you object.** HS 7108 includes 7108.20 (monetary gold). The default:
   - fetch 7108 and 7108.20 in the same calls;
   - store "non-monetary gold" as 7108 minus 7108.20;
   - record `hs_code = '7108.1x'`;
   - flag any country-year where 7108.20 is non-zero.

   Ghana 2023 had no 7108.20 row, which is common.

7. **USD value of central bank holdings: ℹ️ my default.** Tonnes × the World Bank monthly average price for that month (`valuation = computed`), as the spec says. The alternative is converting the IMF's XDR market value to USD with the IMF exchange rate (`valuation = market`).

8. **WGC permission: ℹ️ for you to request if you wish.** Nothing is imported until you have it and set `ENABLE_WGC_IMPORT=true`.

## Recording in `datasets`

The `gold-*` pipelines will upsert these rows. Licence and attribution are shown in the ribbon, the drawer and the CSV export.

| `key` | Licence | Attribution text |
|---|---|---|
| `gold_price_worldbank` | CC BY 4.0 | The World Bank: Commodity Price Data (The Pink Sheet), monthly prices: World Bank Prospects Group |
| `gold_price_imf_pcps` | IMF data terms | Source: International Monetary Fund, Primary Commodity Price System (PCPS), https://data.imf.org/ |
| `gold_reserves_imf_il` | IMF data terms | Source: International Monetary Fund, International Liquidity (IL), https://data.imf.org/ (transformed: tonnes, computed USD, share of reserves) |
| `gold_production_usgs_mcs` | CC0 / US public domain | U.S. Geological Survey, Mineral Commodity Summaries 2026: Gold (doi:10.5066/P1WKQ63T) |
| `gold_production_usgs_myb` | US public domain | U.S. Geological Survey, Minerals Yearbook, volume III, Africa |
| `gold_production_bgs` | BGS terms (permission pending) | World Mineral Statistics contributed by permission of the British Geological Survey |
| `gold_trade_comtrade` | UN Comtrade terms (limited publication) | UN Comtrade, United Nations Statistics Division |
| `gold_mines_wikidata` | CC0 | Wikidata |
| `gold_presence_curated` | Per citation | Cited per country |

## Schedule

| Pipeline | Source | Runs |
|---|---|---|
| `gold-price` | World Bank (IMF PCPS fallback) | Monthly, after the 5th |
| `gold-official-reserves` | IMF IL | Monthly, after `gold-price` (values need that month's price) |
| `gold-production` | USGS MCS, BGS, USGS yearbook | By hand when a new edition is out (MCS: January or February) |
| `gold-trade` | UN Comtrade | Monthly; fetches only new or revised years, within the daily call budget |
| `gold-presence`, `gold-profiles` | Derived plus curated | After production or trade change |
| `gold-mines` | Wikidata | On demand |

Every run updates `datasets.as_of`, `coverage_start` and `coverage_end`, so the ribbon shows each source's range.
