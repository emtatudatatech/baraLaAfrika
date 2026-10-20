import type { GoldCountry, GoldUnit, RegionSlug } from '@bla/shared';
import { type Ref, useId } from 'react';

import { DevApiHint } from '../../../components/DevApiHint/DevApiHint';
import { Icon } from '../../../components/Icon/Icon';
import { api } from '../../../lib/api';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { useResource } from '../../../lib/useResource';
import { DependenceChart } from './DependenceChart';
import styles from './GoldCharts.module.css';
import { HoldingsChart } from './HoldingsChart';
import { ProductionPriceChart } from './ProductionPriceChart';
import { TopProducersChart } from './TopProducersChart';

const text = strings.dhahabu.charts;

/**
 * The Dhahabu charts (spec 7.6 item 5), all following the ribbon's year range and the region
 * filter: production and price, top producers, gold dependence, and central bank holdings.
 */
export function GoldCharts({
  rows,
  region,
  regionName,
  from,
  to,
  unit,
  onOpen,
  holdingsRef,
}: {
  /** The countries in the region (all 54 without one) at the reference year. */
  rows: readonly GoldCountry[];
  region: RegionSlug | null;
  regionName: string | null;
  from: number;
  to: number;
  unit: GoldUnit;
  onOpen: (iso3: string) => void;
  holdingsRef: Ref<HTMLElement>;
}) {
  const titleId = useId();
  const production = useResource(
    `gold-series:production:${region ?? 'all'}:${String(from)}:${String(to)}`,
    () => api.goldSeries({ metric: 'production', region, from, to }),
  );
  const price = useResource(`gold-price:year:${String(from)}:${String(to)}`, () =>
    api.goldPrice({ from, to, granularity: 'year' }),
  );

  const failed =
    production.status === 'error' ? production : price.status === 'error' ? price : null;

  return (
    <section className={styles.charts} aria-labelledby={titleId} data-testid="gold-charts">
      <h2 id={titleId} className={styles.heading}>
        <Icon name="analytics" size={24} />
        {text.title}
      </h2>

      {failed && (
        <div className={styles.error} role="alert">
          <p>{text.loadError}</p>
          <DevApiHint error={failed.error} />
          <button type="button" className={styles.retry} onClick={failed.retry}>
            {text.retry}
          </button>
        </div>
      )}
      {(production.status === 'loading' || price.status === 'loading') && !failed && (
        <div className={cx('skeleton', styles.skeleton)} aria-hidden="true" />
      )}
      {production.status === 'success' && price.status === 'success' && (
        <ProductionPriceChart
          totals={production.data.totals ?? []}
          price={price.data}
          from={from}
          to={to}
          unit={unit}
          scopeName={regionName}
        />
      )}

      <div className={styles.pair}>
        {production.status === 'success' && (
          <TopProducersChart
            data={production.data}
            unit={unit}
            scopeName={regionName}
            onOpen={onOpen}
          />
        )}
        <DependenceChart rows={rows} scopeName={regionName} onOpen={onOpen} />
      </div>

      <HoldingsChart
        rows={rows}
        from={from}
        to={to}
        unit={unit}
        scopeName={regionName}
        focusRef={holdingsRef}
      />
    </section>
  );
}
