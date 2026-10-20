import type { CountrySummary } from '@bla/shared';
import { useState } from 'react';

import { AnimalStatusBadge } from '../../components/AnimalStatusBadge/AnimalStatusBadge';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './CountryCards.module.css';
import { FlagCell } from './FlagCell';

export interface CountryCardsProps {
  countries: readonly CountrySummary[];
  onOpen: (iso3: string) => void;
}

/**
 * Phones (< 720px): a stacked card list instead of a squeezed table. Each card shows the flag,
 * name and region; it expands to the short summaries and a button to the full profile.
 */
export function CountryCards({ countries, onOpen }: CountryCardsProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (iso3: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(iso3)) next.delete(iso3);
      else next.add(iso3);
      return next;
    });
  };
  return (
    <ul className={styles.list} data-testid="country-cards">
      {countries.map((country) => {
        const open = expanded.has(country.iso3);
        const panelId = `country-card-${country.iso3}`;
        return (
          <li
            key={country.iso3}
            className={cx('glass', styles.card)}
            style={{ '--accent': `var(--region-${country.region.slug})` }}
            data-iso3={country.iso3}
          >
            <div className={styles.header}>
              <FlagCell country={country} width={48} />
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                  toggle(country.iso3);
                }}
              >
                <span className={styles.titles}>
                  <span className={styles.name} data-testid="country-name">
                    {country.name}
                  </span>
                  <RegionChip slug={country.region.slug} name={country.region.name} />
                </span>
                <Icon
                  name="keyboard_arrow_down"
                  className={cx(styles.chevron, open && styles.chevronOpen)}
                />
              </button>
            </div>
            <div id={panelId} className={styles.panel} hidden={!open}>
              <dl className={styles.facts}>
                <div>
                  <dt>{strings.countries.columns.etymology}</dt>
                  <dd>{country.etymologySummary}</dd>
                </div>
                <div>
                  <dt>{strings.countries.columns.symbol}</dt>
                  <dd>{country.nationalSymbolSummary}</dd>
                </div>
                <div>
                  <dt>{strings.countries.columns.animal}</dt>
                  <dd>
                    {country.nationalAnimalName}{' '}
                    {country.animalStatus !== 'official' && (
                      <AnimalStatusBadge status={country.animalStatus} />
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{strings.countries.columns.flag}</dt>
                  <dd>{country.flagDesignSummary}</dd>
                </div>
              </dl>
              <button
                type="button"
                className={styles.details}
                aria-haspopup="dialog"
                onClick={() => {
                  onOpen(country.iso3);
                }}
              >
                {strings.countries.viewDetails}
                <Icon name="info" size={18} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CountryCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className={styles.list} aria-hidden="true" data-testid="countries-skeleton">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={cx('glass', styles.card, styles.header)}>
          <span className={cx('skeleton', styles.skeletonFlag)} />
          <span className={cx('skeleton', styles.skeletonText)} />
        </li>
      ))}
    </ul>
  );
}
