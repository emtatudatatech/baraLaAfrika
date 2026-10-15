import type { AnimalStatus } from '@bla/shared';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './AnimalStatusBadge.module.css';

export interface AnimalStatusBadgeProps {
  status: AnimalStatus;
  className?: string | undefined;
}

/**
 * How firmly a national animal is established (official, de facto, inferred…), so inference is
 * never presented as official fact. The hint is exposed as the badge's title for pointers; the
 * drawer also shows it as text.
 */
export function AnimalStatusBadge({ status, className }: AnimalStatusBadgeProps) {
  return (
    <span
      className={cx(styles.badge, status !== 'official' && styles.unofficial, className)}
      title={strings.animalStatusHint[status]}
    >
      {strings.animalStatus[status]}
    </span>
  );
}
