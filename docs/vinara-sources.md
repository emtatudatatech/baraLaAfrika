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
| [IMF Exchange Rates (ER)](#4-imf-exchange-rates-er) | Monthly exchange rates for all 54 from 2020: the series shown where no daily source is usable, and the check on every daily series | SDMX 3.0 API, no key | IMF data terms | ✅ Monthly; stale for 9 countries, none since 2020 for Somalia |
| [ISO 4217 lists (SIX for ISO)](#4-imf-exchange-rates-er) | Checking each state's currency and currency changes | XML download | Used for checks only | ✅ |
| [ECB euro reference rates](#5-ecb-euro-foreign-exchange-reference-rates) | Daily rates for euro-pegged, rand-linked and dollar-pegged currencies | Data Portal API, no key | Free reuse, source quoted, not modified (*paraphrased*) | ✅ Daily series for 22 countries |
| [BIS daily rates](#12-daily-rates-bis-and-central-banks) | Daily rates for Algeria and Mauritius | SDMX API, no key | "Unrestricted", BIS cited | ✅ |
| [Central banks, through Frankfurter](#12-daily-rates-bis-and-central-banks) | Daily rates from each state's own central bank | frankfurter.dev API (MIT), no key | Each bank's own terms | ✅ 9 banks; 4 pending, 4 need permission |
| [Banca d'Italia](#12-daily-rates-bis-and-central-banks) | — | — | Written permission required | ⛔ Not used |
| [World Bank International Debt Statistics](#6-world-bank-international-debt-statistics-ids) | External debt by creditor ("major lenders") | Bulk CSV/XLSX, API | CC BY 4.0 | ✅ |
| [UNDP Human Development Report](#7-undp-human-development-report) | Human Development Index | CSV/XLSX; Our World in Data's copy when UNDP's site does not answer | CC BY 3.0 IGO | ✅ |
| [SIPRI Military Expenditure Database](#8-sipri-military-expenditure) | Military spending (US$ and % of GDP) | Via WDI (still SIPRI's terms) | Non-commercial fair use under 10% of the dataset | ⚠️ Fair use only (see the decision) |
| [Wikipedia: List of current heads of state and government](#9-leaders-wikipedia-and-wikidata) | Heads of state and government, and which office holds executive power | MediaWiki API (wikitext) | Facts; text CC BY-SA 4.0 | ✅ Leaders, approved before they are shown |
| [Wikidata](#9-leaders-wikipedia-and-wikidata) | Each leader's identifier; a second opinion on who holds office | SPARQL; Wikipedia page properties | CC0 | ✅ Cross-check |
| [Wikipedia: List of next general elections](#10-elections-wikipedia-ifes-eisa) | Last and next legislative and presidential elections | MediaWiki API (wikitext) | Facts; text CC BY-SA 4.0 | ✅ Elections, approved before they are shown |
| [IFES ElectionGuide](#10-elections-wikipedia-ifes-eisa) | — | Registered API | "personal and non-commercial purposes" | ⏸ Not used without written confirmation |
| [EISA election calendar](#10-elections-wikipedia-ifes-eisa) | — | Web page | Republishing and automated collection prohibited | ⛔ Not used (link only) |
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

**Coverage** (read 22 October 2026, from January 2020, the floor for exchange rates): every state has a series; the newest month is September 2026. Series reach their last month at different times:
- 37 are current (at most 3 months behind the newest month);
- 7 are late (up to 12 months behind);
- 9 are stale (more than 12 months behind): Guinea (to May 2021), Sudan (February 2023), Mauritania (only June 2022 to August 2024), Malawi (September 2024), Sierra Leone (April 2025), Tanzania (April 2025), South Sudan (May 2025), Liberia and Mozambique (August 2025);
- Somalia has none since 2020 (its series ends in June 2018).

Malawi, Tanzania and Liberia have current daily rates from their own central banks (section 12), which replace their stale IMF series. With those, 46 of 54 states have rates to December 2025, the end of the default window. The IMF's annual series are no more recent, nor is the World Bank's annual official rate (`PA.NUS.FCRF`), which is drawn from them.

**Units.** The IMF gives earlier months in today's unit for the currency changes it has applied (Ghana 2007, Zambia 2013, São Tomé 2018, Sierra Leone 2022 and others). Zimbabwe is the exception: its months before April 2024 are in Zimbabwe dollars, and before 2009 in currencies since abandoned. The pipeline detects which applies at each change (the step across it either matches the official conversion or does not move) and converts where needed (Zimbabwe: 2,498.7242 dollars per ZiG). Zimbabwe's series is used from February 2019.

**Pegs checked.** Each official parity is checked against the IMF's own rates over the last ten years (95% of months within 1%). Eritrea's nakfa is fixed by its central bank, but the IMF shows 15.075 and 15.375 per dollar in different periods, so no parity is recorded for it.

Zimbabwe's series carries an observation dated **2027-03**, after today: every load rejects months that have not ended.

**Central banks.** Searched on 22 October 2026 for official series to replace the stale ones; none offers a download with stated terms of reuse. The Bank of Sierra Leone publishes daily reference-rate PDFs (no reuse terms found), and the Banque Centrale de Mauritanie publishes a reference rate (no download found). Nothing current was found for Sudan, Guinea or Somalia.

**ISO 4217.** Each state's currency, and each changed currency's withdrawal date, is checked every run against the ISO 4217 lists published by SIX for ISO (<https://www.six-group.com/en/products-services/financial-information/data-standards.html>). The lists are used for checking only; nothing is republished from them.

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

That gives daily series for 22 of the 54 states, stored per currency (states sharing a currency share its rates) from January 2020. Every currency's monthly mean of daily rates is checked against the IMF's monthly average (within 1%); on 22 October 2026 all ten matched in every month (largest difference 0.29%).

**Licence (*paraphrased* from the ECB's reuse policy and disclaimer pages).** Public ECB statistics may be reused free of charge provided the source is quoted and the statistics are not modified; the reference rates are published for information purposes. The site shows the ECB's rates unchanged and labels the derived rates as derived from them at the official parity. Attribution: *"Source: ECB statistics."*

## 6. World Bank International Debt Statistics (IDS)

**Provides.** External debt stocks by creditor type (multilateral, bilateral, bondholders, commercial banks) and, for bilateral debt, by creditor country: the "major lenders" analysis. Dataset page <https://datacatalog.worldbank.org/search/dataset/0038015>, bulk CSV and XLSX; also API source 6.

**Licence.** "License: Creative Commons Attribution 4.0" (dataset page). IDS covers low- and middle-income countries that report to the World Bank's Debtor Reporting System: 50 of the 54. Libya, Namibia, Seychelles and South Sudan are not covered and show "not covered", never zero debt.

**Access.** `https://api.worldbank.org/v2/sources/6/series/{code}/country/{iso3;…}/counterpart-area/{WLD|all}/time/{YR2024;…}?format=json`, no key. Years are a semicolon list (the API answers a `YR…:YR…` range here with a redirect to an error). Totals use the counterpart `WLD`. Creditors come from the same series with every counterpart: a creditor's kind is the series it appears in (`DT.DOD.MLAT.CD` multilateral, `DT.DOD.BLAT.CD` bilateral, `DT.DOD.PCBK.CD` commercial banks, `DT.DOD.PROP.CD` other private; for banks and other private lenders the counterpart is the lenders' country), and bondholders (`DT.DOD.PBND.CD`) are one creditor. The counterpart codes do not separate countries from institutions by themselves (Australia is 801, beside UN agencies), so the series decides. The last ten years are kept (2015–2024 in the December 2025 update).

## 7. UNDP Human Development Report

**Provides.** The Human Development Index and its components, 1990 on: `HDR25_Composite_indices_complete_time_series.csv` from <https://hdr.undp.org/data-center/documentation-and-downloads>.

**Licence.** "All materials provided on this website are copyrighted under the Creative Commons Attribution 3.0 IGO license." Credit, a licence link and a note of changes are required.

**Access.** On 22 October 2026 `hdr.undp.org` reset or timed out every connection, both from this project's network and from an independent fetcher. The pipeline therefore tries UNDP's file first and, if UNDP does not answer, reads Our World in Data's republication of the same series (<https://ourworldindata.org/grapher/human-development-index>, column `hdi__sex_total`, cited by OWID as "UNDP, Human Development Report (2025) – with minor processing by Our World in Data", 1990–2023). The values are UNDP's, under UNDP's CC BY 3.0 IGO licence; the site credits UNDP and names the copy used. Our World in Data's own terms for republished third-party data could not be read on 22 October 2026 (its pages also reset the connection) and remain to be confirmed; the owner accepted the copy on that basis (see [Decisions](#decisions)).

## 8. SIPRI military expenditure

**Provides.** Military spending in current US$ (`MS.MIL.XPND.CD`) and as % of GDP (`MS.MIL.XPND.GD.ZS`), read through the WDI API.

**Years kept.** Only the latest ten years with data are stored (2016–2025 in the October 2026 WDI update); earlier years are dropped by the pipeline.

**Licence.** WDI's metadata gives these two series **"SIPRI terms and conditions"**, not CC BY: going through the World Bank does not change the terms. SIPRI defines fair use as excerpts "for non-commercial purposes; and the reproduction of less than 10 per cent of a published data set. NB: Both the above conditions must apply". Commercial use "must be authorized". SIPRI's data set covers about 170 countries from 1949; 54 states over a 10-year window is about 540 country-years, roughly 4% of it per series. See [Decisions](#decisions).

## 9. Leaders: Wikipedia and Wikidata

**Provides.** Wikipedia's *List of current heads of state and government* (<https://en.wikipedia.org/wiki/List_of_current_heads_of_state_and_government>) gives each state's head of state and head of government with their titles. It colours the office that "constitutionally administer[s] the executive" green, and an office holding *de facto* executive power without a constitutional basis blue. It also marks acting, interim and transitional holders, and links each person's article. The page is protected against disruptive editing and was current to 21 October 2026 when read.

**Wikidata.** Each person's Wikidata item is read from their article's page properties, and Wikidata's current head-of-state (`P35`) and head-of-government (`P6`) statements are compared with the list. On 22 October 2026 Wikidata alone was not reliable enough to lead: it kept former office holders without end dates (Ghana's former president as head of government, two presidents for Malawi), listed prime ministers that Benin and Zambia do not have, and lacked Guinea-Bissau's head of state and several new prime ministers. It is used as a cross-check, and its differences are listed in the review report.

**Access.** `https://en.wikipedia.org/w/api.php?action=parse&page=…&prop=wikitext|revid`, no key; the revision read is recorded.

**Licence.** Who holds an office is a fact. The site shows names, titles and dates, and its own short notes; no Wikipedia prose is republished. The notes rest on quotes from the list (for example Somalia's disputed presidency), which every run re-checks. Wikipedia's text is CC BY-SA 4.0 and Wikidata is CC0; both are credited.

**Review.** Anyone can edit either source, so the site shows the snapshot the owner approved. Each weekly run lists every difference from it in `data/politics_review_report.md`, and nothing changes on the site until the difference is approved.

## 10. Elections: Wikipedia, IFES, EISA

- **Wikipedia's *List of next general elections*** (<https://en.wikipedia.org/wiki/List_of_next_general_elections>) gives, per state, the last and next legislative and presidential elections, each linked to its article. In its words, "In cases where the exact date is unspecified, the latest possible date is listed". So a month or year alone is a deadline, and is stored as its last day with its precision. "Next" without a date means none is set. The same approval applies as for leaders. Wikidata's election items were too sparse to use: its *2027 Kenyan general election* (Q138325200) has no date.
- **Official sources** (electoral commissions, constitutions, gazettes) are cited where a curated note needs them; each note's quote is re-checked every run.
- **IFES ElectionGuide** (<https://www.electionguide.org/p/use/>): "ElectionGuide data may be used freely for personal and non-commercial purposes", with attribution; the API and downloads need a registered token. Whether "personal" covers a public website is unclear, so it is not used unless IFES confirms in writing.
- **EISA** (<https://www.eisa.org/terms-conditions>): users must not "Republish material from this website (including republication on another website)" or "conduct any systematic or automated data collection activities". Not used; it may be linked as further reading.

## 11. Yahoo Finance

Not used. Yahoo publishes no documented Yahoo Finance API; libraries call undocumented endpoints. Yahoo's terms prohibit any user to "access or collect data, or attempt to access or collect data, from our Services using any automated means … without our express, prior permission" and to use its data "to create any database, archive, mobile application, data feed, widget". Daily rates come from the ECB where official parities allow, and monthly rates from the IMF for every country ([Decisions](#decisions)).

## 12. Daily rates: BIS and central banks

Daily rates run from 1 January 2020 (the floor for exchange rates) to the day before each run. Only official sources usable without asking permission are used. Each state's daily series comes from one source:

- **The ECB** for the 22 pegged and rand-linked states (section 5).
- **The BIS** for Algeria and Mauritius: `WS_XRU`, daily, US dollar rates (<https://data.bis.org/topics/XRU>). Its terms: "The use of the statistics is unrestricted, provided that: (1) if the statistics are reproduced, the BIS must be cited in your publication or product as the source of the statistics". Days the BIS marks `NaN` are skipped.
- **The state's own central bank**, read through **Frankfurter** (<https://frankfurter.dev>, MIT-licensed open source). Frankfurter relays the official rates of over a hundred central banks. Its licence page says it "holds no ownership" of the rates and conveys no rights beyond each provider's; its blended rates are its own calculation, "not an official rate of any institution". The pipeline reads each bank's series as published (`/v2/rates?providers=…&base=USD`), never the blend, one calendar year per request. Past years are cached; each refresh re-reads the current year.

Central banks by the terms they publish (read 22 October 2026):

| Terms | Banks | Used |
|---|---|---|
| None published | Central Bank of Kenya, Bank of Tanzania, Bank of Zambia, Banco Nacional de Angola, Central Bank of The Gambia, Central Bank of Liberia, Reserve Bank of Malawi, Banque Centrale de Tunisie, Bank Al-Maghrib | ✅ Official rates published for public use, credited to each bank |
| Could not be read | Central Bank of Nigeria, Banque Centrale du Congo, Banque Nationale du Rwanda, Banky Foiben'i Madagasikara (pages timed out or are built in the browser) | ⏸ Added once their terms are confirmed |
| Permission required | Bank of Botswana ("for personal use or use within an individual organisation and for non-commercial use only"), Banco de Moçambique ("fins privados ou internos"; other uses need "prévia autorização por escrito"), Central Bank of Seychelles ("permission is sought"), Bank of Mauritius ("without the prior written consent") | ⛔ Not used (Mauritius comes from the BIS) |

The Central Bank of Egypt (from March 2024), the Banque de la République du Burundi (from September 2024) and the National Bank of Ethiopia (from October 2024) start after the floor, so those states keep the IMF's monthly rates. The other states have no official daily source usable without permission: Ghana, Uganda, Sudan, South Sudan, Libya, Guinea, Sierra Leone, Mauritania, Somalia, Eritrea and Zimbabwe. Rates that another country's central bank quotes for them (cross rates) are not used.

**Banca d'Italia** publishes daily rates for about 150 currencies, nearly every African one among them. Its copyright notice requires the Bank's "prior written permission" to reproduce its content elsewhere; only its open-data catalogue on dati.gov.it is CC BY 4.0, and its exchange rates are not in it. Not used.

**Checks.** Every daily series' monthly mean is compared with the IMF's monthly average: within 1% for pegged currencies and the rand, within 2% for the others, in at least 90% of months.

## Decisions

Decided by the owner on 22 October 2026:
- **Regions:** the whole site uses the UN M49 regions (all 54 states have one). Each country's region is stated with a citation to M49; the M49 table itself is not republished. The display names are M49's, except **Central Africa (M49: Middle Africa)**.
- **FX:** official sources only, from 1 January 2020 to the day before each run (the floor applies to exchange rates only). Daily rates from the ECB, the BIS and each state's own central bank where its terms allow reuse or it publishes none (read through Frankfurter, never its blend); the IMF's monthly rates for the other states and as the check on every daily series. Cross rates from other central banks are not used. Yahoo Finance is not used (decided again on 22 October 2026).
- **Stale exchange rates:** official central-bank series with open terms are sought (Malawi, Tanzania and Liberia now have them); where none exists, the IMF series is shown to its last month, marked stale, and the country is left out of FX rankings for windows it does not cover.
- **Military spending:** included under SIPRI's fair use. The site is non-commercial; at most 54 states over 10 years are shown or exported (about 4% of the data set); SIPRI is referenced on every view and export. If the site ever becomes commercial, the series must be licensed or removed.
- **Leaders and elections:** read from Wikipedia's *List of current heads of state and government* and *List of next general elections*, with Wikidata as a cross-check; notes and overrides rest on quotes re-checked every run. The site shows the approved snapshot; changes wait for approval. Dates are shown as the list gives them (Ghana's and Botswana's next dates read 7 January 2029 and 7 January 2030). IFES ElectionGuide is not used unless IFES confirms in writing; EISA is not used.
- **Inflation:** ranked by the mean absolute rate (closest to price stability), as in [vinara-method.md](vinara-method.md).
- **GDP at PPP** is a ranked metric alongside GDP in US$.
- **Human Development Index:** when UNDP's site does not answer, Our World in Data's copy of the same UNDP series is used, credited to UNDP with the copy named; every refresh tries UNDP's own file first.
