import type { VinaraMetric } from '@bla/shared';
import { useId } from 'react';

import { Icon } from '../../../components/Icon/Icon';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { useWidth } from '../../dhahabu/charts/chartMath';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { METRIC_ICONS } from '../metricIcons';
import { formatShare, formatVinaraValue, formatWindow } from '../vinaraFormat';
import { niceTicks, signedBarPath } from './vinaraChart';
import styles from './VinaraCharts.module.css';

const text = strings.vinara.multiples;
const ROW = 26;
const BAR = 14;
const TOP = 4;
const LABEL = 76;

/** Measures whose regional figure is a sum, so each region's share of Africa means something. */
const SUMS = new Set(['population', 'land_area', 'gdp_usd', 'gdp_ppp', 'gni_usd', 'military_usd']);

/**
 * Region against region as small multiples: one small bar chart per measure, the five regions in
 * their colours and order, every bar labelled with its figure (and, for totals, its share of
 * Africa). A partial region is lighter, hatched and says how much of it is covered; it is not
 * ranked. The table view (the section's other tab) has the same figures.
 */
export function RegionMultiples({ metrics }: { metrics: readonly VinaraMetric[] }) {
  return (
    <ul className={styles.multiples} data-testid="vinara-multiples">
      {metrics.map((metric) =>
        metric.regions === null ? null : <Multiple key={metric.key} metric={metric} />,
      )}
    </ul>
  );
}

function Multiple({ metric }: { metric: VinaraMetric }) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const titleId = useId();
  const descId = useId();
  const values = metric.regions?.values ?? [];
  const leaders = new Set(metric.regions?.cardinals.map((r) => r.slug));
  const ticks = niceTicks(
    values.flatMap((v) => (v.value === null ? [] : [v.value])),
    2,
  );
  const low = ticks[0] ?? 0;
  const high = ticks.at(-1) ?? 1;
  // Room after the longest bar for its figure and note ("US$1.00 tn · 30% of Africa").
  const valueRoom = Math.min(170, Math.round(width * 0.45));
  const plotWidth = Math.max(30, width - LABEL - valueRoom);
  const x = (value: number) => LABEL + ((value - low) / (high - low || 1)) * plotWidth;
  const height = TOP + values.length * ROW;
  const total = SUMS.has(metric.key) ? values.reduce((sum, v) => sum + (v.value ?? 0), 0) : null;

  return (
    <li
      className={cx('glass', styles.multiple)}
      data-metric={metric.key}
      data-testid="vinara-multiple"
    >
      <div className={styles.multipleHead}>
        <span className={styles.multipleIcon} aria-hidden="true">
          <Icon name={METRIC_ICONS[metric.key]} size={18} />
        </span>
        <h3 id={titleId} className={styles.multipleTitle}>
          {metric.name}
        </h3>
        <span className={styles.multipleYears}>{formatWindow(metric.window)}</span>
      </div>
      <div ref={frameRef}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
          >
            <desc id={descId}>{text.description(metric.name)}</desc>
            {low < 0 && (
              <line
                x1={x(0)}
                x2={x(0)}
                y1={0}
                y2={height}
                className={cx(chartStyles.grid, styles.zero)}
              />
            )}
            {values.map((region, index) => {
              const y = TOP + index * ROW + (ROW - BAR) / 2;
              const zero = x(0);
              const end = region.value === null ? zero : x(region.value);
              const share =
                total !== null && total > 0 && region.value !== null && !region.partial
                  ? text.shareOfAfrica(formatShare(region.value / total))
                  : null;
              return (
                <g
                  key={region.slug}
                  data-region={region.slug}
                  data-partial={region.partial || undefined}
                  data-testid="vinara-multiple-bar"
                >
                  <text x={LABEL - 8} y={y + BAR / 2} className={chartStyles.label}>
                    {region.name.replace(' Africa', '')}
                  </text>
                  {region.value !== null && (
                    <path
                      d={signedBarPath(zero, Math.abs(end - zero) < 1 ? zero + 1 : end, y, BAR)}
                      className={cx(
                        chartStyles.bar,
                        region.partial && styles.partialBar,
                        leaders.has(region.slug) && styles.leaderBar,
                      )}
                      style={{ '--fill': `var(--region-${region.slug})` }}
                    />
                  )}
                  <text
                    x={Math.max(end, zero) + 6}
                    y={y + BAR / 2}
                    className={styles.multipleValue}
                  >
                    {region.value === null ? '—' : formatVinaraValue(metric, region.value)}
                    {region.partial && (
                      <tspan className={styles.partialText}>
                        {` · ${text.partial(formatShare(region.coverage))}`}
                      </tspan>
                    )}
                    {share !== null && (
                      <tspan className={styles.partialText}>{` · ${share}`}</tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </li>
  );
}
