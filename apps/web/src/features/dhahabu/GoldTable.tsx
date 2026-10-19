import type { GoldCountry, GoldSort, GoldUnit } from '@bla/shared';
import { useState } from 'react';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import tableStyles from '../harim/HarimTable.module.css';
import {
  ExportsFigure,
  HoldingsFigure,
  PresenceBadge,
  ProductionFigure,
  ShareFigure,
} from './GoldBits';
import styles from './GoldTable.module.css';

const text = strings.dhahabu;

type SortColumn = Exclude<GoldSort, `-${string}`>;

function ariaSort(sort: GoldSort, column: SortColumn): 'ascending' | 'descending' | undefined {
  if (sort === column) return column === 'name' ? 'ascending' : 'descending';
  if (sort === `-${column}`) return column === 'name' ? 'descending' : 'ascending';
  return undefined;
}

function SortHeader({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: SortColumn;
  label: string;
  sort: GoldSort;
  onSort: (column: SortColumn) => void;
  className?: string;
}) {
  const direction = ariaSort(sort, column);
  return (
    <th scope="col" className={className} aria-sort={direction}>
      <button
        type="button"
        className={cx(tableStyles.sortButton, direction && tableStyles.sortActive)}
        data-testid={`gold-sort-${column}`}
        onClick={() => {
          onSort(column);
        }}
      >
        {label}
        <Icon
          name="arrow_downward"
          size={18}
          className={cx(tableStyles.sortIcon, direction === 'ascending' && tableStyles.sortAsc)}
        />
      </button>
    </th>
  );
}

export interface GoldRowsProps {
  rows: readonly GoldCountry[];
  unit: GoldUnit;
  /** The country to highlight (from a statistics card or a link), if any. */
  highlighted: string | null;
}

/** The country table (≥ 1024px): one row per country, every figure with its own year or date. */
export function GoldTable({
  rows,
  unit,
  highlighted,
  sort,
  onSort,
}: GoldRowsProps & { sort: GoldSort; onSort: (column: SortColumn) => void }) {
  return (
    <table className={cx(tableStyles.table, styles.table)} data-testid="gold-table">
      <caption className="visually-hidden">{text.tableCaption}</caption>
      <thead>
        <tr>
          <th scope="col" className={tableStyles.flagCol}>
            <span className="visually-hidden">{text.columns.flag}</span>
          </th>
          <SortHeader column="name" label={text.columns.country} sort={sort} onSort={onSort} />
          <th scope="col">{text.columns.presence}</th>
          <SortHeader
            column="production"
            label={text.columns.production}
            sort={sort}
            onSort={onSort}
          />
          <SortHeader column="exports" label={text.columns.exports} sort={sort} onSort={onSort} />
          <SortHeader column="holdings" label={text.columns.holdings} sort={sort} onSort={onSort} />
          <SortHeader column="share" label={text.columns.share} sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.country.iso3}
            className={cx(styles.row, highlighted === row.country.iso3 && styles.highlighted)}
            style={{ '--accent': `var(--region-${row.country.region.slug})` }}
            data-iso3={row.country.iso3}
            data-testid="gold-row"
          >
            <td className={tableStyles.flagCell}>
              <FlagImage
                flag={row.country.flag}
                countryName={row.country.name}
                width={40}
                decorative
              />
            </td>
            <th scope="row" className={tableStyles.nameCell}>
              <span className={styles.name} tabIndex={-1} data-testid="gold-country-name">
                {row.country.name}
              </span>
              <RegionChip
                slug={row.country.region.slug}
                name={row.country.region.name}
                className={tableStyles.regionChip}
              />
            </th>
            <td>
              <PresenceBadge row={row} />
            </td>
            <td data-column="production">
              <ProductionFigure row={row} unit={unit} />
            </td>
            <td data-column="exports">
              <ExportsFigure row={row} unit={unit} />
            </td>
            <td data-column="holdings">
              <HoldingsFigure row={row} unit={unit} />
            </td>
            <td data-column="share">
              <ShareFigure row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Below 1024px: one card per country, the key figures first and the rest on request. */
export function GoldCards({ rows, unit, highlighted }: GoldRowsProps) {
  return (
    <ul className={styles.cards} data-testid="gold-cards">
      {rows.map((row) => (
        <GoldCard
          key={row.country.iso3}
          row={row}
          unit={unit}
          highlighted={highlighted === row.country.iso3}
        />
      ))}
    </ul>
  );
}

function GoldCard({
  row,
  unit,
  highlighted,
}: {
  row: GoldCountry;
  unit: GoldUnit;
  highlighted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `gold-card-${row.country.iso3}`;
  return (
    <li
      className={cx('glass', styles.card, highlighted && styles.highlighted)}
      style={{ '--accent': `var(--region-${row.country.region.slug})` }}
      data-iso3={row.country.iso3}
      data-testid="gold-row"
    >
      <div className={styles.cardHead}>
        <FlagImage flag={row.country.flag} countryName={row.country.name} width={40} decorative />
        <div className={styles.cardTitle}>
          <h3 className={styles.name} tabIndex={-1} data-testid="gold-country-name">
            {row.country.name}
          </h3>
          <RegionChip slug={row.country.region.slug} name={row.country.region.name} />
        </div>
        <PresenceBadge row={row} />
      </div>
      <dl className={styles.figures}>
        <div>
          <dt>{text.columns.production}</dt>
          <dd>
            <ProductionFigure row={row} unit={unit} />
          </dd>
        </div>
        <div>
          <dt>{text.columns.holdings}</dt>
          <dd>
            <HoldingsFigure row={row} unit={unit} />
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className={styles.more}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? text.fewerFigures : text.moreFigures}
        <Icon
          name="keyboard_arrow_down"
          size={20}
          className={cx(tableStyles.chevron, open && tableStyles.chevronOpen)}
        />
      </button>
      <dl id={panelId} className={styles.figures} hidden={!open}>
        <div>
          <dt>{text.columns.exports}</dt>
          <dd>
            <ExportsFigure row={row} unit={unit} />
          </dd>
        </div>
        <div>
          <dt>{text.columns.share}</dt>
          <dd>
            <ShareFigure row={row} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function GoldTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className={tableStyles.table} aria-hidden="true" data-testid="gold-skeleton">
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr key={index} className={tableStyles.skeletonRow}>
            <td className={tableStyles.flagCell}>
              <span className={cx('skeleton', tableStyles.skeletonFlag)} />
            </td>
            {Array.from({ length: 5 }, (_, cell) => (
              <td key={cell}>
                <span className={cx('skeleton', tableStyles.skeletonText)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
