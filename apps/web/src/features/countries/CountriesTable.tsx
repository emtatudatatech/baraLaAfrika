import type { CountrySummary } from '@bla/shared';
import type { MouseEvent } from 'react';

import { AnimalStatusBadge } from '../../components/AnimalStatusBadge/AnimalStatusBadge';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './CountriesTable.module.css';
import { ElectionSummary, LeaderSummary } from './CountryFacts';
import { areaText, formatPopulation } from './factsFormat';
import { type SortKey, type SortState, type TableView, VIEW_SORT_KEYS } from './countryQuery';
import { FlagCell } from './FlagCell';

export interface CountriesTableProps {
  view: TableView;
  countries: readonly CountrySummary[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  onOpen: (iso3: string) => void;
}

function columns(view: TableView): { key: SortKey; label: string }[] {
  return VIEW_SORT_KEYS[view].map((key) => ({ key, label: strings.countries.columns[key] }));
}

const COLUMN_CLASS: Partial<Record<SortKey, string | undefined>> = {
  name: styles.colName,
  region: styles.colRegion,
  population: styles.colFigure,
  area: styles.colFigure,
};

/** The cells after the name and region: the symbols, or the country's facts. */
function ViewCells({ view, country }: { view: TableView; country: CountrySummary }) {
  if (view === 'symbols') {
    return (
      <>
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
      </>
    );
  }
  const { population, landAreaKm2 } = country.facts;
  return (
    <>
      <td className={styles.figure} data-testid="cell-population">
        {population === null ? (
          <span className={styles.muted}>{strings.facts.noData}</span>
        ) : (
          <>
            {formatPopulation(population.value)}
            <span className={styles.year}>{population.year}</span>
          </>
        )}
      </td>
      <td className={styles.figure} data-testid="cell-area">
        {landAreaKm2 === null ? (
          <span className={styles.muted}>{strings.facts.noData}</span>
        ) : (
          <>
            {areaText(landAreaKm2)}
            <span className={styles.year}>{landAreaKm2.year}</span>
          </>
        )}
      </td>
      <td data-testid="cell-leader">
        <LeaderSummary facts={country.facts} countryName={country.name} />
      </td>
      <td data-testid="cell-election">
        <ElectionSummary election={country.facts.election} />
      </td>
    </>
  );
}

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
export function CountriesTable({ view, countries, sort, onSort, onOpen }: CountriesTableProps) {
  return (
    <table className={styles.table} data-testid="countries-table" data-view={view}>
      <caption className="visually-hidden">
        {view === 'facts' ? strings.countries.factsCaption : strings.countries.caption}
      </caption>
      <thead>
        <tr>
          <th scope="col" className={styles.flagCol}>
            {strings.countries.columns.flag}
          </th>
          {columns(view).map((column) => {
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
            <ViewCells view={view} country={country} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Placeholder rows while the countries load (same structure, so nothing jumps). */
export function CountriesTableSkeleton({
  view = 'symbols',
  rows = 8,
}: {
  view?: TableView;
  rows?: number;
}) {
  return (
    <table className={styles.table} aria-hidden="true" data-testid="countries-skeleton">
      <thead>
        <tr>
          <th className={styles.flagCol} />
          {columns(view).map((column) => (
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
            {columns(view).map((column) => (
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
