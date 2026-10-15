import type { Region, RegionSlug } from '@bla/shared';
import { useId } from 'react';
import { Link } from 'react-router';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './MapLegend.module.css';

export interface MapLegendProps {
  regions: readonly Region[];
  selected: RegionSlug | null;
  onSelect: (slug: RegionSlug | null) => void;
}

/**
 * Region legend: swatch, name and country count. Selecting a region isolates it on the map
 * (selecting it again clears). A glass card over the map on larger screens, a horizontally
 * scrolling chip row on phones.
 */
export function MapLegend({ regions, selected, onSelect }: MapLegendProps) {
  const titleId = useId();
  return (
    <section className={cx('glass', styles.legend)} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {strings.legend.title}
      </h2>
      <ul className={styles.list}>
        {regions.map((region) => {
          const pressed = selected === region.slug;
          return (
            <li key={region.slug}>
              <button
                type="button"
                className={cx(styles.item, pressed && styles.pressed)}
                aria-pressed={pressed}
                onClick={() => {
                  onSelect(pressed ? null : region.slug);
                }}
                data-region={region.slug}
              >
                <span
                  className={styles.swatch}
                  style={{ '--swatch': `var(--region-${region.slug})` }}
                  aria-hidden="true"
                />
                <span className={styles.name}>{region.name}</span>
                <span className={styles.count}>
                  {strings.legend.countries(region.countryCount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className={styles.actions}>
          <Link className={styles.link} to={`/countries?region=${selected}`}>
            {strings.legend.viewInTable}
          </Link>
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              onSelect(null);
            }}
          >
            {strings.legend.showAll}
          </button>
        </div>
      ) : (
        <p className={styles.hint}>{strings.legend.hint}</p>
      )}
    </section>
  );
}
