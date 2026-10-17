import type { CountryRef, Mountain } from '@bla/shared';

import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation } from '../../lib/units';
import type { PeakSort } from './harimQuery';
import styles from './HarimTable.module.css';
import { IconButton } from '../../components/IconButton/IconButton';
import type { PeakLinks } from './peakLinks';
import { ConfidenceBadge, CountryList, Height, UltraBadge } from './PeakBits';
import { isUltra, peakTypeLabel } from './peakFormat';

const text = strings.harim;

type SortColumn = 'name' | 'height' | 'prominence';

export interface PeaksTableProps {
  mountains: readonly Mountain[];
  sort: PeakSort;
  onSort: (sort: PeakSort) => void;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
  links: PeakLinks;
}

function ariaSort(sort: PeakSort, column: SortColumn) {
  if (column === 'height') {
    if (sort === 'height') return 'descending';
    if (sort === '-height') return 'ascending';
    return undefined;
  }
  if (sort !== column) return undefined;
  return column === 'name' ? 'ascending' : 'descending';
}

function nextSort(current: PeakSort, column: SortColumn): PeakSort {
  if (column === 'height') return current === 'height' ? '-height' : 'height';
  return column;
}

/**
 * All peaks (≥ 720px): a flat list of the catalogue, sortable by name, height or prominence.
 * Unknown prominence shows "—" and sorts last. A massif is one row (its summits are in its
 * drawer); peaks on a border list every country.
 */
export function PeaksTable({
  mountains,
  sort,
  onSort,
  countries,
  unit,
  onOpenPeak,
  links,
}: PeaksTableProps) {
  const header = (column: SortColumn, label: string, className?: string) => {
    const direction = ariaSort(sort, column);
    return (
      <th scope="col" className={className} aria-sort={direction}>
        <button
          type="button"
          className={cx(styles.sortButton, direction && styles.sortActive)}
          onClick={() => {
            onSort(nextSort(sort, column));
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
  };
  return (
    <table className={styles.table} data-testid="harim-peaks-table">
      <caption className="visually-hidden">{text.peaksCaption}</caption>
      <thead>
        <tr>
          {header('name', text.columns.name)}
          {header('height', text.columns.height, styles.numberCol)}
          {header('prominence', text.columns.prominence, styles.numberCol)}
          <th scope="col">{text.columns.countries}</th>
          <th scope="col">{text.columns.range}</th>
          <th scope="col">{text.columns.type}</th>
        </tr>
      </thead>
      <tbody>
        {mountains.map((mountain) => (
          <tr
            key={mountain.slug}
            data-slug={mountain.slug}
            data-selected={links.selected === mountain.slug || undefined}
            className={cx(links.selected === mountain.slug && styles.selectedRow)}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch') links.onHover(mountain.slug);
            }}
            onPointerLeave={() => {
              links.onHover(null);
            }}
          >
            <th scope="row" className={styles.nameCell}>
              <IconButton
                icon="location_on"
                label={strings.harim.map.showOnMap(mountain.name)}
                iconSize={20}
                className={styles.mapButton}
                data-testid="show-on-map"
                onClick={() => {
                  links.onShowOnMap(mountain.slug);
                }}
              />
              <button
                type="button"
                className={styles.linkButton}
                aria-haspopup="dialog"
                data-testid="peak-name"
                onClick={() => {
                  onOpenPeak(mountain.slug);
                }}
              >
                {mountain.name}
              </button>
              {mountain.summits.length > 0 && (
                <span className={cx(styles.muted, styles.summitsNote)}>
                  {mountain.summits.map((summit) => summit.name).join(', ')}
                </span>
              )}
            </th>
            <td className={styles.numberCell}>
              <span className={styles.stack} data-align="end">
                <Height metres={mountain.elevationM} unit={unit} />
                {mountain.confidence !== 'high' && (
                  <ConfidenceBadge confidence={mountain.confidence} />
                )}
              </span>
            </td>
            <td className={styles.numberCell} data-testid="peak-prominence">
              {mountain.prominenceM === null ? (
                <span className={styles.muted}>
                  <span aria-hidden="true">{text.unknown}</span>
                  <span className="visually-hidden">{text.unknownProminence}</span>
                </span>
              ) : (
                <span className={styles.stack} data-align="end">
                  {formatElevation(mountain.prominenceM, unit)}
                  {isUltra(mountain.prominenceM) && <UltraBadge />}
                </span>
              )}
            </td>
            <td>
              <CountryList iso3s={mountain.countries} countries={countries} />
            </td>
            <td>{mountain.range?.name ?? <span className={styles.muted}>{text.unknown}</span>}</td>
            <td>{peakTypeLabel(mountain)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
