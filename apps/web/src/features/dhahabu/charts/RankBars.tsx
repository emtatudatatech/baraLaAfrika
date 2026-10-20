import type { RegionSlug } from '@bla/shared';
import { type ReactNode, useId, useState } from 'react';

import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { barPath, truncate } from '../../harim/chart/chartScale';
import { niceTicks, useWidth } from './chartMath';
import styles from './GoldCharts.module.css';

const ROW = 22;
const BAR = 14;
const TOP = 10;
const BOTTOM = 26;

export interface RankBar {
  iso3: string;
  name: string;
  region: RegionSlug;
  value: number;
  /** The figure written at the end of the bar (omit to label none). */
  label?: string;
  /** The tooltip's lines under the name. */
  detail: ReactNode;
}

/**
 * Horizontal bars, largest first, in region colours, with a tick axis, a tooltip on hover, focus
 * or tap, and "Open the country". The chart's own data table is its accessible equivalent.
 */
export function RankBars({
  bars,
  tickLabel,
  description,
  testId,
  onOpen,
}: {
  bars: readonly RankBar[];
  tickLabel: (value: number, last: boolean) => string;
  description: string;
  testId: string;
  onOpen: (iso3: string) => void;
}) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const descId = useId();

  const ticks = niceTicks(Math.max(...bars.map((b) => b.value), 0));
  const domain = ticks.at(-1) ?? 1;
  const labelWidth = width < 520 ? 104 : 168;
  const valueRoom = bars.some((b) => b.label !== undefined) ? 72 : 12;
  const plotLeft = labelWidth + 8;
  const plotWidth = Math.max(40, width - plotLeft - valueRoom);
  const x = (value: number) => plotLeft + (value / domain) * plotWidth;
  const height = TOP + bars.length * ROW + BOTTOM;
  const hovered = bars.find((b) => b.iso3 === hover);
  const hoveredIndex = hovered ? bars.indexOf(hovered) : -1;

  return (
    <div ref={frameRef} className={cx('glass', chartStyles.frame)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          role="img"
          aria-labelledby={descId}
          data-testid={testId}
        >
          <desc id={descId}>{description}</desc>
          {ticks.map((tick, index) => (
            <g key={tick} aria-hidden="true">
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={TOP - 4}
                y2={height - BOTTOM}
                className={chartStyles.grid}
              />
              <text x={x(tick)} y={height - BOTTOM + 16} className={chartStyles.tick}>
                {tickLabel(tick, index === ticks.length - 1)}
              </text>
            </g>
          ))}
          {bars.map((bar, index) => {
            const y = TOP + index * ROW + (ROW - BAR) / 2;
            const dimmed = hover !== null && hover !== bar.iso3;
            return (
              <g
                key={bar.iso3}
                className={cx(chartStyles.row, dimmed && chartStyles.dimmed)}
                data-iso3={bar.iso3}
                data-testid={`${testId}-bar`}
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
                  {truncate(bar.name, labelWidth)}
                </text>
                <path
                  d={barPath(plotLeft, y, Math.max(1, x(bar.value) - plotLeft), BAR)}
                  className={chartStyles.bar}
                  style={{ '--fill': `var(--region-${bar.region})` }}
                />
                {bar.label !== undefined && (
                  <text x={x(bar.value) + 6} y={y + BAR / 2} className={styles.barValue}>
                    {bar.label}
                  </text>
                )}
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
          data-testid={`${testId}-tooltip`}
        >
          <strong>{hovered.name}</strong>
          {hovered.detail}
          <button
            type="button"
            className={chartStyles.tooltipLink}
            onClick={() => {
              onOpen(hovered.iso3);
            }}
          >
            {strings.dhahabu.charts.openCountry}
          </button>
        </div>
      )}
    </div>
  );
}
