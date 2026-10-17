import type { CountryRef, MountainCountrySummary, MountainsResponse } from '@bla/shared';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation } from '../../lib/units';
import type { Resource } from '../../lib/useResource';
import { CountryPeaks } from './CountryPeaks';
import styles from './HarimCards.module.css';

const text = strings.harim;

export interface SummaryCardsProps {
  rows: readonly MountainCountrySummary[];
  expanded: ReadonlySet<string>;
  onToggle: (iso3: string) => void;
  catalogue: Resource<MountainsResponse>;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
}

/**
 * By country on phones (< 720px): stacked cards instead of a squeezed table. Each card names the
 * highest peak and expands to the country's mountains, lowest point and relief.
 */
export function SummaryCards({
  rows,
  expanded,
  onToggle,
  catalogue,
  countries,
  unit,
  onOpenPeak,
}: SummaryCardsProps) {
  return (
    <ul className={styles.list} data-testid="harim-summary-cards">
      {rows.map((row) => {
        const { country, highestPeak } = row;
        const open = expanded.has(country.iso3);
        const panelId = `harim-card-${country.iso3}`;
        return (
          <li
            key={country.iso3}
            className={cx('glass', styles.card)}
            style={{ '--accent': `var(--region-${country.region.slug})` }}
            data-iso3={country.iso3}
          >
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              {...(open ? { 'aria-controls': panelId } : {})}
              data-testid="harim-country-toggle"
              onClick={() => {
                onToggle(country.iso3);
              }}
            >
              <FlagImage flag={country.flag} countryName={country.name} width={40} decorative />
              <span className={styles.titles}>
                <span className={styles.titleLine}>
                  <span className={styles.name}>{country.name}</span>
                  <RegionChip slug={country.region.slug} name={country.region.name} />
                </span>
                <span className={styles.subline}>
                  {highestPeak ? (
                    <>
                      {highestPeak.name}{' '}
                      <strong className={styles.figure} data-metres={highestPeak.elevationM}>
                        {formatElevation(highestPeak.elevationM, unit)}
                      </strong>
                    </>
                  ) : (
                    text.noHighPoint
                  )}
                  <span aria-hidden="true"> · </span>
                  <span>{text.mountainCount(row.peakCount)}</span>
                </span>
              </span>
              <Icon
                name="keyboard_arrow_down"
                className={cx(styles.chevron, open && styles.chevronOpen)}
              />
            </button>
            {open && (
              <div id={panelId}>
                <CountryPeaks
                  row={row}
                  catalogue={catalogue}
                  countries={countries}
                  unit={unit}
                  showLowPoint
                  onOpenPeak={onOpenPeak}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SummaryCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className={styles.list} aria-hidden="true" data-testid="harim-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={cx('glass', styles.card, styles.skeletonCard)}>
          <span className={cx('skeleton', styles.skeletonFlag)} />
          <span className={cx('skeleton', styles.skeletonText)} />
        </li>
      ))}
    </ul>
  );
}
