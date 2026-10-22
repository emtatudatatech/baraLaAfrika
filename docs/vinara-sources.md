# Vinara data sources and licences

**Vinara** (Swahili: *leaders*, the plural of *kinara*, "one who leads") compares Africa's 54 states and its five UN M49 regions on population, land area, the economy, prices, currencies, debt, military spending, human development and politics, and names each metric's **cardinal** (the leading country) and **silent contender** (the runner-up). The method is in [vinara-method.md](vinara-method.md).

This document records, for every source behind Vinara:
- what the source provides;
- how it is accessed;
- its licence and the attribution it requires;
- its coverage and update cadence.

Every terms page was read on **22 October 2026**, and every endpoint below was tested live that day. Quotes are verbatim unless marked *paraphrased*. This is a practical reading of the terms, not legal advice. As for Dhahabu ([dhahabu-sources.md](dhahabu-sources.md)), the site uses only sources that are freely available and usable without asking for permission.

## At a glance

| Source | Used for | Access | Licence (as read) | Status |
|---|---|---|---|---|
| [UN M49 standard](#1-un-m49-regions) | The five regions and their members | Web page (no download) | UN site terms: personal, non-commercial | ✅ Used as a cited classification (see the decision) |
| [World Bank WDI](#2-world-bank-world-development-indicators-wdi) | Population, land and surface area, GDP, GDP at purchasing power parity (PPP), real growth, inflation, GNI, GDP per capita (PPP), population growth | REST API, no key | CC BY 4.0 (per indicator) | ✅ Primary for every annual series except debt |
| [IMF World Economic Outlook](#3-imf-world-economic-outlook-weo) | Government gross debt (% of GDP); the latest year where WDI has none | SDMX 3.0 API, no key | IMF data terms | ✅ Debt; recent-year estimates only, labelled; projections never |
| [IMF Exchange Rates (ER)](#4-imf-exchange-rates-er) | Monthly exchange rates for all 54 | SDMX 3.0 API, no key | IMF data terms | ✅ Primary FX series; stale for 5 countries |
| [ECB euro reference rates](#5-ecb-euro-foreign-exchange-reference-rates) | Daily rates for euro-pegged, rand-linked and dollar-pegged currencies | Data Portal API, no key | Free reuse, source quoted, not modified (*paraphrased*) | ✅ Daily series for 22 countries |
| [World Bank International Debt Statistics](#6-world-bank-international-debt-statistics-ids) | External debt by creditor ("major lenders") | Bulk CSV/XLSX, API | CC BY 4.0 | ✅ |
| [UNDP Human Development Report](#7-undp-human-development-report) | Human Development Index | CSV/XLSX; Our World in Data's copy when UNDP's site does not answer | CC BY 3.0 IGO | ✅ |
| [SIPRI Military Expenditure Database](#8-sipri-military-expenditure) | Military spending (US$ and % of GDP) | Via WDI (still SIPRI's terms) | Non-commercial fair use under 10% of the dataset | ⚠️ Fair use only (see the decision) |
| [Wikidata](#9-wikidata) | Heads of state and government; election dates where present | SPARQL | CC0 | ✅ Leaders; elections sparse |
| [Official electoral sources](#10-elections-official-sources-ifes-eisa) | Next national election per country | Manual citations | Facts with a short quote | ✅ Curated, quotes re-checked |
| [IFES ElectionGuide](#10-elections-official-sources-ifes-eisa) | — | Registered API | "personal and non-commercial purposes" | ⏸ Not used without written confirmation |
| [EISA election calendar](#10-elections-official-sources-ifes-eisa) | — | Web page | Republishing and automated collection prohibited | ⛔ Not used (link only) |
| [Yahoo Finance](#11-yahoo-finance) | — | No documented API | Automated access and redistribution need permission | ⛔ Not used |

---

## 1. UN M49 regions

**Provides.** The *Standard country or area codes for statistical use (M49)* of the UN Statistics Division: Africa (002) is split into Northern Africa (015) and Sub-Saharan Africa (202), which holds Eastern (014), Middle (017), Southern (018) and Western Africa (011). Read at <https://unstats.un.org/unsd/methodology/m49/overview/>.

**Membership confirmed** for the five countries that differ from the research document's grouping: Mauritania is in Western Africa; Sudan in Northern Africa; Mozambique, Zambia and Zimbabwe in Eastern Africa. All 54 states have an M49 region, so no fallback mapping is needed. Western Sahara, which M49 lists in Northern Africa, stays outside the 54 as before.

| Region (M49) | States |
|---|---|
| Northern Africa | 6 |
| Western Africa | 16 |
| Middle Africa | 9 |
| Eastern Africa | 18 |
| Southern Africa | 5 |

**Licence.** The M49 pages carry no licence statement; they say M49 "is prepared by the Statistics Division of the United Nations Secretariat primarily for use in its publications and databases". The UN site-wide terms (<https://www.un.org/en/about-us/terms-of-use>) grant use "for the User's personal, non-commercial use, without any right to resell or redistribute them". No download file is offered.

**Use.** The site states which of five regions each country belongs to and cites M49; it does not republish the M49 table, its codes or any compiled UN dataset. A country's region is a fact of classification, cited like any other fact. See [Decisions](#decisions).

## 2. World Bank World Development Indicators (WDI)

**Provides** (indicator codes as in the API):

| Series | Code | Latest year (54 states) |
|---|---|---|
| Population | `SP.POP.TOTL` | 2025 |
| Population growth (%) | `SP.POP.GROW` | 2025 |
| Land area (km²) | `AG.LND.TOTL.K2` | 2024 (all 54) |
| Surface area (km², land and inland water) | `AG.SRF.TOTL.K2` | 2024 |
| GDP (current US$) | `NY.GDP.MKTP.CD` | 2025 for 52; Eritrea 2011, South Sudan 2015 |
| GDP, PPP (current international $) | `NY.GDP.MKTP.PP.CD` | 2025 for 52; Eritrea 2011, South Sudan 2015 |
| Real GDP growth (%) | `NY.GDP.MKTP.KD.ZG` | 2025 for 52 |
| Inflation, consumer prices (%) | `FP.CPI.TOTL.ZG` | 2025 for 45; older or none for the rest |
| GNI (current US$) | `NY.GNP.MKTP.CD` | 2025 |
| GDP per capita, PPP (current international $) | `NY.GDP.PCAP.PP.CD` | 2025 |

GNI's codes are `NY.GNP.*`; the `NY.GNI.*` codes the README of the original project used are not in the API.

**Access.** `https://api.worldbank.org/v2/country/{iso3;…}/indicator/{code}?format=json`, no key. WDI holds only reported or World Bank-estimated history, never projections.

**Licence.** The API's own metadata gives `License_Type` **"CC BY-4.0"** for every series above, except the two military series (section 8). Attribution: *"Source: World Bank, World Development Indicators (CC BY 4.0)."*

**Cadence.** Updated several times a year; refreshed monthly.

## 3. IMF World Economic Outlook (WEO)

**Provides.** `GGXWDG_NGDP` (general government gross debt, % of GDP); and, to fill the year before the edition where WDI has no figure and as a cross-check, `NGDPD` (GDP, US$), `PPPGDP` (GDP at PPP), `PPPPC` (GDP per capita at PPP), `NGDP_RPCH` (real growth) and `PCPIPCH` (inflation). Dataflow `IMF.RES/WEO` 9.0.0 through the IMF SDMX 3.0 API used by Dhahabu (`https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/+/…`), no key.

**Edition.** The response's `PUBLICATION_DATE` gives the edition: 13 October 2026 is the October 2026 WEO. Values are in units (US dollars, not billions).

**Projections.** WEO series run to 2031. The API's observation attribute `DERIVATION_TYPE` is empty, and the series attribute `LATEST_ACTUAL_ANNUAL_DATA` listed in the dataflow's metadata is not returned, so the API does not say which years are actual, estimated or projected. The rule is therefore fixed: years from the edition's year onwards are projections and are never loaded; the year before the edition is loaded only as an **IMF estimate**, labelled as such, and only where WDI has no figure. Eritrea's WEO series stop in 2019.

**Licence.** IMF data terms, as for Dhahabu: free reuse with the IMF named as the source, plus the transformation statement where values are converted.

**Cadence.** April and October editions; refreshed monthly.

## 4. IMF Exchange Rates (ER)

**Provides.** Dataflow `IMF.STA/ER` 4.0.1, dimensions `COUNTRY.INDICATOR.TYPE_OF_TRANSFORMATION.FREQUENCY`. Used: `XDC_USD` (local currency per US dollar), `PA_RT` (period average) and `EOP_RT` (end of period), monthly.

**Coverage, tested for all 54 from January 2013:** every country has a series, but five are stale or short:

| Country | Months | Latest |
|---|---|---|
| Somalia | 66 | 2018-06 |
| Guinea | 101 | 2021-05 |
| Sudan | 122 | 2023-02 |
| Sierra Leone | 133 | 2024-01 |
| Mauritania | 27 | 2022-06 to 2024-08 only |

Zimbabwe starts in 2019 (the RTGS dollar), and its series carries an observation dated **2027-03**, after today: every load rejects periods in the future.

**Licence.** IMF data terms (as above).

**Note.** The IMF's daily "representative rates" page answers automated requests with "Access Denied", so the IMF is used through its API only.

## 5. ECB euro foreign exchange reference rates

**Provides.** Daily reference rates against the euro, including `USD` and `ZAR` (`https://data-api.ecb.europa.eu/service/data/EXR/D.USD+ZAR.EUR.SP00.A`), current to the previous working day (2026-10-21 when tested).

**Daily rates derived from them** (local currency per US$ = parity × EUR rate):
- CFA franc (XOF, 8 states; XAF, 6 states): 655.957 per euro;
- Comorian franc: 491.96775 per euro;
- Cabo Verdean escudo: 110.265 per euro;
- São Tomé and Príncipe dobra: 24.5 per euro (the IMF's 2026 end-of-month rate reads 24.47);
- South African rand directly, and the loti, lilangeni and Namibian dollar at par with it;
- Djiboutian franc: fixed at 177.721 per US dollar.

That gives daily series for 22 of the 54 states. Every parity is checked against the IMF monthly averages (within 1%) before a derived day is stored.

**Licence (*paraphrased* from the ECB's reuse policy and disclaimer pages).** Public ECB statistics may be reused free of charge provided the source is quoted and the statistics are not modified; the reference rates are published for information purposes. The site shows the ECB's rates unchanged and labels the derived rates as derived from them at the official parity. Attribution: *"Source: ECB statistics."*

## 6. World Bank International Debt Statistics (IDS)

**Provides.** External debt stocks by creditor type (multilateral, bilateral, bondholders, commercial banks) and, for bilateral debt, by creditor country: the "major lenders" analysis. Dataset page <https://datacatalog.worldbank.org/search/dataset/0038015>, bulk CSV and XLSX; also API source 6.

**Licence.** "License: Creative Commons Attribution 4.0" (dataset page). IDS covers low- and middle-income countries that report to the World Bank's Debtor Reporting System: 50 of the 54. Libya, Namibia, Seychelles and South Sudan are not covered and show "not covered", never zero debt.

**Access.** `https://api.worldbank.org/v2/sources/6/series/{code}/country/{iso3;…}/counterpart-area/{WLD|all}/time/{YR2024;…}?format=json`, no key. Years are a semicolon list (the API answers a `YR…:YR…` range here with a redirect to an error). Totals use the counterpart `WLD`. Creditors come from the same series with every counterpart: a creditor's kind is the series it appears in (`DT.DOD.MLAT.CD` multilateral, `DT.DOD.BLAT.CD` bilateral, `DT.DOD.PCBK.CD` commercial banks, `DT.DOD.PROP.CD` other private; for banks and other private lenders the counterpart is the lenders' country), and bondholders (`DT.DOD.PBND.CD`) are one creditor. The counterpart codes do not separate countries from institutions by themselves (Australia is 801, beside UN agencies), so the series decides. The last ten years are kept (2015–2024 in the December 2025 update).

## 7. UNDP Human Development Report

**Provides.** The Human Development Index and its components, 1990 on: `HDR25_Composite_indices_complete_time_series.csv` from <https://hdr.undp.org/data-center/documentation-and-downloads>.

**Licence.** "All materials provided on this website are copyrighted under the Creative Commons Attribution 3.0 IGO license." Credit, a licence link and a note of changes are required.

**Access.** On 22 October 2026 `hdr.undp.org` reset or timed out every connection, both from this project's network and from an independent fetcher. The pipeline therefore tries UNDP's file first and, if UNDP does not answer, reads Our World in Data's republication of the same series (<https://ourworldindata.org/grapher/human-development-index>, column `hdi__sex_total`, cited by OWID as "UNDP, Human Development Report (2025) – with minor processing by Our World in Data", 1990–2023). The values are UNDP's, under UNDP's CC BY 3.0 IGO licence; the site credits UNDP and names the copy used. Our World in Data's own terms for republished third-party data could not be read on 22 October 2026 (its pages also reset the connection) and are to be confirmed before this copy is relied on.

## 8. SIPRI military expenditure

**Provides.** Military spending in current US$ (`MS.MIL.XPND.CD`) and as % of GDP (`MS.MIL.XPND.GD.ZS`), read through the WDI API.

**Years kept.** Only the latest ten years with data are stored (2016–2025 in the October 2026 WDI update); earlier years are dropped by the pipeline.

**Licence.** WDI's metadata gives these two series **"SIPRI terms and conditions"**, not CC BY: going through the World Bank does not change the terms. SIPRI defines fair use as excerpts "for non-commercial purposes; and the reproduction of less than 10 per cent of a published data set. NB: Both the above conditions must apply". Commercial use "must be authorized". SIPRI's data set covers about 170 countries from 1949; 54 states over a 10-year window is about 540 country-years, roughly 4% of it per series. See [Decisions](#decisions).

## 9. Wikidata

**Provides.** Heads of state (`P35`) and government (`P6`) on each country item, with the offices (`P1906`, `P1313`), start dates and titles; election items with a date (`P585`) where one is recorded.

**Licence.** "All structured data … is released into the public domain under Creative Commons Zero."

**Coverage.** Leaders: all 54. Elections: sparse. For example, *2027 Kenyan general election* (Q138325200) exists but has no date. Leader changes are flagged in the review report before they reach the site, since anyone can edit Wikidata.

## 10. Elections: official sources, IFES, EISA

- **Official sources** (electoral commissions, constitutions, official gazettes) and **Wikipedia** articles for scheduled elections: each country's next national election is curated with its source and the exact quote, which every run re-checks against the source's text, as for Dhahabu's notes. A date is a fact; only the short quote is reproduced.
- **IFES ElectionGuide** (<https://www.electionguide.org/p/use/>): "ElectionGuide data may be used freely for personal and non-commercial purposes", with attribution; the API and downloads need a registered token. Whether "personal" covers a public website is unclear, so it is not used unless IFES confirms in writing.
- **EISA** (<https://www.eisa.org/terms-conditions>): users must not "Republish material from this website (including republication on another website)" or "conduct any systematic or automated data collection activities". Not used; it may be linked as further reading.

## 11. Yahoo Finance

Not used. Yahoo publishes no documented Yahoo Finance API; libraries call undocumented endpoints. Yahoo's terms prohibit any user to "access or collect data, or attempt to access or collect data, from our Services using any automated means … without our express, prior permission" and to use its data "to create any database, archive, mobile application, data feed, widget". Daily rates come from the ECB where official parities allow, and monthly rates from the IMF for every country ([Decisions](#decisions)).

## Decisions

Decided by the owner on 22 October 2026:
- **Regions:** the whole site uses the UN M49 regions (all 54 states have one). Each country's region is stated with a citation to M49; the M49 table itself is not republished. The display names are M49's, except **Central Africa (M49: Middle Africa)**.
- **FX:** official sources only: IMF monthly rates as the published series for all 54, and daily rates where an official, licensed daily source exists (the ECB-derived rates above). Yahoo Finance is not used.
- **Stale exchange rates** (Somalia, Guinea, Sudan, Sierra Leone, Mauritania): official central-bank series with open terms are sought; where none exists, the IMF series is shown to its last month, marked stale, and the country is left out of FX rankings for windows it does not cover.
- **Military spending:** included under SIPRI's fair use. The site is non-commercial; at most 54 states over 10 years are shown or exported (about 4% of the data set); SIPRI is referenced on every view and export. If the site ever becomes commercial, the series must be licensed or removed.
- **Elections:** curated from official sources with re-checked quotes. IFES ElectionGuide is not used unless IFES confirms in writing; EISA is not used.
- **Inflation:** ranked by the mean absolute rate (closest to price stability), as in [vinara-method.md](vinara-method.md).
- **GDP at PPP** is a ranked metric alongside GDP in US$.
