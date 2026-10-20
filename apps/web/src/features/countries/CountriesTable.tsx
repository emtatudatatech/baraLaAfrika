import type { CountrySummary } from '@bla/shared';
import type { MouseEvent } from 'react';

import { AnimalStatusBadge } from '../../components/AnimalStatusBadge/AnimalStatusBadge';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './CountriesTable.module.css';
import type { SortKey, SortState } from './countryQuery';
import { FlagCell } from './FlagCell';

export interface CountriesTableProps {
  countries: readonly CountrySummary[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  onOpen: (iso3: string) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: strings.countries.columns.name },
  { key: 'region', label: strings.countries.columns.region },
  { key: 'etymology', label: strings.countries.columns.etymology },
  { key: 'symbol', label: strings.countries.columns.symbol },
  { key: 'animal', label: strings.countries.columns.animal },
];

const COLUMN_CLASS: Partial<Record<SortKey, string | undefined>> = {
  name: styles.colName,
  region: styles.colRegion,
};

/**
 * Clicks on a row open its drawer, except clicks on its own controls (flag, name button) and
 * clicks inside portalled content such as the flag tooltip (React bubbles those through the row).
 */
function opensDrawer(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as Element;
  return event.currentTarget.contains(target) && target.closest('button, a') === null;
}

/**
 * Desktop/tablet table (≥ 720px). The header sticks below the ribbon. Every column but the flag
 * sorts; the country name is the keyboard entry point to the drawer (the whole row is a larger
 * pointer target for the same action).
 */
export function CountriesTable({ countries, sort, onSort, onOpen }: CountriesTableProps) {
  return (
    <table className={styles.table} data-testid="countries-table">
      <caption className="visually-hidden">{strings.countries.caption}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.flagCol}>
            {strings.countries.columns.flag}
          </th>
          {COLUMNS.map((column) => {
            const active = sort.key === column.key;
            return (
              <th
                key={column.key}
                scope="col"
                className={COLUMN_CLASS[column.key]}
                aria-sort={
                  active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                <button
                  type="button"
                  className={cx(styles.sortButton, active && styles.sortActive)}
                  onClick={() => {
                    onSort(column.key);
                  }}
                >
                  {column.label}
                  <Icon
                    name="arrow_downward"
                    size={18}
                    className={cx(
                      styles.sortIcon,
                      active && sort.direction === 'asc' && styles.sortAsc,
                    )}
                  />
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {countries.map((country) => (
          <tr
            key={country.iso3}
            className={styles.row}
            style={{ '--accent': `var(--region-${country.region.slug})` }}
            data-iso3={country.iso3}
            onClick={(event) => {
              if (opensDrawer(event)) onOpen(country.iso3);
            }}
          >
            <td className={styles.flagCell}>
              <FlagCell country={country} width={48} />
            </td>
            <th scope="row" className={styles.nameCell}>
              <button
                type="button"
                className={styles.nameButton}
                aria-haspopup="dialog"
                data-testid="country-name"
                onClick={() => {
                  onOpen(country.iso3);
                }}
              >
                {country.name}
              </button>
            </th>
            <td>
              <RegionChip slug={country.region.slug} name={country.region.name} />
            </td>
            <td>{country.etymologySummary}</td>
            <td>{country.nationalSymbolSummary}</td>
            <td>
              <span className={styles.animal}>
                {country.nationalAnimalName}
                {country.animalStatus !== 'official' && (
                  <AnimalStatusBadge status={country.animalStatus} />
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Placeholder rows while the countries load (same structure, so nothing jumps). */
export function CountriesTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className={styles.table} aria-hidden="true" data-testid="countries-skeleton">
      <thead>
        <tr>
          <th className={styles.flagCol} />
          {COLUMNS.map((column) => (
            <th key={column.key} className={COLUMN_CLASS[column.key]}>
              <span className={styles.sortButton}>{column.label}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr key={index} className={styles.skeletonRow}>
            <td className={styles.flagCell}>
              <span className={cx('skeleton', styles.skeletonFlag)} />
            </td>
            {COLUMNS.map((column) => (
              <td key={column.key}>
                <span className={cx('skeleton', styles.skeletonText)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
