import type { ButtonHTMLAttributes } from 'react';

import { cx } from '../../lib/cx';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/iconNames';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  icon: IconName;
  /** Required accessible name: the button has no visible text. */
  label: string;
  variant?: 'glass' | 'plain';
  iconSize?: 20 | 24;
}

export function IconButton({
  icon,
  label,
  variant = 'plain',
  iconSize = 24,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(styles.button, variant === 'glass' && 'glass', styles[variant], className)}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
