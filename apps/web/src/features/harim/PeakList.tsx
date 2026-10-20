import type { CountryRef, Mountain } from '@bla/shared';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation } from '../../lib/units';
import styles from './HarimCards.module.css';
import { IconButton } from '../../components/IconButton/IconButton';
import type { PeakLinks } from './peakLinks';
import { ConfidenceBadge, CountryList, Height, UltraBadge } from './PeakBits';
import { isUltra, peakTypeLabel } from './peakFormat';

const text = strings.harim;

export interface PeakListProps {
  mountains: readonly Mountain[];
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
  testId?: string;
  /** false inside a panel that is already glass. */
  framed?: boolean;
  links?: PeakLinks;
}

/**
 * All peaks on phones, and the territory peaks everywhere: a compact divided list. A territory
 * peak shows its territory in place of countries.
 */
export function PeakList({
  mountains,
  countries,
  unit,
  onOpenPeak,
  testId = 'harim-peak-list',
  framed = true,
  links,
}: PeakListProps) {
  return (
    <ul className={cx(framed && 'glass', styles.peakList)} data-testid={testId}>
      {mountains.map((mountain) => (
        <li
          key={mountain.slug}
          className={cx(styles.peakItem, links?.selected === mountain.slug && styles.selectedItem)}
          data-slug={mountain.slug}
          data-selected={links?.selected === mountain.slug || undefined}
        >
          <div className={styles.peakHead}>
            <button
              type="button"
              className={styles.peakButton}
              aria-haspopup="dialog"
              data-testid="peak-name"
              onClick={() => {
                onOpenPeak(mountain.slug);
              }}
            >
              {mountain.name}
            </button>
            <span className={styles.headEnd}>
              <Height metres={mountain.elevationM} unit={unit} both />
              {links && (
                <IconButton
                  icon="location_on"
                  label={strings.harim.map.showOnMap(mountain.name)}
                  iconSize={20}
                  data-testid="show-on-map"
                  onClick={() => {
                    links.onShowOnMap(mountain.slug);
                  }}
                />
              )}
            </span>
          </div>
          <p className={styles.meta}>
            <CountryList
              iso3s={mountain.countries}
              countries={countries}
              territory={mountain.territory}
            />
            {mountain.range && <span>{mountain.range.name}</span>}
            <span>{peakTypeLabel(mountain)}</span>
          </p>
          <p className={styles.meta}>
            <span>
              {text.columns.prominence}:{' '}
              {mountain.prominenceM === null ? (
                <>
                  <span aria-hidden="true">{text.unknown}</span>
                  <span className="visually-hidden">{text.unknownProminence}</span>
                </>
              ) : (
                formatElevation(mountain.prominenceM, unit)
              )}
            </span>
            {isUltra(mountain.prominenceM) && <UltraBadge />}
            {mountain.confidence !== 'high' && <ConfidenceBadge confidence={mountain.confidence} />}
          </p>
        </li>
      ))}
    </ul>
  );
}
