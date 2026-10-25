import type { CountryRef, VinaraEntity, VinaraMetric } from '@bla/shared';
import { useId, useState } from 'react';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import tableStyles from '../harim/HarimTable.module.css';
import { METRIC_ICONS } from './metricIcons';
import { formatVinaraValue, formatWindow } from './vinaraFormat';
import styles from './VinaraTable.module.css';

const text = strings.vinara;

export interface VinaraTableProps {
  metrics: readonly VinaraMetric[];
  /** The states in scope (for "n of N ranked"). */
  total: number;
  /** "Africa" or the region's name, for the caption. */
  scopeName: string;
  countries: ReadonlyMap<string, CountryRef>;
  onOpen: (iso3: string) => void;
}

/** The signature table (wide screens): one row per measure. */
export function VinaraTable({ metrics, total, scopeName, countries, onOpen }: VinaraTableProps) {
  return (
    <table className={cx(tableStyles.table, styles.table)} data-testid="vinara-table">
      <caption className="visually-hidden">{text.table.caption(scopeName)}</caption>
      <thead>
        <tr>
          <th scope="col">{text.table.measure}</th>
          <th scope="col" className={styles.yearsCol}>
            {text.table.years}
          </th>
          <th scope="col">{text.table.cardinal}</th>
          <th scope="col">{text.table.contender}</th>
          <th scope="col" className={styles.signalCol}>
            {text.table.signal}
          </th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((metric) => (
          <tr key={metric.key} data-metric={metric.key} data-testid="vinara-row">
            <th scope="row" className={styles.measureCell}>
              <MeasureName metric={metric} total={total} />
            </th>
            <td className={styles.years}>{formatWindow(metric.window)}</td>
            <td>
              <Leaders
                metric={metric}
                entities={metric.cardinals}
                countries={countries}
                onOpen={onOpen}
              />
            </td>
            <td>
              <Leaders
                metric={metric}
                entities={metric.contenders}
                countries={countries}
                onOpen={onOpen}
              />
            </td>
            <td>
              <Signal metric={metric} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same, as one card per measure (phones and tablets). */
export function VinaraCards({
  metrics,
  total,
  countries,
  onOpen,
}: Omit<VinaraTableProps, 'scopeName'>) {
  return (
    <ul className={styles.cards} data-testid="vinara-cards">
      {metrics.map((metric) => (
        <li
          key={metric.key}
          className={cx('glass', styles.card)}
          data-metric={metric.key}
          data-testid="vinara-row"
        >
          <div className={styles.cardHead}>
            <MeasureName metric={metric} total={total} heading />
            <span className={styles.years}>{formatWindow(metric.window)}</span>
          </div>
          <dl className={styles.pair}>
            <div>
              <dt>{text.table.cardinal}</dt>
              <dd>
                <Leaders
                  metric={metric}
                  entities={metric.cardinals}
                  countries={countries}
                  onOpen={onOpen}
                />
              </dd>
            </div>
            <div>
              <dt>{text.table.contender}</dt>
              <dd>
                <Leaders
                  metric={metric}
                  entities={metric.contenders}
                  countries={countries}
                  onOpen={onOpen}
                />
              </dd>
            </div>
          </dl>
          <Signal metric={metric} />
        </li>
      ))}
    </ul>
  );
}

function MeasureName({
  metric,
  total,
  heading = false,
}: {
  metric: VinaraMetric;
  total: number;
  heading?: boolean;
}) {
  const tip = useTooltip({ content: metric.definition });
  const Name = heading ? 'h3' : 'span';
  return (
    <span className={styles.measure}>
      <span className={styles.measureIcon} aria-hidden="true">
        <Icon name={METRIC_ICONS[metric.key]} size={20} />
      </span>
      <span className={styles.measureText}>
        <Name className={styles.measureName}>{metric.name}</Name>
        <span className={styles.muted}>{text.table.ranked(metric.ranked, total)}</span>
      </span>
      <button
        {...tip.triggerProps}
        type="button"
        className={styles.info}
        aria-label={text.table.definitionFor(metric.name)}
        data-testid="vinara-definition"
      >
        <Icon name="info" size={20} />
      </button>
      {tip.tooltip}
    </span>
  );
}

/** The cardinal(s) or contender(s): every state in a tie, then the value they share. */
export function Leaders({
  metric,
  entities,
  countries,
  onOpen,
}: {
  metric: VinaraMetric;
  entities: readonly VinaraEntity[];
  countries: ReadonlyMap<string, CountryRef>;
  /** Opens the state's drawer. */
  onOpen: (iso3: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const [first] = entities;
  if (first === undefined) return <span className={styles.muted}>{text.table.none}</span>;
  const estimate = entities.some((e) => e.estimate);
  // A large tie (states sharing a currency, or currencies fixed to the same anchor) shows its
  // first names and the rest on request, so one cell never runs down the page.
  const long = entities.length > TIE_SHOWN + 1;
  const shown = long && !expanded ? entities.slice(0, TIE_SHOWN) : entities;
  return (
    <div className={styles.leaders} data-testid="vinara-leaders">
      {entities.length > 1 && <span className={styles.tie}>{text.table.tie(entities.length)}</span>}
      <ul id={listId} className={styles.names}>
        {shown.map((entity) => {
          const country = countries.get(entity.iso3);
          return (
            <li key={entity.iso3} data-iso3={entity.iso3}>
              {country ? (
                <FlagImage flag={country.flag} countryName={entity.name} width={24} decorative />
              ) : (
                <span className={styles.flagGap} aria-hidden="true" />
              )}
              <button
                type="button"
                className={styles.name}
                data-testid="vinara-state"
                onClick={() => {
                  onOpen(entity.iso3);
                }}
              >
                {entity.name}
              </button>
            </li>
          );
        })}
      </ul>
      {long && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={listId}
          data-testid="vinara-tie-toggle"
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          {expanded ? text.table.showFewer : text.table.showAll(entities.length)}
        </button>
      )}
      <span className={styles.value}>
        {formatVinaraValue(metric, first.value)}
        {metric.kind === 'level' && <span className={styles.year}> · {first.year}</span>}
      </span>
      {estimate && <span className={styles.badge}>{text.table.estimate}</span>}
    </div>
  );
}

/** How many states of a large tie show before "Show all". */
const TIE_SHOWN = 3;

const SIGNAL_ICONS = {
  gap_closing: 'compare_arrows',
  lead_holding: 'trending_flat',
  not_enough_data: 'remove',
  tie: 'remove',
} as const satisfies Record<string, IconName>;

export function Signal({ metric }: { metric: VinaraMetric }) {
  const key = metric.signal ?? 'tie';
  const tip = useTooltip({ content: text.signalHints[key] });
  const [contender] = metric.contenders;
  return (
    <div className={styles.signal}>
      <button
        {...tip.triggerProps}
        type="button"
        className={cx(styles.signalChip, key === 'gap_closing' && styles.closing)}
        data-signal={key}
        data-testid="vinara-signal"
      >
        <Icon name={SIGNAL_ICONS[key]} size={18} />
        {text.signals[key]}
      </button>
      {tip.tooltip}
      {metric.contenderLeadsLatest && contender !== undefined && (
        <span className={styles.ahead} data-testid="vinara-ahead">
          {text.contenderAhead(contender.name, metric.window.to)}
        </span>
      )}
    </div>
  );
}
