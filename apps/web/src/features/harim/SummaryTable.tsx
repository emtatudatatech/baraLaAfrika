import type { CountryRef, MountainCountrySummary, MountainsResponse } from '@bla/shared';
import { Fragment, type MouseEvent } from 'react';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import type { Unit } from '../../lib/units';
import type { Resource } from '../../lib/useResource';
import { CountryPeaks } from './CountryPeaks';
import type { CountrySort } from './harimQuery';
import { HeightBar, Height, SharedBadge } from './PeakBits';
import { countryNames } from './peakFormat';
import styles from './HarimTable.module.css';
import type { PeakLinks } from './peakLinks';

const text = strings.harim;

type SortColumn = 'name' | 'height' | 'peaks' | 'relief';

export interface SummaryTableProps {
  rows: readonly MountainCountrySummary[];
  /** Tallest highest peak of all 54 countries: the full length of the height bars. */
  maxHeight: number;
  sort: CountrySort;
  onSort: (column: SortColumn) => void;
  expanded: ReadonlySet<string>;
  onToggle: (iso3: string) => void;
  showLowColumns: boolean;
  catalogue: Resource<MountainsResponse>;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
  links: PeakLinks;
}

function ariaSort(sort: CountrySort, column: SortColumn) {
  if (column === 'height') {
    if (sort === 'height') return 'descending';
    if (sort === '-height') return 'ascending';
    return undefined;
  }
  if (sort !== column) return undefined;
  return column === 'name' ? 'ascending' : 'descending';
}

/** Row clicks toggle the row, except clicks on its own controls (buttons and links). */
function togglesRow(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as Element;
  return event.currentTarget.contains(target) && target.closest('button, a') === null;
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
  sort: CountrySort;
  onSort: (column: SortColumn) => void;
  className?: string | undefined;
}) {
  const direction = ariaSort(sort, column);
  return (
    <th scope="col" className={className} aria-sort={direction}>
      <button
        type="button"
        className={cx(styles.sortButton, direction && styles.sortActive)}
        onClick={() => {
          onSort(column);
        }}
      >
        {label}
        <Icon
          name="arrow_downward"
          size={18}
          className={cx(styles.sortIcon, direction === 'ascending' && styles.sortAsc)}
        />
      </button>
    </th>
  );
}

/**
 * By country (≥ 720px): one row per country, highest peak first, its region chip under its
 * name. Each row expands to that country's mountains. The lowest point and relief columns can be
 * hidden (they are below 1280px by default, and always below 1024px), in which case they move
 * into the expanded row.
 */
export function SummaryTable({
  rows,
  maxHeight,
  sort,
  onSort,
  expanded,
  onToggle,
  showLowColumns,
  catalogue,
  countries,
  unit,
  onOpenPeak,
  links,
}: SummaryTableProps) {
  const columnCount = showLowColumns ? 8 : 6;
  return (
    <table className={styles.table} data-testid="harim-summary-table">
      <caption className="visually-hidden">{text.summaryCaption}</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.flagCol}>
            <span className="visually-hidden">{text.columns.flag}</span>
          </th>
          <SortHeader column="name" label={text.columns.country} sort={sort} onSort={onSort} />
          <th scope="col">{text.columns.highestPeak}</th>
          <SortHeader
            column="height"
            label={text.columns.height}
            sort={sort}
            onSort={onSort}
            className={styles.heightCol}
          />
          <SortHeader
            column="peaks"
            label={text.columns.peaks}
            sort={sort}
            onSort={onSort}
            className={styles.numberCol}
          />
          <th scope="col">{text.columns.ranges}</th>
          {showLowColumns && (
            <>
              <th scope="col">{text.columns.lowestPoint}</th>
              <SortHeader
                column="relief"
                label={text.columns.relief}
                sort={sort}
                onSort={onSort}
                className={styles.numberCol}
              />
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { country, highestPeak } = row;
          const open = expanded.has(country.iso3);
          const panelId = `harim-country-${country.iso3}`;
          return (
            <Fragment key={country.iso3}>
              <tr
                className={cx(styles.row, open && styles.rowOpen)}
                style={{ '--accent': `var(--region-${country.region.slug})` }}
                data-iso3={country.iso3}
                onClick={(event) => {
                  if (togglesRow(event)) onToggle(country.iso3);
                }}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'touch') links.onHover(highestPeak?.slug ?? null);
                }}
                onPointerLeave={() => {
                  links.onHover(null);
                }}
              >
                <td className={styles.flagCell}>
                  <FlagImage flag={country.flag} countryName={country.name} width={40} decorative />
                </td>
                <th scope="row" className={styles.nameCell}>
                  <button
                    type="button"
                    className={styles.expandButton}
                    aria-expanded={open}
                    {...(open ? { 'aria-controls': panelId } : {})}
                    data-testid="harim-country-toggle"
                    onClick={() => {
                      onToggle(country.iso3);
                    }}
                  >
                    <Icon
                      name="keyboard_arrow_down"
                      size={20}
                      className={cx(styles.chevron, open && styles.chevronOpen)}
                    />
                    <span>{country.name}</span>
                  </button>
                  <RegionChip
                    slug={country.region.slug}
                    name={country.region.name}
                    className={styles.regionChip}
                  />
                </th>
                <td>
                  {highestPeak ? (
                    <span className={styles.stack}>
                      <button
                        type="button"
                        className={styles.linkButton}
                        aria-haspopup="dialog"
                        onClick={() => {
                          onOpenPeak(highestPeak.slug);
                        }}
                      >
                        {highestPeak.name}
                      </button>
                      {highestPeak.summitName !== null && (
                        <span className={styles.muted}>{highestPeak.summitName}</span>
                      )}
                      <SharedBadge names={countryNames(highestPeak.sharedWith, countries)} />
                    </span>
                  ) : (
                    <span className={styles.muted}>{text.noHighPoint}</span>
                  )}
                </td>
                <td className={styles.heightCell}>
                  {highestPeak && (
                    <>
                      <Height metres={highestPeak.elevationM} unit={unit} />
                      <HeightBar metres={highestPeak.elevationM} max={maxHeight} />
                    </>
                  )}
                </td>
                <td className={styles.numberCell}>{row.peakCount}</td>
                <td className={styles.ranges}>
                  {row.ranges.length > 0 ? (
                    row.ranges.join(', ')
                  ) : (
                    <span className={styles.muted}>{text.noRanges}</span>
                  )}
                </td>
                {showLowColumns && (
                  <>
                    <td className={styles.lowCell}>
                      {row.lowestPoint ? (
                        <span className={styles.stack}>
                          <span>{row.lowestPoint.name}</span>
                          <Height metres={row.lowestPoint.elevationM} unit={unit} />
                        </span>
                      ) : (
                        text.unknown
                      )}
                    </td>
                    <td className={styles.numberCell}>
                      {row.reliefM !== null ? (
                        <Height metres={row.reliefM} unit={unit} />
                      ) : (
                        text.unknown
                      )}
                    </td>
                  </>
                )}
              </tr>
              {open && (
                <tr
                  id={panelId}
                  className={styles.detailRow}
                  style={{ '--accent': `var(--region-${country.region.slug})` }}
                >
                  <td colSpan={columnCount}>
                    <CountryPeaks
                      row={row}
                      catalogue={catalogue}
                      countries={countries}
                      unit={unit}
                      showLowPoint={!showLowColumns}
                      onOpenPeak={onOpenPeak}
                      links={links}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function SummaryTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className={styles.table} aria-hidden="true" data-testid="harim-skeleton">
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr key={index} className={styles.skeletonRow}>
            <td className={styles.flagCell}>
              <span className={cx('skeleton', styles.skeletonFlag)} />
            </td>
            {Array.from({ length: 4 }, (_, cell) => (
              <td key={cell}>
                <span className={cx('skeleton', styles.skeletonText)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
