import type { Confidence, CountryRef } from '@bla/shared';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation, otherUnit } from '../../lib/units';
import styles from './PeakBits.module.css';

/* Small pieces shared by the Harim tables, cards and drawer. */

const text = strings.harim;

/** A height in the chosen unit, optionally followed by the other unit in a quieter tone. */
export function Height({
  metres,
  unit,
  both = false,
  className,
}: {
  metres: number;
  unit: Unit;
  both?: boolean;
  className?: string | undefined;
}) {
  return (
    <span className={cx(styles.height, className)} data-metres={metres}>
      <span className={styles.primary}>{formatElevation(metres, unit)}</span>
      {both && <span className={styles.secondary}>{formatElevation(metres, otherUnit(unit))}</span>}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={cx(styles.badge, confidence !== 'high' && styles.warning)}
      data-confidence={confidence}
    >
      {text.confidence[confidence]}
    </span>
  );
}

export function UltraBadge() {
  return (
    <span className={cx(styles.badge, styles.ultra)}>
      {text.ultra}
      <span className="visually-hidden"> ({text.ultraHint})</span>
    </span>
  );
}

export function SharedBadge({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <span className={cx(styles.badge, styles.wraps)}>{text.sharedWith(names.join(', '))}</span>
  );
}

export function HighPointBadge() {
  return <span className={cx(styles.badge, styles.highPoint)}>{text.highPoint}</span>;
}

/** Flags and names of a mountain's countries (or its territory). */
export function CountryList({
  iso3s,
  countries,
  territory = null,
}: {
  iso3s: readonly string[];
  countries: ReadonlyMap<string, CountryRef>;
  territory?: string | null;
}) {
  if (iso3s.length === 0) {
    return <span className={styles.countries}>{territory ?? text.unknown}</span>;
  }
  return (
    <span className={styles.countries}>
      {iso3s.map((iso3) => {
        const country = countries.get(iso3);
        return (
          <span key={iso3} className={styles.country}>
            {country && (
              <FlagImage
                flag={country.flag}
                countryName={country.name}
                width={24}
                className={styles.flag}
                decorative
              />
            )}
            {country?.name ?? iso3}
          </span>
        );
      })}
    </span>
  );
}

/** Proportional bar beside a height (decorative: the number is the accessible value). */
export function HeightBar({ metres, max }: { metres: number; max: number }) {
  const share = max > 0 ? Math.max(0, Math.min(1, metres / max)) : 0;
  return (
    <span className={styles.bar} aria-hidden="true">
      <span className={styles.barFill} style={{ '--share': share }} />
    </span>
  );
}
