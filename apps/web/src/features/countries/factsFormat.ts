import type { Election, YearValue } from '@bla/shared';

import { strings } from '../../lib/strings';

/*
 * Formatting for a country's facts (population, land area, next election), shared by the
 * countries table and cards and the map's tooltip and popover.
 */

const grouped = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 56,432,944 → "56.4 million"; 1,412,000,000 → "1.41 billion"; under a million in full. */
export function formatPopulation(value: number): string {
  if (value >= 1e9) return strings.facts.billion(twoDecimals.format(value / 1e9));
  if (value >= 1e6) return strings.facts.million(oneDecimal.format(value / 1e6));
  return grouped.format(value);
}

/** Population with its year: "56.4 million (2025)". */
export function populationText(population: YearValue | null): string {
  return population === null
    ? strings.facts.noData
    : strings.facts.population(formatPopulation(population.value), population.year);
}

/** "580,370 km²". */
export function areaText(area: YearValue | null): string {
  return area === null ? strings.facts.noData : strings.facts.area(grouped.format(area.value));
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The election's date as the source gives it: "10 Aug 2027", or a deadline for a month or year
 * alone ("by Jul 2031", "by 2031"). Null when no date is set.
 */
export function electionDateText(election: Election): string | null {
  if (election.date === null || election.status === 'no_date_set') return null;
  const date = new Date(`${election.date}T00:00:00Z`);
  switch (election.precision) {
    case 'month':
      return strings.facts.byDate(MONTH.format(date));
    case 'year':
      return strings.facts.byDate(String(date.getUTCFullYear()));
    default:
      return DAY.format(date);
  }
}

/**
 * "General election, 10 Aug 2027" or "Legislative election, by Jun 2031"; without a date, the
 * kind alone (the status chip beside it says "No date set").
 */
export function electionText(election: Election): string {
  if (election.decides === 'none') return strings.facts.noElections;
  const kind = election.kind === null ? null : strings.facts.electionKinds[election.kind];
  return [kind, electionDateText(election)].filter(Boolean).join(', ');
}
