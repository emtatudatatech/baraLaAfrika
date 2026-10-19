import type { CountryRef } from '@bla/shared';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './StatsBand.module.css';

/*
 * The pieces every statistics band shares (Harim's and Dhahabu's): the card grid or phone
 * carousel, the "How is this calculated?" popover, segmented bars with their legend, country
 * flags and the loading placeholders.
 */

const text = strings.statsBand;
const number = new Intl.NumberFormat('en');

/**
 * The band's cards: a grid on wider screens; on phones a horizontal carousel that scrolls inside
 * itself (the page never scrolls sideways), with a dot per card.
 */
export function StatsCarousel({
  isPhone,
  stale,
  labels,
  children,
}: {
  isPhone: boolean;
  stale: boolean;
  /** Each card's label, in order (for the dots). */
  labels: readonly string[];
  children: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // The carousel's current card: the one whose start is nearest the track's start.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !isPhone) return;
    const onScroll = () => {
      const items = [...track.children] as HTMLElement[];
      let best = 0;
      let distance = Infinity;
      items.forEach((item, index) => {
        const d = Math.abs(item.offsetLeft - track.offsetLeft - track.scrollLeft);
        if (d < distance) {
          distance = d;
          best = index;
        }
      });
      setActive(best);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
    };
  }, [isPhone]);

  const goTo = (index: number) => {
    const track = trackRef.current;
    const item = track?.children[index] as HTMLElement | undefined;
    if (!track || !item) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({
      left: item.offsetLeft - track.offsetLeft,
      behavior: reduce ? 'auto' : 'smooth',
    });
    setActive(index);
  };

  return (
    <>
      <div
        ref={trackRef}
        className={cx(isPhone ? styles.carousel : styles.grid, stale && styles.stale)}
        aria-busy={stale}
        {...(isPhone ? { role: 'region', 'aria-label': text.carouselLabel } : {})}
        data-testid="stats-cards"
      >
        {children}
      </div>
      {isPhone && labels.length > 1 && (
        <div className={styles.dots} role="group" aria-label={text.pagesLabel}>
          {labels.map((label, index) => (
            <button
              key={label}
              type="button"
              className={styles.dot}
              aria-label={text.cardOf(index + 1, labels.length, label)}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => {
                goTo(index);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function Flags({
  iso3s,
  countries,
}: {
  iso3s: readonly string[];
  countries: ReadonlyMap<string, CountryRef>;
}) {
  return (
    <span className={styles.flags}>
      {iso3s.map((iso3) => {
        const country = countries.get(iso3);
        return (
          <span key={iso3} className={styles.flagName}>
            {country && (
              <FlagImage flag={country.flag} countryName={country.name} width={24} decorative />
            )}
            {country?.name ?? iso3}
          </span>
        );
      })}
    </span>
  );
}

/** A stacked bar (decorative: the legend beside it carries the same numbers as text). */
export function StackedBar({
  parts,
}: {
  parts: readonly { key: string; share: number; colour: string }[];
}) {
  return (
    <span className={styles.bar} aria-hidden="true">
      {parts
        .filter((part) => part.share > 0)
        .map((part) => (
          <span
            key={part.key}
            className={styles.segment}
            style={{ flexGrow: part.share, '--swatch': part.colour }}
          />
        ))}
    </span>
  );
}

export function Legend({
  items,
}: {
  items: readonly { key: string; label: string; count: number; colour: string }[];
}) {
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.key} data-key={item.key}>
          <span className={styles.swatch} style={{ '--swatch': item.colour }} aria-hidden="true" />
          <span>{item.label}</span>
          <span className={styles.legendCount}>{number.format(item.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The "i" button: "How is this calculated?" with the API's definition, inside the card. */
export function Definition({ label, definition }: { label: string; definition: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Escape closes it (from anywhere inside it) and returns focus to the "i" button.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.info}
        aria-label={text.howCalculatedFor(label)}
        aria-expanded={open}
        {...(open ? { 'aria-controls': panelId } : {})}
        data-testid="stat-info"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Icon name="info" size={20} />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.definition}
          role="dialog"
          tabIndex={-1}
          aria-labelledby={`${panelId}-title`}
          data-testid="stat-definition"
        >
          <p id={`${panelId}-title`} className={styles.definitionTitle}>
            {text.howCalculated}
          </p>
          <p>{definition}</p>
          <button type="button" className={styles.definitionClose} onClick={close}>
            {text.close}
          </button>
        </div>
      )}
    </>
  );
}

/** Placeholder cards while the figures load (`hero` large cards, then compact ones). */
export function BandSkeleton({
  isPhone,
  count = 9,
  hero = 4,
}: {
  isPhone: boolean;
  count?: number;
  hero?: number;
}) {
  return (
    <div
      className={isPhone ? styles.carousel : styles.grid}
      aria-hidden="true"
      data-testid="stats-skeleton"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cx('glass', styles.card, index < hero ? styles.hero : styles.compact)}
        >
          <span className={cx('skeleton', styles.skeletonLabel)} />
          <span className={cx('skeleton', styles.skeletonValue)} />
          <span className={cx('skeleton', styles.skeletonLabel)} />
        </div>
      ))}
    </div>
  );
}
