import type { CountryRef, MountainCountrySummary, MountainsResponse } from '@bla/shared';
import { Link } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { IconButton } from '../../components/IconButton/IconButton';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import type { Unit } from '../../lib/units';
import type { Resource } from '../../lib/useResource';
import styles from './CountryPeaks.module.css';
import type { PeakLinks } from './peakLinks';
import { mountainsOf } from './harimQuery';
import { ConfidenceBadge, HighPointBadge, Height, SharedBadge } from './PeakBits';
import { countryNames, peakTypeLabel } from './peakFormat';

const text = strings.harim;

export interface CountryPeaksProps {
  row: MountainCountrySummary;
  catalogue: Resource<MountainsResponse>;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  /** Show the lowest point and relief (when their table columns are hidden, and on phones). */
  showLowPoint: boolean;
  onOpenPeak: (slug: string) => void;
  links: PeakLinks;
}

/**
 * An expanded country: its mountains, highest first, each with its height in both units, range,
 * type, volcanic status, confidence and shared-border badge. A massif counts as one mountain;
 * its summits are listed beneath it.
 */
export function CountryPeaks({
  row,
  catalogue,
  countries,
  unit,
  showLowPoint,
  onOpenPeak,
  links,
}: CountryPeaksProps) {
  const { country } = row;
  const mountains =
    catalogue.status === 'success' ? mountainsOf(catalogue.data.mountains, country.iso3) : [];

  return (
    <div className={styles.panel} data-testid="country-peaks">
      {showLowPoint && (
        <dl className={styles.facts}>
          <div>
            <dt>{text.columns.lowestPoint}</dt>
            <dd>
              {row.lowestPoint ? (
                <>
                  {row.lowestPoint.name}{' '}
                  <Height metres={row.lowestPoint.elevationM} unit={unit} both />
                </>
              ) : (
                text.unknown
              )}
            </dd>
          </div>
          <div>
            <dt>{text.columns.relief}</dt>
            <dd>
              {row.reliefM !== null ? (
                <Height metres={row.reliefM} unit={unit} both />
              ) : (
                text.unknown
              )}
            </dd>
          </div>
        </dl>
      )}

      {catalogue.status === 'loading' && (
        <span className={styles.loading} role="status">
          <span className={cx('skeleton', styles.skeleton)} aria-hidden="true" />
          <span className="visually-hidden">{text.peaksLoading}</span>
        </span>
      )}

      {catalogue.status === 'error' && (
        <div className={styles.error} role="alert">
          <Icon name="error" size={20} />
          <span>{text.loadError}</span>
          <button type="button" className={styles.retry} onClick={catalogue.retry}>
            {text.retry}
          </button>
          <DevApiHint error={catalogue.error} />
        </div>
      )}

      {catalogue.status === 'success' &&
        (mountains.length === 0 ? (
          <p className={styles.muted}>{text.noMountains}</p>
        ) : (
          <ul className={styles.peaks} aria-label={text.mountainsOf(country.name)}>
            {mountains.map((mountain) => (
              <li
                key={mountain.slug}
                className={cx(styles.peak, links.selected === mountain.slug && styles.selected)}
                data-slug={mountain.slug}
                data-selected={links.selected === mountain.slug || undefined}
                data-testid="country-peak"
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'touch') links.onHover(mountain.slug);
                }}
                onPointerLeave={() => {
                  links.onHover(null);
                }}
              >
                <div className={styles.peakHead}>
                  <button
                    type="button"
                    className={styles.peakName}
                    aria-haspopup="dialog"
                    onClick={() => {
                      onOpenPeak(mountain.slug);
                    }}
                  >
                    {mountain.name}
                  </button>
                  <Height metres={mountain.elevationM} unit={unit} both />
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
                </div>
                <p className={styles.meta}>
                  {mountain.range && (
                    <span>
                      <span className="visually-hidden">{text.columns.range}: </span>
                      {mountain.range.name}
                    </span>
                  )}
                  <span>{peakTypeLabel(mountain)}</span>
                  <ConfidenceBadge confidence={mountain.confidence} />
                  {mountain.highPointOf.includes(country.iso3) && <HighPointBadge />}
                  <SharedBadge
                    names={countryNames(
                      mountain.countries.filter((iso3) => iso3 !== country.iso3),
                      countries,
                    )}
                  />
                </p>
                {mountain.summits.length > 0 && (
                  <ul className={styles.summits} aria-label={text.summitsOf(mountain.name)}>
                    {mountain.summits.map((summit) => (
                      <li key={summit.slug} className={styles.summit}>
                        <button
                          type="button"
                          className={styles.summitName}
                          aria-haspopup="dialog"
                          onClick={() => {
                            onOpenPeak(summit.slug);
                          }}
                        >
                          {summit.name}
                        </button>
                        <Height metres={summit.elevationM} unit={unit} both />
                        {summit.confidence !== 'high' && (
                          <ConfidenceBadge confidence={summit.confidence} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ))}

      <div className={styles.actions}>
        <Link className={styles.profile} to={`/countries?country=${country.iso3}`}>
          <Icon name="flag" size={18} />
          {text.countryProfile}
          <span className="visually-hidden">: {country.name}</span>
        </Link>
        {mountains.length > 0 && (
          <button
            type="button"
            className={styles.profile}
            data-testid="show-country-on-map"
            onClick={() => {
              links.onShowCountryOnMap(country.iso3);
            }}
          >
            <Icon name="location_on" size={18} />
            {strings.harim.map.showCountryOnMap}
            <span className="visually-hidden">: {country.name}</span>
          </button>
        )}
      </div>
    </div>
  );
}
