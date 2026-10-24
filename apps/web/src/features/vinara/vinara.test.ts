import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CountrySummary, VinaraEntity, VinaraMetric } from '@bla/shared';
import { describe, expect, it } from 'vitest';

import { strings } from '../../lib/strings';
import { formatMoney, formatShare, formatVinaraValue, formatWindow } from './vinaraFormat';
import { apiWindow } from './vinaraQuery';
import {
  contenderAhead,
  electionCalendar,
  electionsSoon,
  gapsClosing,
  leadingRegion,
  mostTitles,
} from './vinaraSummary';

const MINUS = '−';
const NBSP = ' ';

function entity(iso3: string, name: string, value = 1): VinaraEntity {
  return { iso3, name, region: 'west', value, year: 2025, estimate: false };
}

function metric(overrides: Partial<VinaraMetric>): VinaraMetric {
  return {
    key: 'population',
    name: 'Population',
    unit: 'people',
    decimals: 0,
    direction: 'max',
    kind: 'level',
    definition: 'd',
    window: { from: 2016, to: 2025, isDefault: true },
    cardinals: [],
    contenders: [],
    signal: 'lead_holding',
    contenderLeadsLatest: false,
    ranked: 54,
    unranked: [],
    regions: null,
    ...overrides,
  };
}

describe('Vinara values', () => {
  const as = (key: VinaraMetric['key'], unit: string, decimals: number, value: number) =>
    formatVinaraValue({ key, unit, decimals }, value);

  it('reads each unit at the metric’s precision', () => {
    expect(as('population', 'people', 0, 237_527_782)).toBe('237.5 million');
    expect(as('land_area', 'km2', 0, 2_381_740)).toBe(`2,381,740${NBSP}km²`);
    expect(as('gdp_usd', 'current_usd', 0, 427_184_325_997)).toBe(`US$427${NBSP}bn`);
    expect(as('gdp_ppp', 'current_intl_usd', 0, 2_391_468_107_658)).toBe(`Int$2.39${NBSP}tn`);
    expect(as('gdp_per_capita_ppp', 'current_intl_usd', 0, 35_854)).toBe('Int$35,854');
    expect(as('gdp_growth', 'percent', 2, 7.52)).toBe(`7.52%${NBSP}a year`);
    expect(as('inflation', 'percent', 2, 1.36)).toBe(`1.36%${NBSP}a year`);
    expect(as('government_debt', 'percent_of_gdp', 2, 20.43)).toBe(`20.43%${NBSP}of GDP`);
    expect(as('currency_performance', 'percent', 2, 5.88)).toBe('+5.88%');
    expect(as('currency_performance', 'percent', 2, -16.67)).toBe(`${MINUS}16.67%`);
    expect(as('currency_stability', 'percent', 2, 0)).toBe('0.00%');
    expect(as('hdi', 'index', 3, 0.848)).toBe('0.848');
  });

  it('abbreviates money to three significant figures', () => {
    expect(formatMoney(18_263_967_968, 'US$')).toBe(`US$18.3${NBSP}bn`);
    expect(formatMoney(812_400_000, 'US$')).toBe(`US$812${NBSP}m`);
    expect(formatMoney(5_189_111, 'US$')).toBe(`US$5.19${NBSP}m`);
    expect(formatMoney(-2_000_000_000, 'US$')).toBe(`${MINUS}US$2.00${NBSP}bn`);
  });

  it('writes windows and shares', () => {
    expect(formatWindow({ from: 2016, to: 2025 })).toBe('2016–2025');
    expect(formatWindow({ from: 2024, to: 2024 })).toBe('2024');
    expect(formatShare(0.873)).toBe('87%');
  });
});

describe('the years asked for', () => {
  const range = { start: 2017, end: 2026 };
  it('asks for none by default, and for the end only when one was chosen', () => {
    expect(apiWindow(range, true, new URLSearchParams())).toEqual({});
    expect(apiWindow(null, false, new URLSearchParams())).toEqual({});
    expect(apiWindow({ start: 2000, end: 2026 }, false, new URLSearchParams('from=2000'))).toEqual({
      from: 2000,
    });
    expect(apiWindow({ start: 2017, end: 2020 }, false, new URLSearchParams('to=2020'))).toEqual({
      from: 2017,
      to: 2020,
    });
  });
});

describe('the summary cards', () => {
  const aaa = entity('AAA', 'Aland');
  const bbb = entity('BBB', 'Bland');
  const metrics = [
    metric({ key: 'population', name: 'Population', cardinals: [aaa], contenders: [bbb] }),
    metric({
      key: 'gdp_usd',
      name: 'GDP',
      cardinals: [bbb],
      contenders: [aaa],
      signal: 'gap_closing',
      regions: {
        cardinals: [{ slug: 'west', name: 'Western Africa', value: 1 }],
        contenders: [],
        values: [],
      },
    }),
    metric({
      key: 'inflation',
      name: 'Inflation',
      kind: 'rate',
      cardinals: [aaa],
      contenders: [bbb],
      contenderLeadsLatest: true,
      regions: {
        cardinals: [{ slug: 'west', name: 'Western Africa', value: 1 }],
        contenders: [],
        values: [],
      },
    }),
    metric({
      key: 'currency_stability',
      name: 'Currency stability',
      cardinals: [aaa, bbb],
      signal: null,
    }),
  ];

  it('names the state with the most cardinal titles, counting each state in a tie', () => {
    expect(mostTitles(metrics)).toEqual({
      count: 3,
      holders: [
        { key: 'AAA', name: 'Aland', measures: ['Population', 'Inflation', 'Currency stability'] },
      ],
    });
    expect(mostTitles([])).toBeNull();
  });

  it('names every region tied for the most measures led', () => {
    expect(leadingRegion(metrics)?.holders.map((h) => h.key)).toEqual(['west']);
    expect(leadingRegion(metrics)?.count).toBe(2);
  });

  it('lists the gaps closing and the contenders ahead last year', () => {
    expect(gapsClosing(metrics).map((m) => m.key)).toEqual(['gdp_usd']);
    expect(contenderAhead(metrics).map((m) => m.key)).toEqual(['inflation']);
  });

  it('orders the election calendar by date and sets aside states without one', () => {
    const country = (name: string, election: CountrySummary['facts']['election']) =>
      ({ iso3: name.slice(0, 3).toUpperCase(), name, facts: { election } }) as CountrySummary;
    const dated = (date: string, status: 'within_12_months' | 'beyond_12_months') => ({
      decides: 'presidential' as const,
      kind: 'presidential' as const,
      date,
      precision: 'day' as const,
      status,
    });
    const calendar = electionCalendar([
      country('Later', dated('2028-01-01', 'beyond_12_months')),
      country('Sooner', dated('2027-01-01', 'within_12_months')),
      country('Also', dated('2027-01-01', 'within_12_months')),
      country('Undated', {
        decides: 'presidential',
        kind: null,
        date: null,
        precision: null,
        status: 'no_date_set',
      }),
      country('Never', {
        decides: 'none',
        kind: null,
        date: null,
        precision: null,
        status: 'no_date_set',
      }),
      country('Unknown', null),
    ]);
    expect(calendar.dated.map((c) => c.name)).toEqual(['Also', 'Sooner', 'Later']);
    expect(calendar.noDate.map((c) => c.name)).toEqual(['Undated']);
    expect(calendar.noElections.map((c) => c.name)).toEqual(['Never']);
    expect(electionsSoon(calendar).map((c) => c.name)).toEqual(['Also', 'Sooner']);
  });

  it('are defined word for word in docs/vinara-method.md', () => {
    const docs = readFileSync(resolve(process.cwd(), 'docs/vinara-method.md'), 'utf8');
    const { definitions } = strings.vinara.stats;
    for (const [key, definition] of Object.entries(definitions)) {
      const label = strings.vinara.stats[key as keyof typeof definitions];
      expect(docs).toContain(`- **${label}:** ${definition}`);
    }
  });
});
