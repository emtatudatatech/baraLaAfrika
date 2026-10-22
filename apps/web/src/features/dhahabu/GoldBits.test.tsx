import type { GoldCountry } from '@bla/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExportsFigure, HoldingsFigure, ProductionFigure, ShareFigure } from './GoldBits';

// Figures keep a no-break space before their unit, so accessible-name checks match it with \s.

/** A country with no figures at all; each test fills in the part it checks. */
function row(change: Partial<GoldCountry> = {}): GoldCountry {
  return {
    country: {
      iso3: 'XXX',
      iso2: 'xx',
      name: 'Testland',
      region: { slug: 'west', name: 'Western Africa', colorHex: null },
    } as GoldCountry['country'],
    presence: {
      tier: 'producer',
      basis: 'Reported production',
      confidence: 'high',
      asOfYear: 2024,
      source: null,
      commercialMining: true,
      asmPresent: null,
      asmSharePct: null,
      summary: '',
      needsReview: false,
      reviewNotes: null,
    },
    production: null,
    exports: { reported: null, mirror: null },
    imports: { reported: null, mirror: null },
    holdings: null,
    reporting: null,
    exportShare: null,
    ...change,
  };
}

const production = (tonnes: number | null, extra: Partial<GoldCountry['production']> = {}) =>
  row({
    production: {
      year: 2021,
      tonnes,
      basis: tonnes === null ? 'included_in_other' : 'reported',
      valueUsd: null,
      priceUsdPerOz: null,
      source: 'usgs',
      notes: null,
      ...extra,
    },
  });

describe('gold figures: no data, a reported zero and "included in other" look different', () => {
  it('no production figure is a dash, read as "No data"', () => {
    const { container } = render(<ProductionFigure row={row()} unit="t" />);
    expect(container).toHaveTextContent('—');
    expect(screen.getByText('No data')).toHaveClass('visually-hidden');
    expect(container).not.toHaveTextContent('0 t');
  });

  it('a reported zero is "0 t" with its year', () => {
    const { container } = render(<ProductionFigure row={production(0)} unit="t" />);
    expect(container).toHaveTextContent('0 t');
    expect(container).toHaveTextContent('2021');
    expect(screen.queryByText('No data')).toBeNull();
  });

  it('a country lumped into "other countries" says so, with no figure', () => {
    const { container } = render(<ProductionFigure row={production(null)} unit="t" />);
    expect(screen.getByRole('button', { name: 'incl. in other' })).toBeInTheDocument();
    expect(container).toHaveTextContent('2021');
    expect(container).not.toHaveTextContent('0 t');
    expect(container).not.toHaveTextContent('—');
  });

  it('an estimate is marked and the value says it is computed', () => {
    const { container } = render(
      <ProductionFigure
        row={production(10, { basis: 'estimate', valueUsd: 578_712_000, priceUsdPerOz: 1800 })}
        unit="oz"
      />,
    );
    expect(container).toHaveTextContent('321,507 oz');
    expect(screen.getByRole('button', { name: 'est.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^US\$579\sm computed$/ })).toBeInTheDocument();
  });
});

describe('trade, holdings and share', () => {
  it('without its own report, exports show the partners’ figure, labelled', () => {
    const mirror = { year: 2023, valueUsd: 2.5e9, netWeightKg: null, partnerCount: 4, notes: null };
    render(<ExportsFigure row={row({ exports: { reported: null, mirror } })} unit="t" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Partners: US\$2\.50\sbn \(2023\)$/ }),
    ).toBeInTheDocument();
  });

  it('reported exports without a weight say so', () => {
    const reported = {
      year: 2024,
      valueUsd: 9.1e8,
      netWeightKg: null,
      partnerCount: null,
      notes: null,
    };
    const { container } = render(
      <ExportsFigure row={row({ exports: { reported, mirror: null } })} unit="t" />,
    );
    expect(container).toHaveTextContent('US$910 m');
    expect(container).toHaveTextContent('weight not reported · 2024');
  });

  it('a pooled reserve shows its reporting status, not a zero', () => {
    const reporting = { status: 'pooled' as const, lastMonth: null, note: 'Held by the BCEAO.' };
    const { container } = render(<HoldingsFigure row={row({ reporting })} unit="t" />);
    expect(screen.getByRole('button', { name: 'Pooled (BCEAO)' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('0 t');
  });

  it('a reported zero holding is "0 t" with its month', () => {
    const holdings = {
      asOf: '2014-12-31',
      tonnes: 0,
      valueUsd: 0,
      pctOfReserves: 0,
      valuation: 'market' as const,
      change12mTonnes: null,
      change12mValueUsd: null,
    };
    const { container } = render(<HoldingsFigure row={row({ holdings })} unit="t" />);
    expect(container).toHaveTextContent('0 t');
    expect(container).toHaveTextContent('Dec 2014');
  });

  it('a share above 100% is flagged as inconsistent, never shown', () => {
    const exportShare = { year: 2020, pct: null, exceedsTotal: true, goldUsd: 2, totalUsd: 1 };
    const { container } = render(<ShareFigure row={row({ exportShare })} />);
    expect(screen.getByRole('button', { name: 'Inconsistent data' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('%');
  });
});
