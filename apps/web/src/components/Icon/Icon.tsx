import { cx } from '../../lib/cx';
import styles from './Icon.module.css';
import type { IconName } from './iconNames';

export interface IconProps {
  name: IconName;
  /** Optical size in px (also sets the font size). */
  size?: 18 | 20 | 24 | 32 | 40 | 48;
  filled?: boolean;
  className?: string | undefined;
  /**
   * Accessible name. Omit for decorative icons (the default: hidden from assistive tech).
   * Icon-only buttons should use <IconButton label="…"> instead.
   */
  label?: string;
}

export function Icon({ name, size = 24, filled = false, className, label }: IconProps) {
  const a11y =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label } as const);
  return (
    <span
      className={cx(styles.icon, filled && styles.filled, className)}
      style={{ '--icon-size': `${size}px` }}
      translate="no"
      {...a11y}
    >
      {name}
    </span>
  );
}
