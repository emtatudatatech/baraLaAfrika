import type { Election } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import {
  areaText,
  electionDateText,
  electionText,
  formatPopulation,
  populationText,
} from './factsFormat';

function election(partial: Partial<Election>): Election {
  return {
    decides: 'presidential',
    kind: 'general',
    date: '2027-08-10',
    precision: 'day',
    status: 'within_12_months',
    ...partial,
  };
}

describe('facts formatting', () => {
  it('writes populations in millions and billions, smaller ones in full', () => {
    expect(formatPopulation(56_432_944)).toBe('56.4 million');
    expect(formatPopulation(1_412_000_000)).toBe('1.41 billion');
    expect(formatPopulation(130_418)).toBe('130,418');
    expect(populationText({ value: 56_432_944, year: 2025, estimate: false })).toBe(
      '56.4 million (2025)',
    );
    expect(populationText(null)).toBe('No data');
  });

  it('writes land area in square kilometres', () => {
    expect(areaText({ value: 569_140, year: 2024, estimate: false })).toBe('569,140 km²');
  });

  it('gives a day, or a deadline for a month or year alone', () => {
    expect(electionDateText(election({}))).toBe('10 Aug 2027');
    expect(electionDateText(election({ date: '2031-07-31', precision: 'month' }))).toBe(
      'by Jul 2031',
    );
    expect(electionDateText(election({ date: '2031-12-31', precision: 'year' }))).toBe('by 2031');
    expect(electionDateText(election({ date: '2026-10-01', status: 'no_date_set' }))).toBeNull();
  });

  it('names the election, or says there is none or no date', () => {
    expect(electionText(election({}))).toBe('General election, 10 Aug 2027');
    expect(
      electionText(
        election({ kind: 'presidential', date: null, precision: null, status: 'no_date_set' }),
      ),
    ).toBe('Presidential election');
    expect(
      electionText(
        election({
          decides: 'none',
          kind: null,
          date: null,
          precision: null,
          status: 'no_date_set',
        }),
      ),
    ).toBe('No national elections');
  });
});
