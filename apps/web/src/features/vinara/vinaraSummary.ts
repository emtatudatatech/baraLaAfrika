import type { CountrySummary, RegionSlug, VinaraMetric } from '@bla/shared';

/*
 * The page's summary cards and election strip, read from the API's results: counts of what the
 * database already decided (cardinals, regions, signals) and the countries' election facts.
 * Definitions: docs/vinara-method.md ("The page's summary cards").
 */

export interface Holder<K extends string> {
  key: K;
  name: string;
  /** The measures it leads, in display order. */
  measures: string[];
}

export interface MostTitles<K extends string> {
  count: number;
  holders: Holder<K>[];
}

function tally<K extends string>(
  metrics: readonly VinaraMetric[],
  leaders: (metric: VinaraMetric) => readonly { key: K; name: string }[],
): MostTitles<K> | null {
  const byKey = new Map<K, Holder<K>>();
  for (const metric of metrics) {
    for (const { key, name } of leaders(metric)) {
      const holder = byKey.get(key) ?? { key, name, measures: [] };
      holder.measures.push(metric.name);
      byKey.set(key, holder);
    }
  }
  const count = Math.max(0, ...[...byKey.values()].map((h) => h.measures.length));
  if (count === 0) return null;
  const holders = [...byKey.values()]
    .filter((h) => h.measures.length === count)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { count, holders };
}

/** The state(s) named cardinal in the most measures (every state in a tie for first). */
export function mostTitles(metrics: readonly VinaraMetric[]): MostTitles<string> | null {
  return tally(metrics, (m) => m.cardinals.map((c) => ({ key: c.iso3, name: c.name })));
}

/** The region(s) leading the most measures when the regions are compared (Africa only). */
export function leadingRegion(metrics: readonly VinaraMetric[]): MostTitles<RegionSlug> | null {
  return tally(metrics, (m) =>
    (m.regions?.cardinals ?? []).map((r) => ({ key: r.slug, name: r.name })),
  );
}

/** The measures whose gap-closing signal says the contender is closing in. */
export function gapsClosing(metrics: readonly VinaraMetric[]): VinaraMetric[] {
  return metrics.filter((m) => m.signal === 'gap_closing');
}

/** The measures on which the contender did better than the cardinal in the window's last year. */
export function contenderAhead(metrics: readonly VinaraMetric[]): VinaraMetric[] {
  return metrics.filter((m) => m.contenderLeadsLatest);
}

export interface ElectionCalendar {
  /** States with a date, soonest first. */
  dated: CountrySummary[];
  /** States whose election has no date set. */
  noDate: CountrySummary[];
  /** States that hold no national elections. */
  noElections: CountrySummary[];
}

/** The scope's next elections, soonest first (ties by name), and the states without a date. */
export function electionCalendar(countries: readonly CountrySummary[]): ElectionCalendar {
  const byName = (a: CountrySummary, b: CountrySummary) => a.name.localeCompare(b.name);
  const dated: CountrySummary[] = [];
  const noDate: CountrySummary[] = [];
  const noElections: CountrySummary[] = [];
  for (const country of countries) {
    const election = country.facts.election;
    if (election === null) continue;
    if (election.decides === 'none') noElections.push(country);
    else if (election.date === null || election.status === 'no_date_set') noDate.push(country);
    else dated.push(country);
  }
  dated.sort((a, b) => {
    const order = (a.facts.election?.date ?? '').localeCompare(b.facts.election?.date ?? '');
    return order === 0 ? byName(a, b) : order;
  });
  return { dated, noDate: noDate.sort(byName), noElections: noElections.sort(byName) };
}

/** The states whose next election falls within 12 months (soonest first). */
export function electionsSoon(calendar: ElectionCalendar): CountrySummary[] {
  return calendar.dated.filter((c) => c.facts.election?.status === 'within_12_months');
}
