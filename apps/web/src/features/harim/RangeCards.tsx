import type { CountryRef, RangeSummary } from '@bla/shared';
import { Link } from 'react-router';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation } from '../../lib/units';
import styles from './RangeCards.module.css';
import { rangeIcon, rangeTypeLabel } from './rangeFormat';

const text = strings.harim.ranges;
const MAX_FLAGS = 4;
const MAX_BARS = 24;

/**
 * The ranges view (spec 7.5.2): one card per range, tinted with the region colour of the country
 * where it has most peaks (neutral when split), with its tallest peak, mountain count, countries
 * and a mini bar of its peaks' heights. The whole card opens the range page.
 */
export function RangeCards({
  ranges,
  countries,
  unit,
  maxHeight,
}: {
  ranges: readonly RangeSummary[];
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  /** Africa's tallest mountain: the full height of the mini bars. */
  maxHeight: number;
}) {
  return (
    <ul className={styles.grid} aria-label={text.listLabel} data-testid="harim-range-cards">
      {ranges.map((range) => {
        const names = range.countries.map((iso3) => countries.get(iso3)?.name ?? iso3);
        return (
          <li
            key={range.slug}
            className={cx('glass', styles.card)}
            style={{
              '--tint': range.tintRegion
                ? `var(--region-${range.tintRegion})`
                : 'var(--color-line-strong)',
              '--bar': range.tintRegion
                ? `var(--region-${range.tintRegion})`
                : 'var(--color-ink-subtle)',
            }}
            data-slug={range.slug}
            data-tint={range.tintRegion ?? 'split'}
          >
            <div className={styles.head}>
              <span className={styles.icon}>
                <Icon name={rangeIcon(range.rangeType)} size={20} />
              </span>
              <h3 className={styles.name}>
                <Link to={`/harim/ranges/${range.slug}`} className={styles.link}>
                  {range.name}
                </Link>
              </h3>
            </div>
            <p className={styles.type}>{rangeTypeLabel(range.rangeType)}</p>
            {range.tallest && (
              <p className={styles.tallest}>
                {text.tallest(range.tallest.name, formatElevation(range.tallest.elevationM, unit))}
              </p>
            )}
            <p className={styles.count}>{strings.harim.mountainCount(range.peakCount)}</p>
            <p className={styles.countries}>
              <span className="visually-hidden">{text.countries}: </span>
              {range.countries.slice(0, MAX_FLAGS).map((iso3) => {
                const country = countries.get(iso3);
                return country ? (
                  <FlagImage
                    key={iso3}
                    flag={country.flag}
                    countryName={country.name}
                    width={24}
                    className={styles.flag}
                    decorative
                  />
                ) : null;
              })}
              <span className={styles.countryNames}>
                {names.slice(0, 2).join(', ')}
                {names.length > 2 && ` +${String(names.length - 2)}`}
              </span>
            </p>
            <MiniBars heights={range.heights} maxHeight={maxHeight} unit={unit} />
          </li>
        );
      })}
    </ul>
  );
}

/** A tiny column chart of the range's peak heights, tallest first (text equivalent included). */
function MiniBars({
  heights,
  maxHeight,
  unit,
}: {
  heights: readonly number[];
  maxHeight: number;
  unit: Unit;
}) {
  const shown = heights.slice(0, MAX_BARS);
  const width = 6;
  const gap = 2;
  const height = 36;
  const top = Math.max(1, maxHeight);
  return (
    <div className={styles.bars}>
      <svg
        width={shown.length * (width + gap)}
        height={height}
        viewBox={`0 0 ${String(shown.length * (width + gap))} ${String(height)}`}
        aria-hidden="true"
      >
        {shown.map((value, index) => {
          const h = Math.max(2, (value / top) * height);
          return (
            <rect
              key={index}
              x={index * (width + gap)}
              y={height - h}
              width={width}
              height={h}
              rx={2}
              className={styles.bar}
            />
          );
        })}
      </svg>
      <span className="visually-hidden">
        {text.heightsLabel(heights.length)}:{' '}
        {heights.map((value) => formatElevation(value, unit)).join(', ')}
      </span>
    </div>
  );
}
