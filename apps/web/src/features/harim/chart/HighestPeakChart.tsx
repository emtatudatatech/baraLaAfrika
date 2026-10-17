import type { MountainCountrySummary, RegionSlug } from '@bla/shared';
import { metresToFeet } from '@bla/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '../../../components/Icon/Icon';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { type Unit, formatElevation, otherUnit } from '../../../lib/units';
import { barPath, heightTicks, truncate } from './chartScale';
import styles from './HighestPeakChart.module.css';

const text = strings.harim.chart;
const ROW = 20;
const BAR = 12;
const TOP = 28;
const BOTTOM = 26;
const number = new Intl.NumberFormat('en');

export interface HighestPeakChartProps {
  /** The countries in the current region (all 54 without a region filter). */
  rows: readonly MountainCountrySummary[];
  /** Africa's highest point in metres (the reference line). */
  referenceM: number;
  unit: Unit;
  onOpenCountry: (iso3: string) => void;
}

type Order = 'height' | 'name';

/**
 * "Highest peak by country" (spec 7.5 item 5): one bar per country, in its region's colour,
 * with a thin line at Kilimanjaro. Hover or tap a bar for its values; the table view below is
 * the accessible equivalent. Follows the page's region filter.
 */
export function HighestPeakChart({ rows, referenceM, unit, onOpenCountry }: HighestPeakChartProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [order, setOrder] = useState<Order>('height');
  const [hover, setHover] = useState<string | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, []);

  const data = useMemo(() => {
    const withPeak = rows.flatMap((row) =>
      row.highestPeak ? [{ row, peak: row.highestPeak }] : [],
    );
    return withPeak.sort((a, b) =>
      order === 'name'
        ? a.row.country.name.localeCompare(b.row.country.name, 'en')
        : b.peak.elevationM - a.peak.elevationM ||
          a.row.country.name.localeCompare(b.row.country.name, 'en'),
    );
  }, [rows, order]);

  const regions = useMemo(() => {
    const seen = new Map<RegionSlug, string>();
    for (const { row } of data) seen.set(row.country.region.slug, row.country.region.name);
    return [...seen];
  }, [data]);

  const toUnit = (metres: number) => (unit === 'm' ? metres : metresToFeet(metres));
  const ticks = heightTicks(referenceM, unit);
  const domain = ticks.at(-1) ?? 1;
  const labelWidth = width < 520 ? 104 : 168;
  const plotLeft = labelWidth + 8;
  const plotWidth = Math.max(40, width - plotLeft - 12);
  const x = (value: number) => plotLeft + (value / domain) * plotWidth;
  const height = TOP + data.length * ROW + BOTTOM;
  const reference = x(toUnit(referenceM));
  const hovered = data.find((d) => d.row.country.iso3 === hover);
  const hoveredIndex = hovered ? data.indexOf(hovered) : -1;

  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid="harim-chart">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          <Icon name="bar_chart" size={24} />
          {text.title}
        </h2>
        <div role="group" aria-label={text.sortLabel} className={styles.segmented}>
          {(['height', 'name'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={order === option}
              data-testid={`harim-chart-sort-${option}`}
              onClick={() => {
                setOrder(option);
              }}
            >
              {text.sorts[option]}
            </button>
          ))}
        </div>
      </div>

      {regions.length > 1 && (
        <ul className={styles.legend} aria-label={text.regions}>
          {regions.map(([slug, name]) => (
            <li key={slug}>
              <span className={styles.swatch} style={{ '--swatch': `var(--region-${slug})` }} />
              {name}
            </li>
          ))}
        </ul>
      )}

      <div ref={frameRef} className={cx('glass', styles.frame)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            data-testid="harim-chart-svg"
          >
            <desc id={descId}>{text.description(data.length)}</desc>
            {ticks.map((tick) => (
              <g key={tick} aria-hidden="true">
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={TOP - 4}
                  y2={height - BOTTOM}
                  className={styles.grid}
                />
                <text x={x(tick)} y={height - BOTTOM + 16} className={styles.tick}>
                  {/* The last tick carries the unit: "6,000 m". */}
                  {tick === domain ? `${number.format(tick)}\u00a0${unit}` : number.format(tick)}
                </text>
              </g>
            ))}
            {data.map(({ row, peak }, index) => {
              const y = TOP + index * ROW + (ROW - BAR) / 2;
              const dimmed = hover !== null && hover !== row.country.iso3;
              return (
                <g
                  key={row.country.iso3}
                  className={cx(styles.row, dimmed && styles.dimmed)}
                  data-iso3={row.country.iso3}
                  data-testid="harim-chart-bar"
                  onPointerEnter={() => {
                    setHover(row.country.iso3);
                  }}
                  onPointerLeave={() => {
                    setHover((current) => (current === row.country.iso3 ? null : current));
                  }}
                  onClick={() => {
                    setHover(row.country.iso3);
                  }}
                >
                  <rect
                    x={0}
                    y={TOP + index * ROW}
                    width={width}
                    height={ROW}
                    className={styles.hit}
                  />
                  <text x={labelWidth} y={y + BAR / 2} className={styles.label}>
                    {truncate(row.country.name, labelWidth)}
                  </text>
                  <path
                    d={barPath(plotLeft, y, x(toUnit(peak.elevationM)) - plotLeft, BAR)}
                    className={styles.bar}
                    style={{ '--fill': `var(--region-${row.country.region.slug})` }}
                  />
                </g>
              );
            })}
            <g aria-hidden="true" className={styles.reference}>
              <line x1={reference} x2={reference} y1={TOP - 10} y2={height - BOTTOM} />
              <text x={reference} y={TOP - 14}>
                {text.reference(formatElevation(referenceM, unit))}
              </text>
            </g>
          </svg>
        )}
        {hovered && (
          <div
            className={cx('glass glass--strong', styles.tooltip)}
            style={{
              top: `${String(TOP + hoveredIndex * ROW + ROW + 4)}px`,
              left: `${String(Math.min(Math.max(8, x(toUnit(hovered.peak.elevationM)) - 120), width - 248))}px`,
            }}
            data-testid="harim-chart-tooltip"
          >
            <strong>{hovered.row.country.name}</strong>
            <span>{hovered.peak.name}</span>
            <span className={styles.figure}>
              {formatElevation(hovered.peak.elevationM, unit)} ·{' '}
              {formatElevation(hovered.peak.elevationM, otherUnit(unit))}
            </span>
            <button
              type="button"
              className={styles.tooltipLink}
              onClick={() => {
                onOpenCountry(hovered.row.country.iso3);
              }}
            >
              {text.showCountry}
            </button>
          </div>
        )}
      </div>

      <details className={styles.tableView}>
        <summary>{text.tableToggle}</summary>
        <table className={styles.table} data-testid="harim-chart-table">
          <caption className="visually-hidden">{text.title}</caption>
          <thead>
            <tr>
              <th scope="col">{text.columns.country}</th>
              <th scope="col">{text.columns.peak}</th>
              <th scope="col" className={styles.number}>
                {text.columns.height}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map(({ row, peak }) => (
              <tr key={row.country.iso3}>
                <th scope="row">{row.country.name}</th>
                <td>{peak.name}</td>
                <td className={styles.number}>{formatElevation(peak.elevationM, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
