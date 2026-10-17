import type { CountryRef, HarimStat, HarimStatKey, RegionSlug, StatAlternative } from '@bla/shared';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { DevApiHint } from '../../../components/DevApiHint/DevApiHint';
import { FlagImage } from '../../../components/FlagImage/FlagImage';
import { Icon } from '../../../components/Icon/Icon';
import type { IconName } from '../../../components/Icon/iconNames';
import { RegionChip } from '../../../components/RegionChip/RegionChip';
import { useTooltip } from '../../../components/Tooltip/useTooltip';
import { api } from '../../../lib/api';
import { minWidthQuery } from '../../../lib/breakpoints';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { type Unit, formatElevation } from '../../../lib/units';
import { useCountUp } from '../../../lib/useCountUp';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { useResource } from '../../../lib/useResource';
import { formatDate } from '../../coverage/coverageFormat';
import styles from './StatsBand.module.css';
import {
  type StatAction,
  heightCaveat,
  isHero,
  shares,
  statAction,
  visibleStats,
} from './statsLogic';

const text = strings.harim.stats;
const number = new Intl.NumberFormat('en');

const ICONS: Record<HarimStatKey, IconName> = {
  mountains_catalogued: 'landscape',
  volcanic_mountains: 'volcano',
  tallest_mountain: 'altitude',
  lowest_national_high_point: 'south',
  peaks_above_4000: 'mountain_flag',
  most_mountainous_country: 'flag',
  busiest_range: 'landscape_2',
  lowest_point: 'arrow_downward',
  greatest_relief: 'height',
  most_prominent_peak: 'trending_up',
};

const BANDS = ['above5000', 'from4000to5000', 'from3000to4000', 'upTo3000'] as const;
const BAND_COLOURS: Record<(typeof BANDS)[number], string> = {
  above5000: 'var(--band-above-5000)',
  from4000to5000: 'var(--band-4000-5000)',
  from3000to4000: 'var(--band-3000-4000)',
  upTo3000: 'var(--band-up-to-3000)',
};
const STATUSES = ['active', 'dormant', 'extinct', 'unknown'] as const;

export interface StatsBandProps {
  region: RegionSlug | null;
  regionName: string | null;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onAction: (action: StatAction) => void;
}

/**
 * The statistics band at the top of /harim (spec 7.5.1): every figure comes from
 * /api/mountains/stats (computed in the database) for All Africa or the selected region, and the
 * scope is always shown. Cards are clickable, explain how they are calculated, and count up on
 * first load. Two rows of cards on wide screens, three columns on tablets, a carousel on phones.
 */
export function StatsBand({ region, regionName, countries, unit, onAction }: StatsBandProps) {
  const key = `mountain-stats:${region ?? 'all'}`;
  const resource = useResource(key, () => api.mountainStats(region));
  // Count up only when the figures arrive after the band appeared (not from the cache).
  const [animate] = useState(() => resource.status === 'loading');
  // While another region loads, keep showing the previous figures (dimmed) instead of a flash.
  const [last, setLast] = useState<readonly HarimStat[] | null>(null);
  if (resource.status === 'success' && resource.data.stats !== last) setLast(resource.data.stats);
  const stats = resource.status === 'success' ? resource.data.stats : last;
  const stale = resource.status !== 'success' && stats !== null;
  const cards = stats ? visibleStats(stats) : [];
  const isPhone = !useMediaQuery(minWidthQuery('md'));
  const titleId = useId();
  const asOf = stats?.[0]?.asOf;

  return (
    <section className={styles.band} aria-labelledby={titleId} data-testid="stats-band">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {text.title}
        </h2>
        <span className={styles.scope} data-testid="stats-scope">
          <span className="visually-hidden">{text.region}: </span>
          {region !== null && regionName !== null ? (
            <RegionChip slug={region} name={regionName} />
          ) : (
            <span className={styles.allAfrica}>
              <Icon name="public" size={18} />
              {text.allAfrica}
            </span>
          )}
        </span>
        {asOf && <span className={styles.asOf}>{text.asOf(formatDate(asOf))}</span>}
      </div>

      {resource.status === 'error' && stats === null && (
        <div className={cx('glass', styles.error)} role="alert">
          <Icon name="error" size={20} />
          <span>{text.loadError}</span>
          <button type="button" className={styles.retry} onClick={resource.retry}>
            <Icon name="refresh" size={18} />
            {text.retry}
          </button>
          <DevApiHint error={resource.error} />
        </div>
      )}

      {stats === null && resource.status === 'loading' && <BandSkeleton isPhone={isPhone} />}

      {cards.length > 0 && (
        <Cards
          cards={cards}
          isPhone={isPhone}
          stale={stale}
          animate={animate}
          scopeName={regionName ?? text.allAfrica}
          countries={countries}
          unit={unit}
          onAction={onAction}
        />
      )}
    </section>
  );
}

function Cards({
  cards,
  isPhone,
  stale,
  animate,
  scopeName,
  countries,
  unit,
  onAction,
}: {
  cards: readonly HarimStat[];
  isPhone: boolean;
  stale: boolean;
  animate: boolean;
  scopeName: string;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onAction: (action: StatAction) => void;
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
        {cards.map((stat) => (
          <StatCard
            key={stat.key}
            stat={stat}
            animate={animate}
            scopeName={scopeName}
            countries={countries}
            unit={unit}
            onAction={onAction}
          />
        ))}
      </div>
      {isPhone && cards.length > 1 && (
        <div className={styles.dots} role="group" aria-label={text.pagesLabel}>
          {cards.map((stat, index) => (
            <button
              key={stat.key}
              type="button"
              className={styles.dot}
              aria-label={text.cardOf(index + 1, cards.length, stat.label)}
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

// ── One card ─────────────────────────────────────────────────────────────────

interface CardBody {
  unitWord?: string;
  detail: ReactNode;
  visual?: ReactNode;
}

function StatCard({
  stat,
  animate,
  scopeName,
  countries,
  unit,
  onAction,
}: {
  stat: HarimStat;
  animate: boolean;
  scopeName: string;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onAction: (action: StatAction) => void;
}) {
  const titleId = useId();
  const hero = isHero(stat.key);
  const isHeight = stat.unit === 'm';
  const counted = useCountUp(stat.value, animate);
  const shown =
    counted.value === null
      ? null
      : isHeight
        ? formatElevation(Math.round(counted.value), unit)
        : number.format(Math.round(counted.value));
  // A card naming one thing (or a count) is one big target; tied entities get a button each.
  const single = stat.entities.length <= 1 ? statAction(stat) : null;
  const body = cardBody(stat, countries, unit, onAction);

  return (
    <article
      className={cx(
        'glass',
        styles.card,
        hero ? styles.hero : styles.compact,
        single && styles.clickable,
      )}
      aria-labelledby={titleId}
      data-stat={stat.key}
      data-testid="stat-card"
    >
      <header className={styles.cardHead}>
        <span className={styles.icon}>
          <Icon name={ICONS[stat.key]} size={hero ? 24 : 20} />
        </span>
        <h3 id={titleId} className={styles.label}>
          {stat.label}
          <span className="visually-hidden"> ({scopeName})</span>
        </h3>
        <Definition label={stat.label} definition={stat.definition} />
      </header>
      <p className={styles.value} data-counting={counted.counting || undefined}>
        {shown === null ? (
          <span aria-hidden="true">—</span>
        ) : (
          <>
            {/* Screen readers get the final figure, never the animation's steps. */}
            <span aria-hidden="true">{shown}</span>
            <span className="visually-hidden">
              {isHeight ? formatElevation(stat.value ?? 0, unit) : number.format(stat.value ?? 0)}
            </span>
          </>
        )}
        {shown !== null && body.unitWord && <span className={styles.unit}> {body.unitWord}</span>}
      </p>
      <div className={styles.detail}>{stat.value === null ? text.none : body.detail}</div>
      {stat.value !== null && body.visual}
      {single && (
        <button
          type="button"
          className={styles.action}
          {...(single.kind === 'peak' ? { 'aria-haspopup': 'dialog' as const } : {})}
          onClick={() => {
            onAction(single);
          }}
        >
          {text.actions[stat.key]}
          <Icon name="arrow_forward" size={18} className={styles.actionIcon} />
        </button>
      )}
    </article>
  );
}

function cardBody(
  stat: HarimStat,
  countries: ReadonlyMap<string, CountryRef>,
  unit: Unit,
  onAction: (action: StatAction) => void,
): CardBody {
  const many = stat.entities.length > 1;
  /** One named thing: plain text when the card is the action, a button when tied. */
  const entity = (index: number, content: ReactNode, label: string) => {
    if (!many) return content;
    const action = statAction(stat, index);
    return (
      <button
        type="button"
        className={styles.entityButton}
        aria-label={`${label}: ${text.actions[stat.key]}`}
        onClick={() => {
          if (action) onAction(action);
        }}
      >
        {content}
      </button>
    );
  };
  const height = (metres: number) => formatElevation(metres, unit);

  switch (stat.key) {
    case 'mountains_catalogued':
      return {
        unitWord: text.mountainsUnit(stat.value ?? 0),
        detail: (
          <p>
            {text.acrossCountries(stat.detail.countries)}
            {stat.detail.territoryPeaks > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                {text.plusTerritories(stat.detail.territoryPeaks)}
              </>
            )}
          </p>
        ),
      };
    case 'volcanic_mountains': {
      const parts = shares(stat.detail, STATUSES);
      return {
        unitWord: text.mountainsUnit(stat.value ?? 0),
        detail: (
          <Legend
            items={parts.map((p) => ({
              key: p.key,
              label: text.volcanic[p.key],
              count: p.count,
              colour: `var(--volcanic-${p.key})`,
            }))}
          />
        ),
        visual: (
          <StackedBar parts={parts.map((p) => ({ ...p, colour: `var(--volcanic-${p.key})` }))} />
        ),
      };
    }
    case 'peaks_above_4000': {
      const parts = shares(stat.detail, BANDS);
      return {
        unitWord: text.mountainsUnit(stat.value ?? 0),
        detail: (
          <Legend
            items={parts.map((p) => ({
              key: p.key,
              label: text.bands[p.key],
              count: p.count,
              colour: BAND_COLOURS[p.key],
            }))}
          />
        ),
        visual: <StackedBar parts={parts.map((p) => ({ ...p, colour: BAND_COLOURS[p.key] }))} />,
      };
    }
    case 'tallest_mountain':
    case 'most_prominent_peak':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((m, index) => (
              <li key={m.slug}>
                {entity(
                  index,
                  <>
                    <span className={styles.entityName}>
                      {m.name}
                      {m.summitName !== null && (
                        <span className={styles.summit}> · {m.summitName}</span>
                      )}
                    </span>
                    <Flags iso3s={m.countries} countries={countries} />
                  </>,
                  m.name,
                )}
                {stat.key === 'tallest_mountain' && <HeightCaveat entity={m} unit={unit} />}
              </li>
            ))}
          </ul>
        ),
      };
    case 'lowest_national_high_point':
      return {
        detail: (
          <>
            <p className={styles.caption}>{text.lowestHighPointCaption}</p>
            <ul className={styles.entities}>
              {stat.entities.map((c, index) => (
                <li key={c.iso3}>
                  {entity(
                    index,
                    <>
                      <span className={styles.entityName}>{c.mountainName}</span>
                      <Flags iso3s={[c.iso3]} countries={countries} />
                    </>,
                    c.mountainName,
                  )}
                  <HeightCaveat entity={c} unit={unit} />
                </li>
              ))}
            </ul>
          </>
        ),
      };
    case 'most_mountainous_country':
      return {
        unitWord: text.mountainsUnit(stat.value ?? 0),
        detail: (
          <ul className={styles.entities}>
            <li className={styles.note}>{text.atLeast3000}</li>
            {stat.entities.map((c, index) => (
              <li key={c.iso3}>
                {entity(index, <Flags iso3s={[c.iso3]} countries={countries} />, c.name)}
              </li>
            ))}
          </ul>
        ),
      };
    case 'busiest_range':
      return {
        unitWord: text.mountainsUnit(stat.value ?? 0),
        detail: (
          <ul className={styles.entities}>
            <li className={styles.note}>{text.atLeast3000}</li>
            {stat.entities.map((r, index) => (
              <li key={r.slug}>
                {entity(index, <span className={styles.entityName}>{r.name}</span>, r.name)}
                <span className={styles.sub}>
                  {text.tallestInRange(r.tallest.name, height(r.tallest.elevationM))}
                </span>
              </li>
            ))}
          </ul>
        ),
      };
    case 'lowest_point':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((p, index) => (
              <li key={p.iso3}>
                {entity(
                  index,
                  <>
                    <span className={styles.entityName}>{p.pointName}</span>
                    <Flags iso3s={[p.iso3]} countries={countries} />
                  </>,
                  p.pointName,
                )}
                <span className={styles.sub}>
                  {p.elevationM < 0
                    ? text.belowSeaLevel(height(-p.elevationM))
                    : p.elevationM === 0
                      ? text.atSeaLevel
                      : height(p.elevationM)}
                </span>
                {p.needsReview && <ReviewMarker />}
              </li>
            ))}
          </ul>
        ),
      };
    case 'greatest_relief':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((c, index) => (
              <li key={c.iso3}>
                {entity(index, <Flags iso3s={[c.iso3]} countries={countries} />, c.name)}
                <span className={styles.sub}>
                  {text.reliefRange(
                    `${c.lowestName}, ${height(c.lowestM)}`,
                    `${c.highestName}, ${height(c.highestM)}`,
                  )}
                </span>
              </li>
            ))}
          </ul>
        ),
      };
  }
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Flags({
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
function StackedBar({
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

function Legend({
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

/** "Sources disagree": the other sourced heights, in a tooltip (hover, focus or tap). */
function HeightCaveat({
  entity,
  unit,
}: {
  entity: {
    elevationM: number;
    confidence: 'high' | 'medium' | 'low';
    alternatives: readonly StatAlternative[];
  };
  unit: Unit;
}) {
  const caveat = heightCaveat(entity);
  const tip = useTooltip({
    content: caveat && (
      <span className={styles.tip}>
        {caveat.lowConfidence && <strong>{text.lowConfidence}</strong>}
        {caveat.alternatives.length > 0 && (
          <>
            <span>{text.otherHeights}</span>
            {caveat.alternatives.map((alternative) => (
              <span key={`${alternative.source}-${String(alternative.elevationM)}`}>
                {formatElevation(alternative.elevationM, unit)} ({alternative.source})
              </span>
            ))}
          </>
        )}
      </span>
    ),
  });
  if (!caveat) return null;
  return (
    <>
      <button
        type="button"
        className={styles.marker}
        data-testid="stat-caveat"
        {...tip.triggerProps}
      >
        <Icon name="info" size={18} />
        {caveat.alternatives.length > 0 ? text.sourcesDisagree : text.lowConfidence}
      </button>
      {tip.tooltip}
    </>
  );
}

function ReviewMarker() {
  const tip = useTooltip({
    content: <span className={styles.tip}>{text.lowPointReviewHint}</span>,
  });
  return (
    <>
      <button type="button" className={styles.marker} {...tip.triggerProps}>
        <Icon name="info" size={18} />
        {text.lowPointReview}
      </button>
      {tip.tooltip}
    </>
  );
}

/** The "i" button: "How is this calculated?" with the API's definition, inside the card. */
function Definition({ label, definition }: { label: string; definition: string }) {
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

function BandSkeleton({ isPhone }: { isPhone: boolean }) {
  return (
    <div
      className={isPhone ? styles.carousel : styles.grid}
      aria-hidden="true"
      data-testid="stats-skeleton"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <div
          key={index}
          className={cx('glass', styles.card, index < 4 ? styles.hero : styles.compact)}
        >
          <span className={cx('skeleton', styles.skeletonLabel)} />
          <span className={cx('skeleton', styles.skeletonValue)} />
          <span className={cx('skeleton', styles.skeletonLabel)} />
        </div>
      ))}
    </div>
  );
}
