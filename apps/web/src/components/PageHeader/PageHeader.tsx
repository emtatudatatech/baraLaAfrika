import type { ReactNode } from 'react';

import { GlassCard } from '../GlassCard/GlassCard';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/iconNames';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  icon: IconName;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ icon, title, description, actions }: PageHeaderProps) {
  return (
    <GlassCard as="header" className={styles.header} padding="lg">
      <span className={styles.badge}>
        <Icon name={icon} size={32} />
      </span>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </GlassCard>
  );
}
