import type { ElementType, HTMLAttributes, ReactNode } from 'react';

import { cx } from '../../lib/cx';
import styles from './GlassCard.module.css';

export interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  strong?: boolean;
  padding?: 'sm' | 'md' | 'lg';
  className?: string | undefined;
  children: ReactNode;
}

export function GlassCard({
  as: Component = 'div',
  strong = false,
  padding = 'md',
  className,
  children,
  ...rest
}: GlassCardProps) {
  return (
    <Component
      className={cx('glass', strong && 'glass--strong', styles.card, styles[padding], className)}
      {...rest}
    >
      {children}
    </Component>
  );
}
