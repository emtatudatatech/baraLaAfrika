import type { CountryRef, GoldStat, GoldStatKey, GoldUnit, RegionSlug } from '@bla/shared';
import { type ReactNode, useId, useState } from 'react';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { formatMass, formatMonth, formatPct, formatPrice, formatUsd } from '../../lib/goldUnits';
import { strings } from '../../lib/strings';
import { useCountUp } from '../../lib/useCountUp';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import styles from '../stats/StatsBand.module.css';
import {
  BandSkeleton,
  Definition,
  Flags,
  Legend,
  StackedBar,
  StatsCarousel,
} from '../stats/StatsParts';
import {
  type GoldStatAction,
  formatStatValue,
  goldStatAction,
  statPeriod,
  tierColour,
} from './goldStats';
import bandStyles from './GoldStatsBand.module.css';

const text = strings.dhahabu.stats;
const shared = strings.statsBand;

const ICONS: Record<GoldStatKey, IconName> = {
  gold_producing_countries: 'diamond',
  africa_production: 'savings',
  production_value: 'paid',
  largest_producer: 'flag',
  central_bank_gold: 'account_balance',
  largest_holder: 'workspace_premium',
  gold_price: 'show_chart',
  most_gold_dependent: 'local_shipping',
  biggest_reporting_gap: 'compare_arrows',
  largest_net_buyer: 'add_shopping_cart',
};

const HERO: readonly GoldStatKey[] = [
  'gold_producing_countries',
  'africa_production',
  'production_value',
  'largest_producer',
];

const TIERS = [
  ['majorProducer', 'major_producer'],
  ['producer', 'producer'],
  ['occurrencesKnown', 'occurrences_known'],
  ['noneIdentified', 'none_identified'],
  ['unknown', 'unknown'],
] as const;

export interface GoldStatsBandProps {
  region: RegionSlug | null;
  regionName: string | null;
  /** The API's reference year (undefined = latest available). */
  year: number | undefined;
  countries: ReadonlyMap<string, CountryRef>;
  unit: GoldUnit;
  onAction: (action: GoldStatAction) => void;
}

/**
 * The statistics band at the top of /dhahabu (spec 7.6.1): every figure comes from
 * /api/gold/stats (computed in the database) for All Africa or the selected region at the
 * ribbon's reference year; each card shows the year or month it describes.
 */
export function GoldStatsBand({
  region,
  regionName,
  year,
  countries,
  unit,
  onAction,
}: GoldStatsBandProps) {
  const key = `gold-stats:${region ?? 'all'}:${year === undefined ? 'latest' : String(year)}`;
  const resource = useResource(key, () => api.goldStats(region, year));
  const [animate] = useState(() => resource.status === 'loading');
  // While another selection loads, keep the previous figures (dimmed) instead of a flash.
  const [last, setLast] = useState<readonly GoldStat[] | null>(null);
  if (resource.status === 'success' && resource.data.stats !== last) setLast(resource.data.stats);
  const stats = resource.status === 'success' ? resource.data.stats : last;
  const stale = resource.status !== 'success' && stats !== null;
  const isPhone = !useMediaQuery(minWidthQuery('md'));
  const titleId = useId();

  return (
    <section
      className={cx(styles.band, bandStyles.band)}
      aria-labelledby={titleId}
      data-testid="gold-stats-band"
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {text.title}
        </h2>
        <span className={styles.scope} data-testid="stats-scope">
          <span className="visually-hidden">{shared.region}: </span>
          {region !== null && regionName !== null ? (
            <RegionChip slug={region} name={regionName} />
          ) : (
            <span className={styles.allAfrica}>
              <Icon name="public" size={18} />
              {shared.allAfrica}
            </span>
          )}
        </span>
        <span className={styles.asOf} data-testid="gold-stats-year">
          {year === undefined ? text.latest : text.upTo(year)}
        </span>
      </div>

      {resource.status === 'error' && stats === null && (
        <div className={cx('glass', styles.error)} role="alert">
          <Icon name="error" size={20} />
          <span>{shared.loadError}</span>
          <button type="button" className={styles.retry} onClick={resource.retry}>
            <Icon name="refresh" size={18} />
            {shared.retry}
          </button>
          <DevApiHint error={resource.error} />
        </div>
      )}

      {stats === null && resource.status === 'loading' && (
        <BandSkeleton isPhone={isPhone} count={10} hero={4} />
      )}

      {stats !== null && stats.length > 0 && (
        <StatsCarousel isPhone={isPhone} stale={stale} labels={stats.map((s) => s.label)}>
          {stats.map((stat) => (
            <GoldStatCard
              key={stat.key}
              stat={stat}
              animate={animate}
              scopeName={regionName ?? shared.allAfrica}
              countries={countries}
              unit={unit}
              onAction={onAction}
            />
          ))}
        </StatsCarousel>
      )}
    </section>
  );
}

function GoldStatCard({
  stat,
  animate,
  scopeName,
  countries,
  unit,
  onAction,
}: {
  stat: GoldStat;
  animate: boolean;
  scopeName: string;
  countries: ReadonlyMap<string, CountryRef>;
  unit: GoldUnit;
  onAction: (action: GoldStatAction) => void;
}) {
  const titleId = useId();
  const hero = HERO.includes(stat.key);
  const counted = useCountUp(stat.value, animate);
  const shown = counted.value === null ? null : formatStatValue(stat, counted.value, unit);
  const finalText = stat.value === null ? '—' : formatStatValue(stat, stat.value, unit);
  const single = stat.entities.length <= 1 ? goldStatAction(stat) : null;
  const period = statPeriod(stat);
  const body = cardBody(stat, countries, unit, onAction);

  return (
    <article
      className={cx(
        'glass',
        styles.card,
        hero ? styles.hero : styles.compact,
        single && styles.clickable,
        bandStyles.card,
      )}
      // The final figure's length (not the counting one's), so its size holds while counting.
      style={{ '--value-chars': finalText.length + (body.unitWord ? body.unitWord.length + 1 : 0) }}
      aria-labelledby={titleId}
      data-stat={stat.key}
      data-testid="stat-card"
    >
      <header className={styles.cardHead}>
        <span className={cx(styles.icon, bandStyles.icon)}>
          <Icon name={ICONS[stat.key]} size={hero ? 24 : 20} />
        </span>
        <h3 id={titleId} className={styles.label}>
          {stat.label}
          <span className="visually-hidden"> ({scopeName})</span>
        </h3>
        <Definition label={stat.label} definition={stat.definition} />
      </header>
      {period !== null && (
        <span className={bandStyles.period} data-testid="stat-period">
          {period}
        </span>
      )}
      <p className={styles.value} data-counting={counted.counting || undefined}>
        {shown === null || stat.value === null ? (
          <span aria-hidden="true">—</span>
        ) : (
          <>
            <span aria-hidden="true">{shown}</span>
            <span className="visually-hidden">{finalText}</span>
          </>
        )}
        {shown !== null && body.unitWord && <span className={styles.unit}> {body.unitWord}</span>}
      </p>
      <div className={styles.detail}>
        {stat.value === null && body.empty === undefined ? text.none : body.detail}
      </div>
      {stat.value !== null && body.visual}
      {single && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            onAction(single);
          }}
        >
          {strings.dhahabu.stats.actions[stat.key]}
          <Icon name="arrow_forward" size={18} className={styles.actionIcon} />
        </button>
      )}
    </article>
  );
}

interface CardBody {
  unitWord?: string;
  detail: ReactNode;
  visual?: ReactNode;
  /** Set when an empty value has its own explanation (e.g. "no net buyer"). */
  empty?: true;
}

function cardBody(
  stat: GoldStat,
  countries: ReadonlyMap<string, CountryRef>,
  unit: GoldUnit,
  onAction: (action: GoldStatAction) => void,
): CardBody {
  const many = stat.entities.length > 1;
  const entity = (index: number, iso3: string, name: string) => {
    const content = <Flags iso3s={[iso3]} countries={countries} />;
    if (!many) return content;
    const action = goldStatAction(stat, index);
    return (
      <button
        type="button"
        className={styles.entityButton}
        aria-label={`${name}: ${strings.dhahabu.stats.actions[stat.key]}`}
        onClick={() => {
          if (action) onAction(action);
        }}
      >
        {content}
      </button>
    );
  };

  switch (stat.key) {
    case 'gold_producing_countries': {
      const d = stat.detail;
      const parts = TIERS.map(([detailKey, tier]) => ({
        key: tier,
        count: d[detailKey],
        share: d.countries > 0 ? d[detailKey] / d.countries : 0,
        colour: tierColour(tier),
        label: text.tiers[detailKey],
      }));
      return {
        unitWord: text.ofCountries(d.countries),
        detail: (
          <Legend
            items={parts.map(({ key, label, count: n, colour }) => ({
              key,
              label,
              count: n,
              colour,
            }))}
          />
        ),
        visual: <StackedBar parts={parts} />,
      };
    }
    case 'africa_production': {
      const d = stat.detail;
      return {
        detail: (
          <>
            {d.year !== null && (
              <p>
                {text.productionDetail(d.year)}
                {d.worldSharePct !== null && ` · ${text.worldShare(formatPct(d.worldSharePct))}`}
              </p>
            )}
            {d.changeTonnes !== null && d.changePct !== null && d.previousYear !== null && (
              <p className={bandStyles.sub}>
                {text.change(
                  formatMass(d.changeTonnes, unit, { sign: true }),
                  formatPct(d.changePct, { sign: true }),
                  d.previousYear,
                )}
              </p>
            )}
            {d.year !== null && d.newestYear !== null && d.year < d.newestYear && (
              <p className={bandStyles.note}>{text.olderYear(d.year)}</p>
            )}
          </>
        ),
      };
    }
    case 'production_value': {
      const d = stat.detail;
      return {
        detail: (
          <>
            {d.year !== null && d.priceUsdPerOz !== null && (
              <p>{text.computedAt(d.year, formatPrice(d.priceUsdPerOz))}</p>
            )}
            <p className={bandStyles.note}>{text.computed}</p>
          </>
        ),
      };
    }
    case 'largest_producer':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((e, index) => (
              <li key={e.iso3}>
                {entity(index, e.iso3, e.name)}
                <span className={styles.sub}>
                  {stat.detail.sharePct !== null &&
                    text.shareOfTotal(formatPct(stat.detail.sharePct))}
                  {e.estimate && ` · ${text.estimate}`}
                </span>
              </li>
            ))}
          </ul>
        ),
      };
    case 'central_bank_gold': {
      const d = stat.detail;
      return {
        detail: (
          <>
            {d.valueUsd !== null && d.priceUsdPerOz !== null && (
              <p>{text.holdingsValue(formatUsd(d.valueUsd), formatPrice(d.priceUsdPerOz))}</p>
            )}
            <p className={bandStyles.sub}>
              {text.reporting(d.reporting)}
              {d.notCurrent > 0 && ` · ${text.notCurrent(d.notCurrent)}`}
            </p>
          </>
        ),
      };
    }
    case 'largest_holder':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((e, index) => (
              <li key={e.iso3}>
                {entity(index, e.iso3, e.name)}
                <span className={styles.sub}>
                  {formatUsd(e.valueUsd)}
                  {e.pctOfReserves !== null && ` · ${text.ofReserves(formatPct(e.pctOfReserves))}`}
                </span>
              </li>
            ))}
          </ul>
        ),
      };
    case 'gold_price': {
      const d = stat.detail;
      return {
        detail: (
          <>
            {d.month !== null && <p>{text.priceDetail(formatMonth(d.month))}</p>}
            {d.changePct !== null && (
              <p className={bandStyles.sub}>
                {text.vsYearAgo(formatPct(d.changePct, { sign: true }))}
              </p>
            )}
          </>
        ),
      };
    }
    case 'most_gold_dependent':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((e, index) => (
              <li key={e.iso3}>
                {entity(index, e.iso3, e.name)}
                <span className={styles.sub}>{text.ofExports(formatPct(e.pct), e.year)}</span>
              </li>
            ))}
          </ul>
        ),
      };
    case 'biggest_reporting_gap':
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((e, index) => (
              <li key={e.iso3}>
                {entity(index, e.iso3, e.name)}
                <span className={styles.sub}>
                  {text.gapDetail(formatUsd(e.mirrorUsd), formatUsd(e.reportedUsd), e.year)}
                </span>
                <span className={bandStyles.note}>{text.gapCaveat}</span>
              </li>
            ))}
          </ul>
        ),
      };
    case 'largest_net_buyer':
      if (stat.detail.noNetBuyer) return { detail: <p>{text.noNetBuyer}</p>, empty: true };
      return {
        detail: (
          <ul className={styles.entities}>
            {stat.entities.map((e, index) => (
              <li key={e.iso3}>
                {entity(index, e.iso3, e.name)}
                <span className={styles.sub}>
                  {text.netBuy(
                    formatMass(e.changeTonnes, unit, { sign: true }),
                    formatMonth(e.asOf),
                  )}
                </span>
              </li>
            ))}
          </ul>
        ),
      };
  }
}
