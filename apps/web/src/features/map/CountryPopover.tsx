import type { CountrySummary } from '@bla/shared';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { IconButton } from '../../components/IconButton/IconButton';
import { placeTooltip } from '../../components/Tooltip/placeTooltip';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import styles from './CountryPopover.module.css';
import { MapFacts } from './MapFacts';
import { territoryNote } from './territoryNotes';

export interface CountryPopoverProps {
  country: CountrySummary;
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * Short country profile opened from the map: anchored next to the country on larger screens,
 * a bottom sheet on phones. Non-modal; Escape or a click outside closes it and focus returns to
 * the country.
 */
export function CountryPopover({ country, anchor, onClose }: CountryPopoverProps) {
  const titleId = useId();
  const note = territoryNote(country.iso3);
  const ref = useRef<HTMLDivElement>(null);
  const isWide = useMediaQuery(minWidthQuery('md'));

  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (ref.current?.contains(target)) return;
      // Clicking another country switches the popover instead of closing it first.
      if (target?.closest('[data-iso3]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!isWide) {
      node.style.left = '';
      node.style.top = '';
      return;
    }
    const { left, top } = placeTooltip(
      { left: anchor.x - 12, top: anchor.y - 12, width: 24, height: 24 },
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      'top',
    );
    node.style.left = `${String(left)}px`;
    node.style.top = `${String(top)}px`;
  }, [anchor, isWide, country.iso3]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cx('glass glass--strong', styles.popover, !isWide && styles.sheet)}
      style={{ '--accent': `var(--region-${country.region.slug})` }}
      data-testid="country-popover"
    >
      <header className={styles.header}>
        <FlagImage flag={country.flag} countryName={country.name} width={48} loading="eager" />
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>
            {country.name}
          </h2>
          <span className={styles.region}>{country.region.name}</span>
        </div>
        <IconButton icon="close" label={strings.popover.close} onClick={onClose} />
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>{strings.popover.meaning}</dt>
          <dd>{country.etymologySummary}</dd>
        </div>
        <div>
          <dt>{strings.popover.animal}</dt>
          <dd>
            {country.nationalAnimalName}{' '}
            <span className={styles.status}>{strings.animalStatus[country.animalStatus]}</span>
          </dd>
        </div>
      </dl>
      <MapFacts country={country} variant="popover" />
      {note !== undefined && <p className={styles.note}>{note}</p>}
      <Link className={styles.action} to={`/countries?country=${country.iso3}`}>
        {strings.popover.seeInTable}
      </Link>
    </div>
  );
}
