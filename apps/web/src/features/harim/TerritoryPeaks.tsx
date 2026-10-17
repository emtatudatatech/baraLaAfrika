import type { CountryRef } from '@bla/shared';
import { useState } from 'react';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import type { Unit } from '../../lib/units';
import { useResource } from '../../lib/useResource';
import { sortPeaks } from './harimQuery';
import { PeakList } from './PeakList';
import styles from './TerritoryPeaks.module.css';

const text = strings.harim;

/**
 * Peaks in territories outside the 54 states (Canary Islands, Réunion…): collapsed by default,
 * loaded on first open, and never counted with the countries.
 */
export function TerritoryPeaks({
  countries,
  unit,
  onOpenPeak,
}: {
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const peaks = useResource(opened ? 'mountains:territories' : null, () =>
    api.mountains({ territories: true }),
  );
  return (
    <details
      className={cx('glass', styles.group)}
      data-testid="harim-territories"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className={styles.summary}>
        <Icon name="keyboard_arrow_down" className={styles.chevron} />
        <span>
          <span className={styles.title}>
            {text.territories.title}
            {peaks.status === 'success' && ` (${String(peaks.data.count)})`}
          </span>
          <span className={styles.hint}>{text.territories.hint}</span>
        </span>
      </summary>
      <div className={styles.body}>
        {opened && peaks.status === 'loading' && (
          <span className={cx('skeleton', styles.skeleton)} aria-hidden="true" />
        )}
        {peaks.status === 'error' && (
          <div className={styles.error} role="alert">
            <Icon name="error" size={20} />
            <span>{text.loadError}</span>
            <button type="button" className={styles.retry} onClick={peaks.retry}>
              {text.retry}
            </button>
            <DevApiHint error={peaks.error} />
          </div>
        )}
        {peaks.status === 'success' && (
          <PeakList
            mountains={sortPeaks(peaks.data.mountains, 'height')}
            countries={countries}
            unit={unit}
            onOpenPeak={onOpenPeak}
            testId="harim-territory-list"
            framed={false}
          />
        )}
      </div>
    </details>
  );
}
