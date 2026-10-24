# Vinara method

How **Vinara** (Swahili: *leaders*) names a **cardinal** (the leading country) and a **silent contender** (the runner-up) for each metric, for each UN M49 region and for Africa as a whole, and how it describes whether the cardinal's lead is narrowing. Sources and licences are in [vinara-sources.md](vinara-sources.md).

Every rule here is computed in the database, not in the browser, and the definitions the site shows are the text of this document (a test keeps them identical, as for [harim-stats.md](harim-stats.md) and [dhahabu-stats.md](dhahabu-stats.md)). Vinara describes the record; it does not forecast and is not investment advice.

## Scope

- **Countries:** the 54 states. Territories (Western Sahara, Réunion, Mayotte, Saint Helena and others) are left out.
- **Regions:** the five UN M49 regions: Northern Africa (6 states), Western Africa (16), Central Africa (M49: Middle Africa, 9), Eastern Africa (18) and Southern Africa (5).
- **Africa:** the five regions together, compared region against region as well as country against country.

## Time

- **Window.** By default, the **last 10 complete years**. A year is complete for a metric when at least 90% of the states in scope have a figure for it. With the data read on 22 October 2026, GDP and growth are complete for 2025, so the default GDP window is 2016–2025. The ribbon's year range replaces the default.
- **Recency.** Each figure is the most recent available in the window and is shown with its own year (or month, for exchange rates). Reported figures are preferred. Where the World Bank has no figure for the year before the latest WEO edition, the IMF's figure for that year fills it (GDP, GDP at PPP, GDP per capita, real growth and inflation), labelled **IMF estimate**. Government debt is the IMF's series, and its figure for that year is labelled **IMF estimate** too. Projections are never shown.
- **No data is never zero.** A country without a figure for the window takes no part in that metric's ranking, and says so.
- **Enough years.** A mean over the window (growth, inflation) needs a figure in at least 80% of the window's years. Currency performance needs a rate in the window's first and last months; currency stability needs rates in at least 90% of its months.
- **One window for currencies.** Currency performance and stability share one window. By default it ends at the latest full calendar year of rates (January to December) that any state has, so the rankings use the latest rates; a state without rates for the window's last month takes no part and says so.

## Metrics and their direction

| Metric | Measure ranked | Cardinal |
|---|---|---|
| Population | Latest population | Largest |
| Land area | Land area (km², excluding inland water) | Largest |
| GDP | Latest GDP, current US$ | Largest |
| GDP at purchasing power parity | Latest GDP, PPP (current international $) | Largest |
| GDP per capita | Latest GDP per capita, PPP (international $) | Largest |
| Real GDP growth | Mean annual real growth over the window | Highest |
| Inflation | Mean of the absolute annual inflation rate over the window (closest to price stability) | Lowest |
| Government debt | Latest general government gross debt, % of GDP | Lowest |
| GNI | Latest GNI, current US$ | Largest |
| Currency performance | % change of the currency against the US dollar over the window | Smallest depreciation (or largest appreciation) |
| Currency stability | Volatility of monthly % changes against the US dollar over the window (annualised standard deviation of log returns) | Lowest |
| Military spending | Latest military expenditure, current US$ (shown with % of GDP) | Largest |
| Human development | Latest Human Development Index | Highest |

Population growth, the election calendar and external debt by creditor are shown as context and are not ranked.

**Inflation.** The absolute value counts deflation and inflation alike as departures from stable prices, so a year at −5% does not rank better than a year at +2%. Years of deflation are flagged.

**Currencies are never compared by their exchange-rate level.** 23 dobras and 600 CFA francs to the dollar say nothing about strength: the two units differ in size, and both are pegged to the euro. Performance (% change) and stability (volatility of % changes) are free of units, so currencies of any size compare fairly.

## Exchange rates

- **Unit:** local currency per US dollar, from 1 January 2020 (the floor for exchange rates) to the day before the data's last refresh. Daily figures are official: the ECB's reference rates or rates derived from them at an official parity, the BIS's, or the state's own central bank's ([sources](vinara-sources.md#12-daily-rates-bis-and-central-banks)). States without a usable daily source show the IMF's monthly period averages, labelled monthly.
- **Redenominations** are put on one unit before any calculation, from a table of currency changes, each with its date and official conversion: for example Mauritania's ouguiya (10 old = 1 new, 2018), São Tomé and Príncipe's dobra (1,000 old = 1 new, 2018) and Zimbabwe Gold (2,498.7242 Zimbabwe dollars = 1 ZiG, April 2024). Every series is on today's unit. A redenomination is never read as a gain or a loss in value; a currency's fall before a change (the Zimbabwe dollar in early 2024) is real and counts.
- **Stale series:** a series more than 12 months behind the newest month is marked stale and shown to its last month. A currency takes part in a window's ranking only if its series covers the window (see **Enough years** above).
- **Pegs** are recorded with their dates (CFA francs, the Comorian franc, the Cabo Verdean escudo and the dobra to the euro; the loti, lilangeni and Namibian dollar to the rand; the Djiboutian franc to the dollar). Countries in one currency union share one currency's figures, and a regional figure counts each currency once.
- **One basis for ranking:** currency performance and stability are ranked on monthly averages for every state (the mean of its daily rates where it has daily data, otherwise the IMF's monthly average), so all 54 compare alike. Daily rates are shown in the charts, and a state's recent daily volatility (the last 12 months) is shown beside it but not ranked.

## Definitions

The text the site shows for each metric, word for word (the API's `definition`; keys are the API's).

- **Population** (`population`): The latest population in the window (World Bank). The largest leads.
- **Land area** (`land_area`): Land area in square kilometres, excluding inland water: the latest figure in the window (World Bank). The largest leads.
- **GDP** (`gdp_usd`): GDP in current US dollars: the latest figure in the window (World Bank; an IMF estimate where the World Bank has none for the latest year). The largest leads.
- **GDP at purchasing power parity** (`gdp_ppp`): GDP at purchasing power parity, in current international dollars: the latest figure in the window (World Bank; an IMF estimate where the World Bank has none for the latest year). The largest leads.
- **GDP per capita (PPP)** (`gdp_per_capita_ppp`): GDP per person at purchasing power parity, in current international dollars: the latest figure in the window. The largest leads.
- **Real GDP growth** (`gdp_growth`): Real GDP growth: the mean of the annual rates over the window, for states with a figure in at least 80% of its years. The highest leads.
- **Inflation** (`inflation`): Inflation: the mean of the absolute annual rates over the window, so that deflation counts as a departure from stable prices too, for states with a figure in at least 80% of its years. The lowest leads.
- **Government debt** (`government_debt`): General government gross debt as a share of GDP: the latest figure in the window (IMF; its figure for the year before its latest edition is an estimate). The lowest leads.
- **GNI** (`gni_usd`): GNI in current US dollars: the latest figure in the window (World Bank). The largest leads.
- **Currency performance** (`currency_performance`): The change in the currency's value against the US dollar from the first month of the window to its last, on monthly averages (of official daily rates where a state has them, otherwise the IMF's). A rise means the currency gained. The largest gain, or the smallest loss, leads.
- **Currency stability** (`currency_stability`): The volatility of the currency against the US dollar: the standard deviation of its monthly changes over the window, annualised, for currencies with rates in at least 90% of the window's months. The lowest leads.
- **Military spending** (`military_usd`): Military expenditure in current US dollars: the latest figure in the window (SIPRI). The largest leads.
- **Human development** (`hdi`): The Human Development Index: the latest figure in the window (UNDP). The highest leads.

## Cardinal and silent contender

- **Cardinal:** the state ranked first by the metric's measure, among the states in scope that have a figure for the window.
- **Silent contender:** the state ranked second.
- **Ties** (equal to the published precision) are all named; they are never broken at random. Currencies fixed to the dollar, or to one another, can tie at zero: two states sharing a currency always tie on both currency metrics.
- **Region against region:** the same rule over the five regions' aggregates (below).

## The page's summary cards

The cards above the table count what the rankings already say; they add no rule of their own. Each card's "How is this calculated?" text is the following, word for word (a test keeps them identical). **Leading region** appears for Africa only.

- **Most cardinal titles:** The state named cardinal in the most measures, in Africa or in the region chosen, each measure over its own years. A tie for first names every state in it.
- **Leading region:** The UN M49 region that leads the most measures when the five regions are compared. A partial region is not ranked.
- **Gaps closing:** The measures on which the silent contender is closing in on the cardinal, by the gap-closing signal.
- **Contender ahead last year:** The measures on which the silent contender did better than the cardinal in the last year of the window, while the cardinal leads over the window as a whole.
- **Elections within 12 months:** The states whose next election that decides the executive falls within 12 months of today.

## Is the cardinal's lead narrowing?

The signal is descriptive: it reports what happened in the last three years of the window and never projects a crossover.

- **Gap closing** for level metrics (population, area, GDP, GDP at PPP, GDP per capita, GNI, military spending, HDI, debt): the gap between cardinal and contender narrowed in each of the last three annual steps.
- **Gap closing** for rate metrics (growth, inflation, currency performance and stability): the contender did better than the cardinal in at least two of the last three years.
- Otherwise **Lead holding**. Without a figure for both countries in each year the test needs (the window's last four years for levels, its last three for rates): **Not enough data**.
- When the cardinal or the contender is a tie, there is no signal: it compares two states.
- The contender may already lead in the latest year while the window still ranks the cardinal first: the page then says so in words.

## Regional figures

| Metric | Regional figure |
|---|---|
| Population, land area, GDP, GDP at PPP, GNI, military spending | Sum over member states |
| GDP per capita | Total GDP (PPP) over total population |
| Real growth, inflation | GDP-weighted mean (weights: GDP in current US$ in the previous year), shown with the median |
| Government debt | GDP-weighted mean (weights: GDP in current US$ in the year of each state's figure) |
| Currency performance and stability | Median over the region's currencies, each currency once |

Every regional figure is shown with the median over the region's states. For growth and inflation the mean is taken year by year over the members with a figure, then averaged over the window; inflation uses each member's absolute rate, as for countries.
| Human development | Population-weighted mean |

A regional figure is ranked only when the members with data account for at least 90% of the region's population (for sums, GDP per capita, population-weighted figures and currencies) or of its GDP (for GDP-weighted figures; for growth and inflation, in every year of the window). Otherwise it is shown, marked **partial** with the share covered, and not ranked.

## Leaders and elections

- **Leader:** the person holding executive power, with their title (President, King, Prime Minister, Transitional President…): the office the leaders list marks as constitutionally administering the executive. Where the head of state and the head of government are different people, both are shown, the executive one first (for example a ceremonial monarch and an elected prime minister).
  - Acting, interim and transitional office holders, and the leaders of military transitions, are labelled **transitional**.
  - A holder the list marks as exercising power without its constitutional basis is labelled **de facto**.
  - Where the list names a collective body as the executive (Sudan's Transitional Sovereignty Council), its chairman is shown, with a note.
- **Next national election:** the next election that decides the executive. That is the presidential election where the executive president is directly elected; otherwise (a prime minister holds executive power, or parliament elects the president) the legislative election. Where a king holds executive power (Morocco, Eswatini), the legislative election is shown, with a note that it does not choose the King. Eritrea holds no national elections.
- **Election status:**
  - **Election within 12 months:** the election's date is within 12 months of today;
  - **No election within 12 months:** a date is set and is further away;
  - **No date set:** no election is scheduled (for example under a transitional government without a set date).
  - When only the month or the year is known, the source gives it as the latest possible date, so it is taken as the last day of that month or year: "by July 2031". A listed date that has passed before the source names the next one counts as no date set.
- Status is computed from today's date each time it is shown.
- **Review:** leaders and elections change, and their sources can be edited by anyone, so the site shows the records the owner approved, and every change waits in the review report until it is approved.

## Ranking

A composite ranking of countries and regions is deferred until more indicators are in place, so that no single metric dominates it.
