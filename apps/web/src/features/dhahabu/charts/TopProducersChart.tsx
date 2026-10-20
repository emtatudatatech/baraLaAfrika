import { type GoldSeriesResponse, type GoldUnit, TROY_OZ_PER_TONNE } from '@bla/shared';
import { useId, useMemo } from 'react';

import { Icon } from '../../../components/Icon/Icon';
import { formatMass, formatPrice, formatUsd, massUnitLabel } from '../../../lib/goldUnits';
import { strings } from '../../../lib/strings';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { producersYear } from './chartData';
import styles from './GoldCharts.module.css';
import { type RankBar, RankBars } from './RankBars';

const text = strings.dhahabu.charts.producers;
const TOP = 10;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

/**
 * "Top gold producers" (spec 7.6 item 5): horizontal bars for the latest complete production
 * year in the ribbon's range, in region colours, with tonnes and the computed value on hover.
 */
export function TopProducersChart({
  data,
  unit,
  scopeName,
  onOpen,
}: {
  data: GoldSeriesResponse;
  unit: GoldUnit;
  scopeName: string | null;
  onOpen: (iso3: string) => void;
}) {
  const titleId = useId();
  const year = producersYear(data.totals);

  const producers = useMemo(() => {
    if (year === null) return [];
    return data.series
      .flatMap((series) => {
        const point = series.points.find((p) => p.period === String(year));
        return point?.value != null && point.value > 0
          ? [{ series, point, tonnes: point.value }]
          : [];
      })
      .sort(
        (a, b) => b.tonnes - a.tonnes || a.series.country.name.localeCompare(b.series.country.name),
      );
  }, [data, year]);

  const total = data.totals?.find((t) => t.year === year);
  const bars: RankBar[] = producers.slice(0, TOP).map(({ series, point, tonnes }) => ({
    iso3: series.country.iso3,
    name: series.country.name,
    region: series.country.region,
    value: tonnes,
    label: `${formatMass(tonnes, unit)}${point.basis === 'estimate' ? ' *' : ''}`,
    detail: (
      <>
        <span className={chartStyles.figure}>
          {formatMass(tonnes, unit)}
          {point.basis === 'estimate' && ` (${text.estimate})`}
        </span>
        {point.valueUsd !== null && total !== undefined && (
          <span>
            {text.valueComputed(
              formatUsd(point.valueUsd),
              formatPrice(point.valueUsd / (tonnes * TROY_OZ_PER_TONNE)),
            )}
          </span>
        )}
      </>
    ),
  }));

  // Tonnes in the viewer's unit for the axis.
  const toUnit = (tonnes: number) =>
    unit === 't' ? tonnes : unit === 'kg' ? tonnes * 1000 : tonnes * TROY_OZ_PER_TONNE;

  return (
    <section
      className={chartStyles.section}
      aria-labelledby={titleId}
      data-testid="gold-producers-chart"
    >
      <div className={chartStyles.head}>
        <h3 id={titleId} className={chartStyles.title}>
          <Icon name="bar_chart" size={24} />
          {text.title}
        </h3>
      </div>
      {year === null || bars.length === 0 ? (
        <p className={styles.empty}>{strings.dhahabu.charts.noData}</p>
      ) : (
        <>
          <p className={styles.subtitle}>
            {text.subtitle(year)}
            {scopeName !== null && ` · ${scopeName}`}
          </p>
          <RankBars
            bars={bars}
            testId="gold-producers"
            description={text.description(year, bars.length)}
            tickLabel={(tick, last) =>
              `${number.format(toUnit(tick))}${last ? `\u00a0${massUnitLabel(unit)}` : ''}`
            }
            onOpen={onOpen}
          />
          {bars.some((b) => b.label?.endsWith('*')) && (
            <p className={styles.footnote}>* {text.estimate}</p>
          )}
          <details className={chartStyles.tableView}>
            <summary>{strings.dhahabu.charts.tableToggle}</summary>
            <table className={chartStyles.table} data-testid="gold-producers-table">
              <caption className="visually-hidden">{text.subtitle(year)}</caption>
              <thead>
                <tr>
                  <th scope="col">{text.columns.country}</th>
                  <th scope="col" className={chartStyles.number}>
                    {text.columns.production}
                  </th>
                  <th scope="col" className={chartStyles.number}>
                    {text.columns.value}
                  </th>
                </tr>
              </thead>
              <tbody>
                {producers.map(({ series, point, tonnes }) => (
                  <tr key={series.country.iso3}>
                    <th scope="row">{series.country.name}</th>
                    <td className={chartStyles.number}>
                      {formatMass(tonnes, unit)}
                      {point.basis === 'estimate' && ` (${text.estimate})`}
                    </td>
                    <td className={chartStyles.number}>
                      {point.valueUsd === null ? '—' : formatUsd(point.valueUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
