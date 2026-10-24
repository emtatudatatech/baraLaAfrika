import {
  type RegionSlug,
  VINARA_METRICS,
  type VinaraMetric,
  type VinaraMetricKey,
  type VinaraMetricResponse,
} from '@bla/shared';
import { useId, useState } from 'react';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import goldStyles from '../dhahabu/charts/GoldCharts.module.css';
import chartStyles from '../harim/chart/HighestPeakChart.module.css';
import { LeadersChart } from './charts/LeadersChart';
import { RankingBars } from './charts/RankingBars';
import { METRIC_ICONS } from './metricIcons';
import { formatWindow } from './vinaraFormat';
import styles from './VinaraPage.module.css';

const text = strings.vinara.detail;

/**
 * One measure in detail (?metric=): the cardinal's and the contender's yearly figures as lines,
 * and every state ranked as bars, for the page's scope and years (/api/vinara/metrics/:key).
 */
export function MeasureDetail({
  metrics,
  metric: key,
  region,
  from,
  to,
  onMetric,
  onOpen,
}: {
  metrics: readonly VinaraMetric[];
  metric: VinaraMetricKey;
  region: RegionSlug | null;
  from: number | undefined;
  to: number | undefined;
  onMetric: (key: VinaraMetricKey) => void;
  onOpen: (iso3: string) => void;
}) {
  const titleId = useId();
  const resource = useResource(
    `vinara-metric:${key}:${region ?? 'africa'}:${String(from ?? '')}:${String(to ?? '')}`,
    () => api.vinaraMetric({ key, region, from, to }),
  );
  // While another measure loads, keep the previous charts (dimmed) instead of a flash.
  const [last, setLast] = useState<VinaraMetricResponse | null>(null);
  if (resource.status === 'success' && resource.data !== last) setLast(resource.data);
  const data = resource.status === 'success' ? resource.data : last;
  const stale = resource.status !== 'success' && data !== null;
  const summary = metrics.find((m) => m.key === key);

  return (
    <section
      className={styles.section}
      aria-labelledby={titleId}
      aria-busy={resource.status === 'loading'}
      data-testid="vinara-detail"
    >
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {text.title}
        </h2>
        <p className={styles.intro}>{text.intro}</p>
      </div>
      <div className={styles.detailControls}>
        <label className={styles.select}>
          <span>{text.measureLabel}</span>
          <select
            value={key}
            data-testid="vinara-metric-select"
            onChange={(event) => {
              const value = event.currentTarget.value;
              const next = VINARA_METRICS.find((k) => k === value);
              if (next !== undefined) onMetric(next);
            }}
          >
            {metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {summary !== undefined && (
          <p className={styles.detailDefinition}>
            <Icon name={METRIC_ICONS[key]} size={18} />
            <span>
              <strong>{formatWindow(summary.window)}.</strong> {summary.definition}
            </span>
          </p>
        )}
      </div>

      {resource.status === 'error' && data === null && (
        <div className={goldStyles.error} role="alert">
          <p>{text.loadError}</p>
          <DevApiHint error={resource.error} />
          <button type="button" className={goldStyles.retry} onClick={resource.retry}>
            {text.retry}
          </button>
        </div>
      )}
      {data === null && resource.status === 'loading' && (
        <div className={cx('skeleton', goldStyles.skeleton)} aria-hidden="true" />
      )}
      {data !== null && (
        <div className={cx(styles.detailCharts, stale && styles.stale)}>
          <div className={chartStyles.section}>
            <h3 className={styles.chartTitle}>{text.leadersTitle(data.metric.name)}</h3>
            <LeadersChart data={data} />
          </div>
          <div className={chartStyles.section}>
            <h3 className={styles.chartTitle}>{text.rankingTitle(data.metric.name)}</h3>
            <RankingBars data={data} onOpen={onOpen} />
          </div>
        </div>
      )}
    </section>
  );
}
