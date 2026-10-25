import type { VinaraMetricResponse } from '@bla/shared';
import { useId, useState } from 'react';

import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { useWidth } from '../../dhahabu/charts/chartMath';
import goldStyles from '../../dhahabu/charts/GoldCharts.module.css';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { truncate } from '../../harim/chart/chartScale';
import { formatVinaraValue } from '../vinaraFormat';
import { niceTicks, ordinal, signedBarPath, tickLabel } from './vinaraChart';
import styles from './VinaraCharts.module.css';

const text = strings.vinara.detail;
const ROW = 22;
const BAR = 14;
const TOP = 8;
const BOTTOM = 26;
/** Bars shown before "Show all". */
const TOP_N = 10;

type Role = 'cardinal' | 'contender' | 'other';

/**
 * Every ranked state as a horizontal bar, best first (the top ten, then all on request). Bars
 * start at zero, so a currency's loss runs left. The cardinal and the contender are in the
 * line chart's colours and named in the legend; the rest are neutral. Hover, focus or tap shows
 * the figure and "Open the state"; the table below has the same figures.
 */
export function RankingBars({
  data,
  onOpen,
}: {
  data: VinaraMetricResponse;
  onOpen: (iso3: string) => void;
}) {
  const { metric, ranking } = data;
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const descId = useId();
  const cardinals = new Set(metric.cardinals.map((e) => e.iso3));
  const contenders = new Set(metric.contenders.map((e) => e.iso3));
  const role = (iso3: string): Role =>
    cardinals.has(iso3) ? 'cardinal' : contenders.has(iso3) ? 'contender' : 'other';
  const bars = all ? ranking : ranking.slice(0, TOP_N);
  const format = (value: number) => formatVinaraValue(metric, value);

  // The axis fits the bars shown (the top ten, or all), so the leaders are never squeezed.
  const ticks = niceTicks(bars.map((r) => r.value));
  const low = ticks[0] ?? 0;
  const high = ticks.at(-1) ?? 1;
  const labelWidth = width < 520 ? 104 : 176;
  const valueRoom = width < 520 ? 72 : 104;
  const plotLeft = labelWidth + 10;
  const plotWidth = Math.max(40, width - plotLeft - valueRoom);
  const x = (value: number) => plotLeft + ((value - low) / (high - low || 1)) * plotWidth;
  const height = TOP + bars.length * ROW + BOTTOM;
  const hovered = bars.find((b) => b.iso3 === hover);
  const hoveredIndex = hovered ? bars.indexOf(hovered) : -1;

  return (
    <div className={styles.chart} data-testid="vinara-ranking">
      <ul className={chartStyles.legend}>
        <li>
          <span className={chartStyles.swatch} style={{ '--swatch': 'var(--series-1)' }} />
          {text.cardinal}
        </li>
        <li>
          <span className={chartStyles.swatch} style={{ '--swatch': 'var(--series-2)' }} />
          {text.contender}
        </li>
        <li>
          <span className={chartStyles.swatch} style={{ '--swatch': 'var(--vinara-other)' }} />
          {text.other}
        </li>
      </ul>
      <div ref={frameRef} className={cx('glass', chartStyles.frame, styles.rankingFrame)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={descId}
            data-testid="vinara-ranking-svg"
          >
            <desc id={descId}>{text.rankingDescription(metric.name, ranking.length)}</desc>
            {ticks.map((tick) => (
              <g key={tick} aria-hidden="true">
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={TOP - 4}
                  y2={height - BOTTOM}
                  className={cx(chartStyles.grid, tick === 0 && styles.zero)}
                />
                <text x={x(tick)} y={height - BOTTOM + 16} className={chartStyles.tick}>
                  {tickLabel(metric, tick)}
                </text>
              </g>
            ))}
            {bars.map((bar, index) => {
              const y = TOP + index * ROW + (ROW - BAR) / 2;
              const dimmed = hover !== null && hover !== bar.iso3;
              const r = role(bar.iso3);
              const end = x(bar.value);
              const zero = x(0);
              return (
                <g
                  key={bar.iso3}
                  className={cx(chartStyles.row, dimmed && chartStyles.dimmed)}
                  data-iso3={bar.iso3}
                  data-role={r}
                  data-testid="vinara-ranking-bar"
                  onPointerEnter={() => {
                    setHover(bar.iso3);
                  }}
                  onPointerLeave={() => {
                    setHover((current) => (current === bar.iso3 ? null : current));
                  }}
                  onClick={() => {
                    setHover(bar.iso3);
                  }}
                >
                  <rect
                    x={0}
                    y={TOP + index * ROW}
                    width={width}
                    height={ROW}
                    className={chartStyles.hit}
                  />
                  <text x={labelWidth} y={y + BAR / 2} className={chartStyles.label}>
                    {`${String(bar.rank)}. ${truncate(bar.name, labelWidth - 24)}`}
                  </text>
                  <path
                    d={signedBarPath(zero, Math.abs(end - zero) < 1 ? zero + 1 : end, y, BAR)}
                    className={chartStyles.bar}
                    style={{
                      '--fill':
                        r === 'cardinal'
                          ? 'var(--series-1)'
                          : r === 'contender'
                            ? 'var(--series-2)'
                            : 'var(--vinara-other)',
                    }}
                  />
                  <text x={Math.max(end, zero) + 6} y={y + BAR / 2} className={goldStyles.barValue}>
                    {format(bar.value)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hovered && (
          <div
            className={cx('glass glass--strong', chartStyles.tooltip)}
            style={{
              top: `${String(TOP + hoveredIndex * ROW + ROW + 8)}px`,
              left: `${String(Math.min(Math.max(8, x(hovered.value) - 120), Math.max(8, width - 248)))}px`,
            }}
            data-testid="vinara-ranking-tooltip"
          >
            <strong>{hovered.name}</strong>
            <span>{text.rank(ordinal(hovered.rank))}</span>
            <span>
              {format(hovered.value)}
              {metric.kind === 'level' && ` · ${String(hovered.year)}`}
              {hovered.estimate && ` (${strings.vinara.table.estimate})`}
            </span>
            <button
              type="button"
              className={chartStyles.tooltipLink}
              onClick={() => {
                onOpen(hovered.iso3);
              }}
            >
              {text.openCountry}
            </button>
          </div>
        )}
      </div>
      {ranking.length > TOP_N && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={all}
          data-testid="vinara-ranking-toggle"
          onClick={() => {
            setAll((value) => !value);
          }}
        >
          {all ? text.showTop(TOP_N) : text.showAll(ranking.length)}
        </button>
      )}
      <details className={chartStyles.tableView}>
        <summary>{text.tableToggle}</summary>
        <div className={goldStyles.tableScroll}>
          <table className={chartStyles.table} data-testid="vinara-ranking-table">
            <caption className="visually-hidden">{text.rankingTitle(metric.name)}</caption>
            <thead>
              <tr>
                <th scope="col">{text.columns.rank}</th>
                <th scope="col">{text.columns.state}</th>
                <th scope="col" className={chartStyles.number}>
                  {text.columns.value}
                </th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row) => (
                <tr key={row.iso3}>
                  <td>{row.rank}</td>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.nameButton}
                      onClick={() => {
                        onOpen(row.iso3);
                      }}
                    >
                      {row.name}
                    </button>
                  </th>
                  <td className={chartStyles.number}>
                    {format(row.value)}
                    {metric.kind === 'level' && ` · ${String(row.year)}`}
                    {row.estimate && ` (${strings.vinara.table.estimate})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
