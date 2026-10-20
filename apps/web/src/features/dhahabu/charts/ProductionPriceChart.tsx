import type { GoldPriceResponse, GoldProductionTotal, GoldUnit } from '@bla/shared';
import { TROY_OZ_PER_TONNE } from '@bla/shared';
import { type PointerEvent, useId, useState } from 'react';

import { Icon } from '../../../components/Icon/Icon';
import { cx } from '../../../lib/cx';
import { formatMass, formatPrice, massUnitLabel } from '../../../lib/goldUnits';
import { strings } from '../../../lib/strings';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { linePath, linear, niceTicks, useWidth, yearTicks } from './chartMath';
import styles from './GoldCharts.module.css';

const text = strings.dhahabu.charts.production;
const LEFT = 56;
const RIGHT = 16;
const TOP = 12;
const PANEL_TOP = 150;
const GAP = 34;
const PANEL_BOTTOM = 110;
const AXIS = 24;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

/**
 * "Africa's mine production and the gold price" (spec 7.6 item 5): two panels sharing the
 * ribbon's year axis (never two y-axes on one plot): Africa's (or the region's) yearly
 * production, partial years hatched, above the gold price.
 */
export function ProductionPriceChart({
  totals,
  price,
  from: rangeFrom,
  to,
  unit,
  scopeName,
}: {
  totals: readonly GoldProductionTotal[];
  price: GoldPriceResponse;
  from: number;
  to: number;
  unit: GoldUnit;
  scopeName: string | null;
}) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();
  const hatchId = useId();

  // Start where the production figures start (two years' margin) when the range begins earlier:
  // the two panels compare production with the price, so decades without production are left out.
  const firstProduction = totals[0]?.year;
  const from =
    firstProduction !== undefined && firstProduction - 2 > rangeFrom
      ? firstProduction - 2
      : rangeFrom;
  const toUnit = (tonnes: number) =>
    unit === 't' ? tonnes : unit === 'kg' ? tonnes * 1000 : tonnes * TROY_OZ_PER_TONNE;
  const prices = new Map(price.points.map((p) => [Number(p.period), p.usdPerOz]));
  // A year still in progress averages only the months published so far.
  const partialMonths = new Map(
    price.points.flatMap((p) =>
      p.months !== undefined && p.months < 12 ? [[Number(p.period), p.months] as const] : [],
    ),
  );
  const priceText = (year: number, value: number) => {
    const months = partialMonths.get(year);
    return months === undefined
      ? formatPrice(value)
      : `${formatPrice(value)} ${text.monthsSoFar(months)}`;
  };
  const byYear = new Map(totals.map((t) => [t.year, t]));
  const plotWidth = Math.max(40, width - LEFT - RIGHT);
  const band = plotWidth / (to - from + 1);
  const x = (year: number) => LEFT + (year - from + 0.5) * band;
  const barWidth = Math.min(28, Math.max(2, band * 0.7));

  const productionTicks = niceTicks(Math.max(0, ...totals.map((t) => t.tonnes)));
  const yProduction = linear([0, productionTicks.at(-1) ?? 1], [TOP + PANEL_TOP, TOP]);
  const priceTop = TOP + PANEL_TOP + GAP;
  const priceTicks = niceTicks(Math.max(0, ...prices.values()));
  const yPrice = linear([0, priceTicks.at(-1) ?? 1], [priceTop + PANEL_BOTTOM, priceTop]);
  const height = priceTop + PANEL_BOTTOM + AXIS;
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const pricePath = linePath(
    years.map((year) => ({
      x: x(year),
      y: prices.has(year) ? yPrice(prices.get(year) ?? 0) : null,
    })),
  );
  const hasPartial = totals.some((t) => !t.complete);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const year = Math.floor((event.clientX - rect.left - LEFT) / band) + from;
    setHover(year >= from && year <= to ? year : null);
  };
  const hovered =
    hover === null ? null : { year: hover, total: byYear.get(hover), price: prices.get(hover) };

  return (
    <section
      className={chartStyles.section}
      aria-labelledby={titleId}
      data-testid="gold-production-chart"
    >
      <div className={chartStyles.head}>
        <h3 id={titleId} className={chartStyles.title}>
          <Icon name="stacked_line_chart" size={24} />
          {text.title}
        </h3>
      </div>
      <p className={styles.subtitle}>
        {from}–{to}
        {from > rangeFrom &&
          firstProduction !== undefined &&
          ` · ${text.startsAt(firstProduction)}`}
        {scopeName !== null && ` · ${scopeName}`}
      </p>
      {hasPartial && (
        <ul className={chartStyles.legend}>
          <li>
            <span className={chartStyles.swatch} style={{ '--swatch': 'var(--gold-accent)' }} />
            {text.complete}
          </li>
          <li>
            <span className={cx(chartStyles.swatch, styles.partialSwatch)} />
            {text.partial}
          </li>
        </ul>
      )}
      <div ref={frameRef} className={cx('glass', chartStyles.frame)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            data-testid="gold-production-svg"
            onPointerMove={onMove}
            onPointerLeave={() => {
              setHover(null);
            }}
          >
            <desc id={descId}>{text.description(from, to)}</desc>
            <defs>
              <pattern
                id={hatchId}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" className={styles.partialFill} />
                <line x1="0" y1="0" x2="0" y2="5" className={styles.partialLine} />
              </pattern>
            </defs>

            {/* Production panel */}
            <text x={LEFT} y={TOP - 2} className={styles.panelLabel} aria-hidden="true">
              {text.productionPanel.replace('(tonnes)', `(${massUnitLabel(unit)})`)}
            </text>
            {productionTicks.map((tick) => (
              <g key={`p${String(tick)}`} aria-hidden="true">
                <line
                  x1={LEFT}
                  x2={LEFT + plotWidth}
                  y1={yProduction(tick)}
                  y2={yProduction(tick)}
                  className={chartStyles.grid}
                />
                <text x={LEFT - 6} y={yProduction(tick)} className={styles.yTick}>
                  {number.format(toUnit(tick))}
                </text>
              </g>
            ))}
            {totals.map((t) => {
              if (t.year < from || t.year > to) return null;
              const y = yProduction(t.tonnes);
              return (
                <rect
                  key={t.year}
                  x={x(t.year) - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={Math.max(0, TOP + PANEL_TOP - y)}
                  rx={Math.min(3, barWidth / 3)}
                  className={t.complete ? styles.productionBar : styles.partialBar}
                  style={t.complete ? undefined : { fill: `url(#${hatchId})` }}
                  data-testid="gold-production-bar"
                  data-year={t.year}
                  data-complete={t.complete}
                />
              );
            })}
            {firstProduction !== undefined && firstProduction > from + 3 && (
              <text x={LEFT + 4} y={TOP + PANEL_TOP - 8} className={styles.panelNote}>
                {text.noProduction(firstProduction)}
              </text>
            )}

            {/* Price panel */}
            <text x={LEFT} y={priceTop - 10} className={styles.panelLabel} aria-hidden="true">
              {width < 560 ? text.pricePanelShort : text.pricePanel}
            </text>
            {priceTicks.map((tick) => (
              <g key={`q${String(tick)}`} aria-hidden="true">
                <line
                  x1={LEFT}
                  x2={LEFT + plotWidth}
                  y1={yPrice(tick)}
                  y2={yPrice(tick)}
                  className={chartStyles.grid}
                />
                <text x={LEFT - 6} y={yPrice(tick)} className={styles.yTick}>
                  {number.format(tick)}
                </text>
              </g>
            ))}
            <path d={pricePath} className={styles.priceLine} data-testid="gold-price-line" />

            {/* Shared year axis */}
            {yearTicks(from, to, Math.max(2, Math.floor(plotWidth / 70))).map((year) => (
              <text
                key={year}
                x={x(year)}
                y={height - 6}
                className={chartStyles.tick}
                aria-hidden="true"
              >
                {year}
              </text>
            ))}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={TOP}
                y2={priceTop + PANEL_BOTTOM}
                className={styles.crosshair}
              />
            )}
          </svg>
        )}
        {hovered && (
          <div
            className={cx('glass glass--strong', chartStyles.tooltip)}
            style={{
              top: `${String(TOP + 8)}px`,
              left: `${String(
                x(hovered.year) + 260 > width
                  ? Math.max(8, x(hovered.year) - 252)
                  : x(hovered.year) + 12,
              )}px`,
            }}
            data-testid="gold-production-tooltip"
          >
            <strong>{hovered.year}</strong>
            <span>
              {hovered.total
                ? text.tooltipProduction(
                    formatMass(hovered.total.tonnes, unit),
                    hovered.total.countries,
                  )
                : strings.dhahabu.map.noData}
            </span>
            {hovered.total && !hovered.total.complete && (
              <span className={styles.tooltipNote}>
                {text.tooltipMissing(hovered.total.missingCountries)}
              </span>
            )}
            {hovered.price !== undefined && (
              <span>{text.tooltipPrice(priceText(hovered.year, hovered.price))}</span>
            )}
          </div>
        )}
      </div>
      <details className={chartStyles.tableView}>
        <summary>{strings.dhahabu.charts.tableToggle}</summary>
        <table className={chartStyles.table} data-testid="gold-production-table">
          <caption className="visually-hidden">{text.title}</caption>
          <thead>
            <tr>
              <th scope="col">{text.columns.year}</th>
              <th scope="col" className={chartStyles.number}>
                {text.columns.production}
              </th>
              <th scope="col">{text.columns.complete}</th>
              <th scope="col" className={chartStyles.number}>
                {text.columns.price}
              </th>
            </tr>
          </thead>
          <tbody>
            {years
              .filter((year) => byYear.has(year) || prices.has(year))
              .reverse()
              .map((year) => {
                const total = byYear.get(year);
                const value = prices.get(year);
                return (
                  <tr key={year}>
                    <th scope="row">{year}</th>
                    <td className={chartStyles.number}>
                      {total ? formatMass(total.tonnes, unit) : '—'}
                    </td>
                    <td>{total ? (total.complete ? text.yes : text.no) : '—'}</td>
                    <td className={chartStyles.number}>
                      {value === undefined ? '—' : priceText(year, value)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </details>
    </section>
  );
}
