# Dhahabu statistics

The cards at the top of `/dhahabu` (spec 7.6.1). Every value is computed in the database by `v_gold_stats(scope_region, as_of_year)` (migration `db/migrations/0008_dhahabu_api.sql`) and served by `GET /api/gold/stats?region=<slug>&year=<yyyy>`; nothing is computed in the browser. The **Definition** below is the exact text the API returns and the page shows in each card's "How is this calculated?" popover (a test checks they match).

## Shared rules

- **Reference year.** The end of the ribbon's year range. Each card uses the latest data in or before that year and says which year or month it shows (`asOf`, and `detail.year` where useful). Without a year (`year` omitted, the default) each card uses the latest data available. Data is never extrapolated beyond its coverage.
- **Scope.** With no region, the 54 countries ("All Africa"); with a region, its countries.
- **Units.** Tonnes are metric tonnes of fine gold (1 tonne = 32,150.7466 troy ounces, `troy_oz_per_tonne()`); money is nominal US dollars. The page converts tonnes to kilograms or troy ounces for display only.
- **Null, zero and "included in other".** No data is `null` (shown "—"), never 0; a reported zero is 0; production a source lumps into "other countries" has no tonnes and is never added in.
- **Computed values** (production at the year's average price, holdings at the month's price) are labelled computed, with the price shown.
- **Ties** are returned as a list (`entities`), never resolved at random; lists are ordered by name for display.
- **Empty scopes.** A card with nothing to measure returns `value: null` and no entities (an empty state, not an error).
- **Two meanings of reserves.** These cards are about central bank holdings; in-ground (geological) reserves are a different thing and appear only in a country's drawer, labelled separately.

## Statistics

### 1. Gold-producing countries (`gold_producing_countries`)

**Definition.** Countries whose presence tier is "major producer" (latest production figure of 20 t or more) or "producer" (above 0 t), out of the countries in scope. Tiers rest on the latest evidence in the sources consulted (USGS figures, notes and cited overrides), not on the reference year; "none identified" means none in the sources consulted, never "no gold".

**Value and details.** `detail`: counts by tier (`majorProducer`, `producer`, `occurrencesKnown`, `noneIdentified`, `unknown`) and `countries` (countries in scope). The page draws them as a segmented bar with a legend.

**Dated.** Not dated: tiers rest on the latest evidence (each tier's own year is in the country table).

**Ties.** Not applicable (a count).

### 2. Africa's gold mine production (`africa_production`)

**Definition.** The sum of each country's mine production figure (USGS; one figure per country-year, a reported figure over an estimate, then the newest edition) in the latest complete year up to the reference year. A year is complete when producers without a figure that year (estimated from their nearest figure within three years) would add at most 5%; newer years cover only the countries the USGS lists by name. The share of world output uses the USGS world total for the same year.

**Value and details.** `detail.year`: the year shown. `countries`: countries with a figure that year. `missingCountries`: producers without one (estimated). `worldTonnes` and `worldSharePct`: the USGS world total and the share (null before 2020, the earliest world total read). `previousYear`, `changeTonnes`, `changePct`: the change from the year before, only when that year is complete too. `newestYear`: the newest year with any figure, so the page can say why it shows an older one.

**Dated.** 31 December of the year shown.

**Ties.** Not applicable (a sum).

### 3. Value of that production (`production_value`)

**Definition.** Computed, not reported: that year's production × 32,150.7466 troy ounces per tonne × the year's average of the World Bank's monthly gold prices (nominal US dollars). It is what the gold was worth at the average price, not a sales or export figure.

**Value and details.** `detail.year` and `detail.priceUsdPerOz`: the year and its average price (shown in the card's detail line); `computed` is always true.

**Dated.** 31 December of the year shown.

**Ties.** Not applicable.

### 4. Largest producer (`largest_producer`)

**Definition.** The country with the most mine production in the same year as the production card, and its share of the total. Ties are all shown.

**Value and details.** `detail.year`, `detail.sharePct`. `entities`: each country at the maximum, with `tonnes` and `estimate` (whether the figure is the source's estimate).

**Dated.** 31 December of the year shown.

**Ties.** Every country at the maximum is listed, ordered by name for display.

### 5. Central bank gold held (`central_bank_gold`)

**Definition.** The sum of the gold held by central banks (IMF International Liquidity), using each country's latest month up to the reference year and counting only countries whose latest report is within 12 months of the newest one. Late, irregular and pooled reporters (the eight BCEAO members hold gold jointly) are left out and counted. The US dollar value is the total tonnes at the newest month's average price (computed).

**Value and details.** `detail.valueUsd` (computed), `detail.priceUsdPerOz` (the newest month's average), `detail.reporting` (countries counted) and `detail.notCurrent` (countries in scope left out: late, stale, pooled or without a series).

**Dated.** The newest month end among the countries counted.

**Ties.** Not applicable (a sum).

### 6. Largest holder (`largest_holder`)

**Definition.** The central bank with the most gold among the countries counted in "Central bank gold held", with its US dollar value (at that month's average price) and gold's share of its total reserves (from the IMF's own values). Ties are all shown.

**Value and details.** `entities`: each country at the maximum, with `tonnes`, `valueUsd`, `pctOfReserves` and its own `asOf` month.

**Dated.** The holder's month end.

**Ties.** Every country at the maximum is listed.

### 7. Gold price (`gold_price`)

**Definition.** The World Bank's monthly average gold price for the latest month up to the reference year, in nominal US dollars per troy ounce, and its change from the same month a year earlier. A monthly average, not a live price.

**Value and details.** `detail.month`, `detail.yearAgoUsdPerOz`, `detail.changePct`.

**Dated.** The month's last day.

**Ties.** Not applicable.

### 8. Most gold-dependent exporter (`most_gold_dependent`)

**Definition.** The country whose reported gold exports (HS 7108, non-monetary gold) are the largest share of its reported merchandise exports, both parts from UN Comtrade for the same year: each country's latest year with both, up to the reference year and within three years of the newest such year. Ties are all shown.

**Value and details.** `entities`: each country at the maximum share (to 0.1%), with `pct`, its `year`, `goldUsd` and `totalUsd`. A country whose reported gold exports exceed its reported total (inconsistent data) is left out.

**Dated.** 31 December of the newest year among the entities.

**Ties.** Countries with the same share to 0.1% are all listed.

### 9. Biggest reporting gap (`biggest_reporting_gap`)

**Definition.** Where trading partners report importing the most gold from a country beyond what that country reports exporting (UN Comtrade, non-monetary gold): each country's latest year with both figures, up to the reference year and at most the year before the newest trade data (partners report late), within three years of the newest such year. Gaps can reflect timing, valuation, classification, transit or unrecorded flows; a gap is not evidence of wrongdoing.

**Value and details.** `entities`: each country at the maximum gap, with its `year`, `gapUsd`, `reportedUsd`, `mirrorUsd` and `partnerCount` (how many partners' reports the mirror sums). A country that reports no gold exports has no gap (no data is not zero).

**Dated.** 31 December of the gap's year.

**Ties.** Every country at the maximum is listed.

### 10. Largest net buyer (12 months) (`largest_net_buyer`)

**Definition.** The central bank whose gold holdings grew most, in tonnes, over the 12 months to its latest report (among the countries counted in "Central bank gold held"). "No net buyer" when no holding grew.

**Value and details.** `detail.noNetBuyer`; `entities`: each country at the maximum, with `changeTonnes` and its `asOf` month.

**Dated.** The buyer's month end.

**Ties.** Every country at the maximum is listed.

## Not shown

- **Price effect** (the optional 11th card): how much of the 12-month change in the US dollar value of central bank holdings came from the price rather than tonnes. It is part of the central bank holdings chart (milestone 16), where the country and period can be chosen.
