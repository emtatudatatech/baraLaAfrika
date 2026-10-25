import type { VinaraMetric } from '@bla/shared';
import { useId, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import tableStyles from '../harim/HarimTable.module.css';
import { formatShare, formatVinaraValue, formatWindow } from './vinaraFormat';
import { RegionMultiples } from './charts/RegionMultiples';
import { METRIC_ICONS } from './metricIcons';
import styles from './VinaraPage.module.css';
import rowStyles from './VinaraTable.module.css';

const text = strings.vinara.regions;

type Regions = NonNullable<VinaraMetric['regions']>;

/**
 * Region against region (Africa only): for each measure, the leading region and the runner-up
 * (ties all named) and the regions shown as partial, which are not ranked.
 */
export function RegionComparison({
  metrics,
  wide,
}: {
  metrics: readonly VinaraMetric[];
  wide: boolean;
}) {
  const titleId = useId();
  const [view, setView] = useState<'charts' | 'table'>('charts');
  const rows = metrics.flatMap((metric) =>
    metric.regions === null ? [] : [{ metric, regions: metric.regions }],
  );
  if (rows.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid="vinara-regions">
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {text.title}
        </h2>
        <p className={styles.intro}>{text.intro}</p>
      </div>
      <SegmentedControl
        label={strings.vinara.multiples.viewLabel}
        options={[
          { value: 'charts', label: strings.vinara.multiples.charts, icon: 'bar_chart' },
          { value: 'table', label: strings.vinara.multiples.table, icon: 'table_view' },
        ]}
        value={view}
        onChange={setView}
        testId="vinara-regions-view"
      />
      {view === 'charts' ? (
        <>
          <p className={styles.intro}>{strings.vinara.multiples.key}</p>
          <RegionMultiples metrics={metrics} />
        </>
      ) : wide ? (
        <div className={cx('glass glass--strong', styles.panel)}>
          <table className={cx(tableStyles.table, rowStyles.table)}>
            <caption className="visually-hidden">{text.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{strings.vinara.table.measure}</th>
                <th scope="col">{strings.vinara.table.years}</th>
                <th scope="col">{text.leader}</th>
                <th scope="col">{text.runnerUp}</th>
                <th scope="col">{text.partial}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ metric, regions }) => (
                <tr key={metric.key} data-metric={metric.key} data-testid="vinara-region-row">
                  <th scope="row" className={rowStyles.measureCell}>
                    <span className={rowStyles.measure}>
                      <span className={rowStyles.measureIcon} aria-hidden="true">
                        <Icon name={METRIC_ICONS[metric.key]} size={20} />
                      </span>
                      <span className={rowStyles.measureName}>{metric.name}</span>
                    </span>
                  </th>
                  <td className={rowStyles.years}>{formatWindow(metric.window)}</td>
                  <td>
                    <RegionList metric={metric} list={regions.cardinals} />
                  </td>
                  <td>
                    <RegionList metric={metric} list={regions.contenders} />
                  </td>
                  <td>
                    <Partial regions={regions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className={rowStyles.cards}>
          {rows.map(({ metric, regions }) => (
            <li
              key={metric.key}
              className={cx('glass', rowStyles.card)}
              data-metric={metric.key}
              data-testid="vinara-region-row"
            >
              <div className={rowStyles.cardHead}>
                <span className={rowStyles.measure}>
                  <span className={rowStyles.measureIcon} aria-hidden="true">
                    <Icon name={METRIC_ICONS[metric.key]} size={20} />
                  </span>
                  <h3 className={rowStyles.measureName}>{metric.name}</h3>
                </span>
                <span className={rowStyles.years}>{formatWindow(metric.window)}</span>
              </div>
              <dl className={rowStyles.pair}>
                <div>
                  <dt>{text.leader}</dt>
                  <dd>
                    <RegionList metric={metric} list={regions.cardinals} />
                  </dd>
                </div>
                <div>
                  <dt>{text.runnerUp}</dt>
                  <dd>
                    <RegionList metric={metric} list={regions.contenders} />
                  </dd>
                </div>
              </dl>
              {regions.values.some((v) => v.partial) && (
                <p className={rowStyles.muted}>
                  {text.partial}: <Partial regions={regions} inline />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RegionList({ metric, list }: { metric: VinaraMetric; list: Regions['cardinals'] }) {
  const [first] = list;
  if (first === undefined) return <span className={rowStyles.muted}>{text.none}</span>;
  return (
    <div className={rowStyles.leaders}>
      {list.length > 1 && (
        <span className={rowStyles.tie}>{strings.vinara.table.tie(list.length)}</span>
      )}
      <span className={styles.chips}>
        {list.map((region) => (
          <RegionChip key={region.slug} slug={region.slug} name={region.name} />
        ))}
      </span>
      <span className={rowStyles.value}>{formatVinaraValue(metric, first.value)}</span>
    </div>
  );
}

function Partial({ regions, inline = false }: { regions: Regions; inline?: boolean }) {
  const partial = regions.values.filter((v) => v.partial);
  if (partial.length === 0) return <span className={rowStyles.muted}>{text.none}</span>;
  const items = partial.map((v) => `${v.name} (${text.covered(formatShare(v.coverage))})`);
  if (inline) return <>{items.join(', ')}</>;
  return (
    <ul className={styles.partialList}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
