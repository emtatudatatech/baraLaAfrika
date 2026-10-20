import type { RegionSlug } from '@bla/shared';

import { cx } from '../../lib/cx';
import styles from './RegionChip.module.css';

export interface RegionChipProps {
  slug: RegionSlug;
  name: string;
  className?: string | undefined;
}

/**
 * A region label with its identity colour as a swatch. The text stays in the ink colour, so it
 * is readable whatever the region colour (yellow included) and in both themes.
 */
export function RegionChip({ slug, name, className }: RegionChipProps) {
  return (
    <span className={cx(styles.chip, className)} style={{ '--swatch': `var(--region-${slug})` }}>
      <span className={styles.swatch} aria-hidden="true" />
      {name}
    </span>
  );
}
