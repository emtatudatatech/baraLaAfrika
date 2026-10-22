# Harim statistics

The cards at the top of `/harim` (spec 7.5.1). Every value is computed in the database by `v_harim_stats(scope_region)` (migration `db/migrations/0004_harim_views.sql`, revised by `0005_harim_stats_band.sql`) and served by `GET /api/mountains/stats?region=<slug>`; nothing is computed in the browser. The **Definition** below is the exact text the API returns and the page shows in each card's "How is this calculated?" popover (a test checks they match).

## Shared rules

- **Counting rule.** A *mountain* is a `standalone` or `massif` row of the catalogue that is not a territory peak. A massif counts once; its summits are parts of it and are never counted separately. A peak on a border counts once in Africa-wide and regional figures, and for each of its countries in per-country figures.
- **Scope.** With no region, figures cover the 54 countries ("All Africa"). With a region, they cover mountains with at least one country in that region (so a border peak shared with a neighbouring region counts in both regions' figures), and countries in that region. Territory peaks are never in a scope's figures.
- **Ties** are always returned as a list (`entities`), never resolved at random; lists are ordered by name only for display.
- **Thresholds.** "3,000 m or higher" means `elevation_m >= 3000`. The height bands are strict above their lower bound: above 5,000 m; above 4,000 m up to 5,000 m; above 3,000 m up to 4,000 m; 3,000 m or lower.
- **Empty scopes.** A statistic with nothing to measure returns `value: null` and no entities (shown as an empty state, not an error); counts return 0.
- **The catalogue is curated** (every national high point, every peak of 3,000 m or more, and up to eight notable further peaks per country). Counts describe the catalogue, not every mountain in Africa.

## Statistics

### 1. Mountains catalogued (`mountains_catalogued`)

**Definition.** The number of mountains in this curated catalogue: every national high point, every peak of 3,000 m or more, and notable further peaks. It is not a count of all of Africa's mountains. A massif counts once (its summits are parts of it), a peak on a border counts once, and peaks in territories outside the 54 countries are not included.

**Value and details.** `detail.countries`: countries with at least one catalogued mountain in scope. `detail.territoryPeaks`: peaks in territories outside the 54 (continental scope only; 0 when a region is selected).

**Ties.** Not applicable (a count).

### 2. Volcanic mountains (`volcanic_mountains`)

**Definition.** Catalogued mountains that are volcanoes by type (stratovolcano, shield volcano or other volcano: from Wikidata, because the Smithsonian Global Volcanism Program lists them, or from a curated, quoted source) or have a stated volcanic status. Status (active, dormant, extinct) is shown only where a source states it; the rest are counted as unknown.

**Value and details.** `detail`: counts by status (`active`, `dormant`, `extinct`, `unknown`).

**Ties.** Not applicable (a count).

### 3. Tallest mountain (`tallest_mountain`)

**Definition.** The catalogued mountain with the greatest elevation. For a massif, its highest summit is named too. Ties are all listed.

**Value and details.** `entities`: each mountain at the maximum elevation, with `summitName` (a massif's highest summit), its countries, `confidence`, `needsReview` and `alternatives` (its other sourced heights, `[{ elevationM, source }]`).

**Ties.** Every mountain at the maximum is listed, ordered by name for display.

### 4. Lowest national high point (`lowest_national_high_point`)

**Definition.** Africa's lowest "highest point": the lowest of the countries' highest points. It is not "the shortest mountain": the catalogue leaves out small hills, and some national high points are hills or flat ground rather than mountains. Ties are all listed.

**Value and details.** `entities`: each country whose high point is at the minimum, with the high point's slug, name and elevation, and its `confidence`, `needsReview` and `alternatives`.

**Ties.** Every country at the minimum is listed, ordered by name for display.

### 5. Peaks above 4,000 m (`peaks_above_4000`)

**Definition.** Catalogued mountains higher than 4,000 m. The bands are: above 5,000 m; above 4,000 m up to 5,000 m; above 3,000 m up to 4,000 m; and 3,000 m or lower.

**Value and details.** `detail`: counts per band (`above5000`, `from4000to5000`, `from3000to4000`, `upTo3000`), the map's height bands.

**Ties.** Not applicable (a count).

### 6. Most mountainous country (`most_mountainous_country`)

**Definition.** The country with the most catalogued mountains of 3,000 m or higher. The catalogue includes every such peak, so this does not depend on how many smaller peaks were chosen. A peak on a border counts for each country it lies in. Ties are all listed.

**Value and details.** `entities`: each country at the maximum, with its count.

**Ties.** Every country at the maximum is listed, ordered by name for display. A region with no mountain of 3,000 m or more returns no value and no entities.

### 7. Busiest range (`busiest_range`)

**Definition.** The range with the most catalogued mountains of 3,000 m or higher, with its tallest peak. Ties are all listed.

**Value and details.** `entities`: each range at the maximum, with its count and its tallest peak (ties for tallest broken by name, for display only).

**Ties.** Every range at the maximum is listed, ordered by name for display.

### 8. Lowest point in Africa (`lowest_point`)

For a region the label names it ("Lowest point in Eastern Africa").

**Definition.** The lowest of the countries' lowest points; negative values are below sea level. Ties are all listed.

**Value and details.** `entities`: each country whose low point is at the minimum, with the point's name, elevation, kind and `needsReview`.

**Ties.** Every country at the minimum is listed, ordered by name for display.

### 9. Greatest relief (`greatest_relief`)

**Definition.** The country with the largest difference between its highest and lowest points. Ties are all listed.

**Value and details.** `entities`: each country at the maximum, with its highest and lowest points.

**Ties.** Every country at the maximum is listed, ordered by name for display.

### 10. Most prominent peak (`most_prominent_peak`)

**Definition.** The catalogued mountain with the greatest topographic prominence. Shown only when prominence is known for at least 80% of the catalogued mountains of 3,000 m or higher. Ties are all listed.

**Value and details.** `detail.available` (true when shown) and `detail.coverage` (the share of mountains of 3,000 m or more with a known prominence).

**Ties.** Every mountain at the maximum is listed, ordered by name for display.

## Response shape

`GET /api/mountains/stats?region=<slug>` returns `{ stats: [{ key, label, value, unit, detail, entities, definition, scope, asOf }] }`, one row per statistic in the order above. `scope` is `null` (All Africa) or the region's slug; `asOf` is the newest "as of" date of the mountain datasets. Entities carry a `kind` (`mountain`, `country` or `range`) and its key (`slug` or `iso3`), so each card can link to the peak, country or range.

## How the page shows them

- The band shows the scope ("All Africa" or the region, in its colour) on every view, so a regional figure is never read as continental.
- A height card shows a "sources disagree" marker when its mountain's confidence is low or another sourced height differs by more than 10 m (the review threshold); the marker lists the other heights. A low point marked for review shows a "needs verification" marker.
- `most_prominent_peak` is hidden while `detail.available` is false. With the current catalogue prominence is known for about a third of the mountains of 3,000 m or more, so the card is not shown.
