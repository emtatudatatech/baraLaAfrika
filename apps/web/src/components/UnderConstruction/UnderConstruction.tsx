import { strings } from '../../lib/strings';
import { GlassCard } from '../GlassCard/GlassCard';
import { Icon } from '../Icon/Icon';
import styles from './UnderConstruction.module.css';

export function UnderConstruction() {
  return (
    <GlassCard className={styles.card}>
      <Icon name="schedule" size={24} className={styles.icon} />
      <p>{strings.pages.underConstruction}</p>
    </GlassCard>
  );
}
