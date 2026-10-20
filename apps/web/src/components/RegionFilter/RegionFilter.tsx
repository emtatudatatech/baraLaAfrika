import { REGION_NAMES, REGION_SLUGS, type RegionSlug } from '@bla/shared';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './RegionFilter.module.css';

export interface RegionOption {
  slug: RegionSlug;
  name: string;
  count: number;
}

export interface RegionFilterProps {
  options: readonly RegionOption[];
  total: number;
  value: RegionSlug | null;
  onChange: (region: RegionSlug | null) => void;
}

/**
 * Region chips in the region colours, plus "All". One region at a time (pressed buttons). Until
 * the page's rows arrive (no options yet), the five regions show with their counts pending, so
 * the row keeps its size and nothing below it moves (the prerendered page shows the same).
 */
export function RegionFilter({ options, total, value, onChange }: RegionFilterProps) {
  const pending = options.length === 0;
  const shown: { slug: RegionSlug; name: string; count: number | null }[] = pending
    ? REGION_SLUGS.map((slug) => ({ slug, name: REGION_NAMES[slug], count: null }))
    : [...options];
  const chips: { slug: RegionSlug | null; name: string; count: number | null }[] = [
    { slug: null, name: strings.countries.allRegions, count: pending ? null : total },
    ...shown,
  ];
  return (
    <div role="group" aria-label={strings.countries.regionGroup} className={styles.chips}>
      {chips.map((chip) => {
        const pressed = chip.slug === value;
        return (
          <button
            key={chip.slug ?? 'all'}
            type="button"
            className={cx(styles.chip, pressed && styles.pressed)}
            style={chip.slug === null ? undefined : { '--swatch': `var(--region-${chip.slug})` }}
            aria-pressed={pressed}
            data-region={chip.slug ?? 'all'}
            onClick={() => {
              onChange(chip.slug);
            }}
          >
            {chip.slug !== null && <span className={styles.swatch} aria-hidden="true" />}
            <span>{chip.name}</span>
            {chip.count === null ? (
              <span className={cx('skeleton', styles.countPending)} aria-hidden="true" />
            ) : (
              <span className={styles.count}>{chip.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
