import type { GoldCountry } from '@bla/shared';
import { useId, useMemo, useState } from 'react';

import { Icon } from '../../../components/Icon/Icon';
import { formatPct, formatUsd } from '../../../lib/goldUnits';
import { strings } from '../../../lib/strings';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import styles from './GoldCharts.module.css';
import { RankBars } from './RankBars';

const text = strings.dhahabu.charts.dependence;
const TOP = 15;

/**
 * "Gold dependence" (spec 7.6 item 5, optional): gold's share of each country's reported
 * merchandise exports, both parts from the same year, for the countries with both figures.
 */
export function DependenceChart({
  rows,
  scopeName,
  onOpen,
}: {
  rows: readonly GoldCountry[];
  scopeName: string | null;
  onOpen: (iso3: string) => void;
}) {
  const titleId = useId();
  const [all, setAll] = useState(false);
  const shares = useMemo(
    () =>
      rows
        .flatMap((row) =>
          row.exportShare?.pct == null
            ? []
            : [{ row, share: row.exportShare, pct: row.exportShare.pct }],
        )
        .sort((a, b) => b.pct - a.pct || a.row.country.name.localeCompare(b.row.country.name)),
    [rows],
  );
  const shown = all ? shares : shares.slice(0, TOP);

  return (
    <section
      className={chartStyles.section}
      aria-labelledby={titleId}
      data-testid="gold-dependence-chart"
    >
      <div className={chartStyles.head}>
        <h3 id={titleId} className={chartStyles.title}>
          <Icon name="local_shipping" size={24} />
          {text.title}
        </h3>
      </div>
      {shares.length === 0 ? (
        <p className={styles.empty}>{strings.dhahabu.charts.noData}</p>
      ) : (
        <>
          <p className={styles.subtitle}>
            {text.subtitle}
            {scopeName !== null && ` · ${scopeName}`}
          </p>
          <RankBars
            bars={shown.map(({ row, share, pct }) => ({
              iso3: row.country.iso3,
              name: row.country.name,
              region: row.country.region.slug,
              value: pct,
              label: formatPct(pct),
              detail: (
                <>
                  <span className={chartStyles.figure}>
                    {formatPct(pct)} ({share.year})
                  </span>
                  <span>
                    {formatUsd(share.goldUsd)} / {formatUsd(share.totalUsd)}
                  </span>
                </>
              ),
            }))}
            testId="gold-dependence"
            description={text.description(shares.length)}
            tickLabel={(tick, last) => `${String(tick)}${last ? '%' : ''}`}
            onOpen={onOpen}
          />
          {shares.length > TOP && (
            <button
              type="button"
              className={styles.more}
              aria-expanded={all}
              onClick={() => {
                setAll((value) => !value);
              }}
            >
              {all ? text.showTop(TOP) : text.showAll(shares.length)}
            </button>
          )}
          <details className={chartStyles.tableView}>
            <summary>{strings.dhahabu.charts.tableToggle}</summary>
            <table className={chartStyles.table} data-testid="gold-dependence-table">
              <caption className="visually-hidden">{text.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{text.columns.country}</th>
                  <th scope="col" className={chartStyles.number}>
                    {text.columns.share}
                  </th>
                  <th scope="col" className={chartStyles.number}>
                    {text.columns.year}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shares.map(({ row, share, pct }) => (
                  <tr key={row.country.iso3}>
                    <th scope="row">{row.country.name}</th>
                    <td className={chartStyles.number}>{formatPct(pct)}</td>
                    <td className={chartStyles.number}>{share.year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
