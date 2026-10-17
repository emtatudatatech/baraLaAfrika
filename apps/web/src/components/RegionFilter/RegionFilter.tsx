import type { RegionSlug } from '@bla/shared';

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

/** Region chips in the region colours, plus "All". One region at a time (pressed buttons). */
export function RegionFilter({ options, total, value, onChange }: RegionFilterProps) {
  const chips: { slug: RegionSlug | null; name: string; count: number }[] = [
    { slug: null, name: strings.countries.allRegions, count: total },
    ...options,
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
            <span className={styles.count}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
