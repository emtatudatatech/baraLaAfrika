import type { VinaraMetricResponse } from '@bla/shared';
import { type PointerEvent, useId, useState } from 'react';

import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { linePath, linear, useWidth, yearTicks } from '../../dhahabu/charts/chartMath';
import goldStyles from '../../dhahabu/charts/GoldCharts.module.css';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { formatVinaraValue } from '../vinaraFormat';
import { niceTicks, tickLabel } from './vinaraChart';
import styles from './VinaraCharts.module.css';

const text = strings.vinara.detail;
const TOP = 16;
const PLOT = 200;
const AXIS = 24;
const LABEL_ROOM = 112;

/** The cardinal in the first categorical colour, the contender in the second. */
const COLOUR = { cardinal: 'var(--series-1)', contender: 'var(--series-2)' } as const;

/**
 * The cardinal's and the silent contender's yearly figures over the window: two lines with
 * direct labels and a legend, a crosshair tooltip by year, and the same figures as a table.
 */
export function LeadersChart({ data }: { data: VinaraMetricResponse }) {
  const { metric, series } = data;
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();
  const names = new Map(
    [...metric.cardinals, ...metric.contenders].map((e) => [e.iso3, e.name] as const),
  );
  const [cardinal, contender] = series;
  if (cardinal === undefined || contender === undefined) {
    return <p className={goldStyles.empty}>{text.leadersTie}</p>;
  }
  const lines = [cardinal, contender];
  const name = (iso3: string) => names.get(iso3) ?? iso3;
  const format = (value: number) => formatVinaraValue(metric, value);
  const { from, to } = metric.window;
  const values = lines.flatMap((s) => s.points.map((p) => p.value));
  const ticks = niceTicks(values);
  const left = Math.max(40, ...ticks.map((t) => tickLabel(metric, t).length * 6.4 + 10));
  const labelRoom = width < 520 ? 84 : LABEL_ROOM;
  const plotWidth = Math.max(40, width - left - labelRoom);
  const x = linear([from, Math.max(to, from + 1)], [left, left + plotWidth]);
  const y = linear([ticks[0] ?? 0, ticks.at(-1) ?? 1], [TOP + PLOT, TOP]);
  const height = TOP + PLOT + AXIS;
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const ends = lines.map((s) => {
    const last = s.points.at(-1);
    return last ? y(last.value) : TOP;
  });
  // Keep the two end labels apart.
  const [a = TOP, b = TOP] = ends;
  const gap = 16;
  const labelYs =
    Math.abs(a - b) >= gap
      ? [a, b]
      : a <= b
        ? [a - gap / 2, b + gap / 2]
        : [a + gap / 2, b - gap / 2];

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const year = Math.round(from + ((event.clientX - rect.left - left) / plotWidth) * (to - from));
    setHover(Math.min(to, Math.max(from, year)));
  };
  const hasEstimate = lines.some((s) => s.points.some((p) => p.estimate));
  const note =
    metric.key === 'currency_performance' || metric.key === 'currency_stability'
      ? text.yearlyNote.fx
      : text.yearlyNote[metric.kind];

  return (
    <div className={styles.chart} data-testid="vinara-leaders-chart">
      <p className={goldStyles.subtitle}>
        {note}
        {hasEstimate && ` ${text.estimateMark}`}
      </p>
      <ul className={chartStyles.legend} aria-label={text.leadersTitle(metric.name)}>
        {lines.map((s) => (
          <li key={s.iso3}>
            <span className={goldStyles.lineSwatch} style={{ '--swatch': COLOUR[s.role] }} />
            {name(s.iso3)} ({s.role === 'cardinal' ? text.cardinal : text.contender})
          </li>
        ))}
      </ul>
      <div ref={frameRef} className={cx('glass', chartStyles.frame)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={descId}
            data-testid="vinara-leaders-svg"
            onPointerMove={onMove}
            onPointerLeave={() => {
              setHover(null);
            }}
          >
            <desc id={descId}>
              {text.leadersDescription(name(cardinal.iso3), name(contender.iso3), from, to)}
            </desc>
            {ticks.map((tick) => (
              <g key={tick} aria-hidden="true">
                <line
                  x1={left}
                  x2={left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={cx(chartStyles.grid, tick === 0 && styles.zero)}
                />
                <text x={left - 6} y={y(tick)} className={goldStyles.yTick}>
                  {tickLabel(metric, tick)}
                </text>
              </g>
            ))}
            {lines.map((s) => (
              <g key={s.iso3} style={{ '--line': COLOUR[s.role] }}>
                <path
                  d={linePath(
                    years.map((yr) => {
                      const point = s.points.find((p) => p.year === yr);
                      return { x: x(yr), y: point === undefined ? null : y(point.value) };
                    }),
                  )}
                  className={goldStyles.line}
                  data-testid="vinara-leaders-line"
                  data-iso3={s.iso3}
                />
                {s.points.map((p) => (
                  <circle
                    key={p.year}
                    cx={x(p.year)}
                    cy={y(p.value)}
                    r={4}
                    className={cx(styles.point, p.estimate && styles.estimatePoint)}
                  />
                ))}
              </g>
            ))}
            {lines.map((s, index) => (
              <text
                key={s.iso3}
                x={left + plotWidth + 8}
                y={labelYs[index] ?? TOP}
                className={goldStyles.directLabel}
                aria-hidden="true"
              >
                {name(s.iso3).length > 12 && width < 520
                  ? `${name(s.iso3).slice(0, 11)}…`
                  : name(s.iso3)}
              </text>
            ))}
            {yearTicks(from, to, Math.max(2, Math.floor(plotWidth / 56))).map((year) => (
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
                y2={TOP + PLOT}
                className={goldStyles.crosshair}
              />
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            className={cx('glass glass--strong', chartStyles.tooltip)}
            style={{
              top: `${String(TOP + 8)}px`,
              left: `${String(
                x(hover) + 260 > width ? Math.max(8, x(hover) - 252) : x(hover) + 12,
              )}px`,
            }}
            data-testid="vinara-leaders-tooltip"
          >
            <strong>{hover}</strong>
            {lines.map((s) => {
              const point = s.points.find((p) => p.year === hover);
              return (
                <span key={s.iso3} className={goldStyles.tooltipRow}>
                  <span className={goldStyles.lineSwatch} style={{ '--swatch': COLOUR[s.role] }} />
                  {name(s.iso3)}: {point === undefined ? '—' : format(point.value)}
                  {point?.estimate && ` (${strings.vinara.table.estimate})`}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <details className={chartStyles.tableView}>
        <summary>{text.tableToggle}</summary>
        <div className={goldStyles.tableScroll}>
          <table className={chartStyles.table} data-testid="vinara-leaders-table">
            <caption className="visually-hidden">{text.leadersTitle(metric.name)}</caption>
            <thead>
              <tr>
                <th scope="col">{text.columns.year}</th>
                {lines.map((s) => (
                  <th key={s.iso3} scope="col" className={chartStyles.number}>
                    {name(s.iso3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...years].reverse().map((year) => (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  {lines.map((s) => {
                    const point = s.points.find((p) => p.year === year);
                    return (
                      <td key={s.iso3} className={chartStyles.number}>
                        {point === undefined ? '—' : format(point.value)}
                        {point?.estimate && ` (${strings.vinara.table.estimate})`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
