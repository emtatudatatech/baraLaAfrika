import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './DataRibbon.module.css';
import { useRouteData } from './routeData';
import { useTimeRange } from './timeRangeContext';

/**
 * Persistent strip showing the datasets (and, once the coverage API is wired, their "as of"
 * dates) behind the current view, plus the shared date-range control. The control is read-only
 * on pages whose data is not time-dependent.
 */
export function DataRibbon() {
  const { datasets, timeDependent } = useRouteData();
  const { interactive } = useTimeRange();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const rangeTip = useTooltip({ content: strings.ribbon.notTimeDependentHint, placement: 'bottom' });

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

  const kind = timeDependent ? strings.ribbon.timeSeries : strings.ribbon.referenceData;
  const datasetNames = datasets.map((key) => strings.datasets[key]);

  return (
    <aside ref={ribbonRef} className={cx('glass', styles.ribbon)} aria-label={strings.ribbon.label}>
      <div className={styles.inner}>
        <div className={styles.summary}>
          <Icon name="date_range" size={20} className={styles.leadIcon} />
          <span className={styles.kind}>{kind}</span>
          {datasetNames.length > 0 && (
            <span className={styles.count} aria-hidden="true">
              {strings.ribbon.datasetCount(datasetNames.length)}
            </span>
          )}
          <ul className={styles.datasets}>
            {datasetNames.length === 0 ? (
              <li>{strings.ribbon.noDatasets}</li>
            ) : (
              datasetNames.map((name) => <li key={name}>{name}</li>)
            )}
          </ul>
        </div>

        {interactive ? null : (
          <>
            <button
              {...rangeTip.triggerProps}
              type="button"
              className={styles.rangeControl}
              aria-disabled="true"
              data-testid="ribbon-range"
            >
              <Icon name="lock" size={18} />
              <span>{strings.ribbon.notTimeDependent}</span>
            </button>
            {rangeTip.tooltip}
          </>
        )}

        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span className="visually-hidden">
            {expanded ? strings.ribbon.hideDetails : strings.ribbon.showDetails}
          </span>
          <Icon name="keyboard_arrow_down" size={20} className={cx(expanded && styles.rotated)} />
        </button>
      </div>

      <div id={detailsId} className={styles.details} hidden={!expanded}>
        <p className={styles.detailsKind}>{kind}</p>
        <ul>
          {datasetNames.length === 0 ? (
            <li>{strings.ribbon.noDatasets}</li>
          ) : (
            datasetNames.map((name) => <li key={name}>{name}</li>)
          )}
        </ul>
        {!interactive && <p>{strings.ribbon.notTimeDependentHint}.</p>}
      </div>
    </aside>
  );
}
