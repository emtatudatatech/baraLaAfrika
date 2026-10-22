# Vinara method

How **Vinara** (Swahili: *leaders*) names a **cardinal** (the leading country) and a **silent contender** (the runner-up) for each metric, for each UN M49 region and for Africa as a whole, and how it describes whether the cardinal's lead is narrowing. Sources and licences are in [vinara-sources.md](vinara-sources.md).

Every rule here is computed in the database, not in the browser, and the definitions the site shows are the text of this document (a test keeps them identical, as for [harim-stats.md](harim-stats.md) and [dhahabu-stats.md](dhahabu-stats.md)). Vinara describes the record; it does not forecast and is not investment advice.

## Scope

- **Countries:** the 54 states. Territories (Western Sahara, Réunion, Mayotte, Saint Helena and others) are left out.
- **Regions:** the five UN M49 regions: Northern Africa (6 states), Western Africa (16), Central Africa (M49: Middle Africa, 9), Eastern Africa (18) and Southern Africa (5).
- **Africa:** the five regions together, compared region against region as well as country against country.

## Time

- **Window.** By default, the **last 10 complete years**. A year is complete for a metric when at least 90% of the states in scope have a figure for it. With the data read on 22 October 2026, GDP and growth are complete for 2025, so the default GDP window is 2016–2025. The ribbon's year range replaces the default.
- **Recency.** Each figure is the most recent available in the window and is shown with its own year (or month, for exchange rates). Reported figures are preferred. Where the World Bank has no figure for the latest year, an IMF figure for the year before the WEO edition may fill it, labelled **IMF estimate**. Projections are never shown.
- **No data is never zero.** A country without a figure for the window takes no part in that metric's ranking, and says so.

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

- **Unit:** local currency per US dollar. Monthly figures are the IMF's period averages; daily figures are the ECB's reference rates or rates derived from them at an official parity ([sources](vinara-sources.md#5-ecb-euro-foreign-exchange-reference-rates)).
- **Redenominations** are put on one unit before any calculation, from a table of currency changes, each with its date, factor and source: for example Mauritania's ouguiya (10 old = 1 new, 2018), São Tomé and Príncipe's dobra (1,000 old = 1 new, 2018) and Zimbabwe's currency changes (2019, 2024). A redenomination is never read as a gain or a loss in value.
- **Pegs** are recorded with their dates (CFA francs, the Comorian franc, the Cabo Verdean escudo and the dobra to the euro; the loti, lilangeni and Namibian dollar to the rand; the Djiboutian franc to the dollar). Countries in one currency union share one currency's figures, and a regional figure counts each currency once.
- **Recent volatility** uses the last 12 months of daily data where available, and otherwise monthly data.

## Cardinal and silent contender

- **Cardinal:** the state ranked first by the metric's measure, among the states in scope that have a figure for the window.
- **Silent contender:** the state ranked second.
- **Ties** (equal to the published precision) are all named; they are never broken at random.
- **Region against region:** the same rule over the five regions' aggregates (below).

## Is the cardinal's lead narrowing?

The signal is descriptive: it reports what happened in the last three years of the window and never projects a crossover.

- **Gap closing** for level metrics (population, area, GDP, GDP at PPP, GDP per capita, GNI, military spending, HDI, debt): the gap between cardinal and contender narrowed in each of the last three annual steps.
- **Gap closing** for rate metrics (growth, inflation, currency performance and stability): the contender did better than the cardinal in at least two of the last three years.
- Otherwise **Lead holding**. With fewer than three years of data for either country: **Not enough data**.
- The contender may already lead in the latest year while the window still ranks the cardinal first: the page then says so in words.

## Regional figures

| Metric | Regional figure |
|---|---|
| Population, land area, GDP, GDP at PPP, GNI, military spending | Sum over member states |
| GDP per capita | Total GDP (PPP) over total population |
| Real growth, inflation | GDP-weighted mean (weights: GDP in current US$ in the previous year), shown with the median |
| Government debt | GDP-weighted mean |
| Currency performance and stability | Median over the region's currencies, each currency once |
| Human development | Population-weighted mean |

A regional figure is shown only when the members with data account for at least 90% of the region's population (for sums and population-weighted figures) or of its GDP (for GDP-weighted figures); otherwise it is marked **partial** with the share covered.

## Leaders and elections

- **Leader:** the person holding executive power, with their title (President, King, Prime Minister, Transitional President…). Where the head of state and the head of government are different people, both are shown, the executive one first (for example a ceremonial monarch and an elected prime minister).
- **Next national election:** the next election that decides the executive: presidential where the president is directly elected, otherwise the legislative election.
- **Election status:**
  - **Election within 12 months:** the election's date is within 12 months of today;
  - **No election within 12 months:** a date is set and is further away;
  - **No date set:** no election is scheduled (for example under a transitional government without a set date).
  - When only the year is known, the election is taken to fall on 31 December of that year, and the date reads "2027 (date not set)".
- Status is computed from today's date each time it is shown.

## Ranking

A composite ranking of countries and regions is deferred until more indicators are in place, so that no single metric dominates it.
