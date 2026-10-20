import type { CoverageDataset, DatasetKey } from '@bla/shared';
import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { formatCoverage, formatDate, formatRelative, summarize } from './coverageFormat';
import styles from './DataRibbon.module.css';
import { TimeRangeControl } from './TimeRangeControl';
import { useTimeRange } from './timeRangeContext';
import { useRouteCoverage } from './useRouteCoverage';

const text = strings.ribbon;

/** One dataset as the summary line shows it: its short label, plus its range on series pages. */
function summaryItem(
  key: DatasetKey,
  dataset: CoverageDataset | undefined,
  missing: boolean,
  timeDependent: boolean,
): string {
  const label = strings.datasets[key];
  if (missing) return `${label} (${text.notLoaded})`;
  const covers = dataset && timeDependent ? formatCoverage(dataset) : null;
  return covers === null ? label : `${label}: ${covers}`;
}

/**
 * Persistent strip showing the data behind the current view: its kind, "as of" date, datasets
 * (with their ranges on time-series pages) and when they were last refreshed, from
 * /api/coverage; plus the shared date-range control. Phones get one line and an expandable
 * details sheet.
 */
export function DataRibbon() {
  const { datasets, timeDependent, coverage } = useRouteCoverage();
  const { interactive } = useTimeRange();
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => new Date());
  const detailsId = useId();
  const ribbonRef = useRef<HTMLElement>(null);

  // Publish the ribbon's height so sticky content (e.g. table headers) can sit just below it.
  useEffect(() => {
    const node = ribbonRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--ribbon-height', `${String(node.offsetHeight)}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--ribbon-height');
    };
  }, []);

  const loaded = coverage?.status === 'success' ? coverage.data : undefined;
  const byKey = new Map(loaded?.datasets.map((dataset) => [dataset.key, dataset]));
  const missing = new Set(loaded?.missing);
  const { asOf, lastRefreshedAt } = summarize(loaded?.datasets ?? []);
  const nothingLoaded = loaded?.datasets.length === 0;
  const kind = timeDependent ? text.timeSeries : text.referenceData;

  const items = datasets.map((key) =>
    summaryItem(key, byKey.get(key), missing.has(key), timeDependent),
  );

  return (
    <aside ref={ribbonRef} className={cx('glass', styles.ribbon)} aria-label={text.label}>
      <div className={styles.inner}>
        <div className={styles.summary}>
          <Icon name="date_range" size={20} className={styles.leadIcon} />
          <span className={styles.kind}>{kind}</span>
          {asOf !== null && (
            <span
              className={cx(styles.asOf, interactive && styles.asOfSeries)}
              data-testid="ribbon-as-of"
            >
              {text.asOf(formatDate(asOf))}
            </span>
          )}
          {asOf === null && datasets.length > 0 && (
            <span className={styles.count} aria-hidden="true">
              {nothingLoaded ? text.nothingLoaded : text.datasetCount(datasets.length)}
            </span>
          )}
          <ul className={styles.datasets}>
            {datasets.length === 0 ? (
              <li>{text.noDatasets}</li>
            ) : (
              items.map((item) => <li key={item}>{item}</li>)
            )}
            {lastRefreshedAt !== null && (
              <li className={styles.refreshed} title={formatDate(lastRefreshedAt)}>
                {text.refreshed(formatRelative(lastRefreshedAt, now))}
              </li>
            )}
          </ul>
        </div>

        <TimeRangeControl loading={coverage?.status === 'loading'} />

        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span className="visually-hidden">{expanded ? text.hideDetails : text.showDetails}</span>
          <Icon name="keyboard_arrow_down" size={20} className={cx(expanded && styles.rotated)} />
        </button>
      </div>

      <div id={detailsId} className={styles.details} hidden={!expanded}>
        <p className={styles.detailsKind}>
          {kind}
          {asOf !== null && ` · ${text.asOf(formatDate(asOf))}`}
        </p>
        {datasets.length === 0 ? (
          <p>{text.noDatasets}</p>
        ) : (
          <ul className={styles.detailList} aria-label={text.detailsHeading}>
            {datasets.map((key) => (
              <DatasetDetails
                key={key}
                datasetKey={key}
                dataset={byKey.get(key)}
                missing={missing.has(key)}
                now={now}
              />
            ))}
          </ul>
        )}
        {coverage?.status === 'error' && (
          <p className={styles.error}>
            {text.coverageError}{' '}
            <button type="button" className={styles.retry} onClick={coverage.retry}>
              {text.retry}
            </button>
          </p>
        )}
        {!interactive && <p>{text.notTimeDependentHint}.</p>}
      </div>
    </aside>
  );
}

function DatasetDetails({
  datasetKey,
  dataset,
  missing,
  now,
}: {
  datasetKey: DatasetKey;
  dataset: CoverageDataset | undefined;
  missing: boolean;
  now: Date;
}) {
  const fields = text.fields;
  const covers = dataset ? formatCoverage(dataset) : null;
  return (
    <li className={styles.dataset} data-dataset={datasetKey}>
      <span className={styles.datasetName}>{dataset?.name ?? strings.datasets[datasetKey]}</span>
      {missing && <span className={styles.notLoaded}>{text.notLoaded}</span>}
      {dataset && (
        <dl className={styles.fields}>
          <div>
            <dt>{fields.asOf}</dt>
            <dd>{formatDate(dataset.asOf)}</dd>
          </div>
          {covers !== null && (
            <div>
              <dt>{fields.covers}</dt>
              <dd>{covers}</dd>
            </div>
          )}
          <div>
            <dt>{fields.updates}</dt>
            <dd>{text.cadence[dataset.refreshCadence]}</dd>
          </div>
          {dataset.lastRefreshedAt !== null && (
            <div>
              <dt>{fields.lastRefreshed}</dt>
              <dd>
                {formatDate(dataset.lastRefreshedAt)} ({formatRelative(dataset.lastRefreshedAt, now)})
              </dd>
            </div>
          )}
          <div>
            <dt>{fields.provider}</dt>
            <dd>{dataset.provider}</dd>
          </div>
          <div>
            <dt>{fields.licence}</dt>
            <dd>{dataset.license}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}
