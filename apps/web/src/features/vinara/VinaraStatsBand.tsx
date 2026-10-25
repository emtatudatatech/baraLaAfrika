import type { CountryRef, CountrySummary, RegionSlug, VinaraMetric } from '@bla/shared';
import { type ReactNode, useId } from 'react';

import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { electionDateText } from '../countries/factsFormat';
import styles from '../stats/StatsBand.module.css';
import { BandSkeleton, Definition, Flags, StatsCarousel } from '../stats/StatsParts';
import {
  type ElectionCalendar,
  contenderAhead,
  electionsSoon,
  gapsClosing,
  leadingRegion,
  mostTitles,
} from './vinaraSummary';
import pageStyles from './VinaraPage.module.css';

const text = strings.vinara.stats;
const shared = strings.statsBand;

interface Card {
  key: keyof typeof text.definitions;
  icon: IconName;
  value: number | null;
  unitWord: string;
  detail: ReactNode;
}

/**
 * The summary cards above the table: counts of what the rankings say (definitions in
 * docs/vinara-method.md). For Africa, the leading region too.
 */
export function VinaraStatsBand({
  metrics,
  region,
  regionName,
  calendar,
  states,
  countries,
  stale,
}: {
  metrics: readonly VinaraMetric[] | null;
  region: RegionSlug | null;
  regionName: string | null;
  calendar: ElectionCalendar | null;
  /** The states in scope. */
  states: readonly CountrySummary[];
  countries: ReadonlyMap<string, CountryRef>;
  stale: boolean;
}) {
  const titleId = useId();
  const isPhone = !useMediaQuery(minWidthQuery('md'));
  const cards = metrics === null ? null : buildCards(metrics, region, calendar, states, countries);
  return (
    <section className={styles.band} aria-labelledby={titleId} data-testid="vinara-stats-band">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {text.title}
        </h2>
        <span className={styles.scope}>
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
      </div>
      {cards === null ? (
        <BandSkeleton
          count={5}
          hero={0}
          heights={{ phone: '14rem', hero: '14rem', compact: '14rem' }}
        />
      ) : (
        <div
          className={pageStyles.bandGrid}
          style={{ '--band-columns': cards.length, '--band-compact-span': 1 }}
        >
          <StatsCarousel isPhone={isPhone} stale={stale} labels={cards.map((c) => text[c.key])}>
            {cards.map((card) => (
              <StatCard key={card.key} card={card} />
            ))}
          </StatsCarousel>
        </div>
      )}
    </section>
  );
}

function StatCard({ card }: { card: Card }) {
  const titleId = useId();
  const label = text[card.key];
  return (
    <article
      className={cx('glass', styles.card, styles.compact)}
      aria-labelledby={titleId}
      data-stat={card.key}
      data-testid="stat-card"
    >
      <header className={styles.cardHead}>
        <span className={styles.icon}>
          <Icon name={card.icon} size={20} />
        </span>
        <h3 id={titleId} className={styles.label}>
          {label}
        </h3>
        <Definition label={label} definition={text.definitions[card.key]} />
      </header>
      <p className={styles.value}>
        {card.value === null ? (
          <span aria-hidden="true">—</span>
        ) : (
          <>
            {card.value}
            <span className={styles.unit}> {card.unitWord}</span>
          </>
        )}
      </p>
      <div className={styles.detail}>{card.detail}</div>
    </article>
  );
}

function measureList(metrics: readonly VinaraMetric[], line: (m: VinaraMetric) => string) {
  if (metrics.length === 0) return <p>{text.none}</p>;
  return (
    <ul className={pageStyles.cardList}>
      {metrics.map((m) => (
        <li key={m.key}>{line(m)}</li>
      ))}
    </ul>
  );
}

function names(list: readonly { name: string }[]): string {
  return list.map((e) => e.name).join(', ');
}

function buildCards(
  metrics: readonly VinaraMetric[],
  region: RegionSlug | null,
  calendar: ElectionCalendar | null,
  states: readonly CountrySummary[],
  countries: ReadonlyMap<string, CountryRef>,
): Card[] {
  const total = metrics.length;
  const titles = mostTitles(metrics);
  const closing = gapsClosing(metrics);
  const ahead = contenderAhead(metrics);
  const cards: Card[] = [
    {
      key: 'mostTitles',
      icon: 'workspace_premium',
      value: titles?.count ?? null,
      unitWord: strings.vinara.of(total),
      detail:
        titles === null ? null : (
          <>
            <Flags
              iso3s={titles.holders.slice(0, titles.holders.length > 4 ? 3 : 4).map((h) => h.key)}
              countries={countries}
            />
            {titles.holders.length > 4 && (
              <p className={pageStyles.cardNote}>{text.andMore(titles.holders.length - 3)}</p>
            )}
            {titles.holders.length === 1 && (
              <p className={pageStyles.cardNote}>{titles.holders[0]?.measures.join(', ')}</p>
            )}
          </>
        ),
    },
  ];
  if (region === null) {
    const leading = leadingRegion(metrics);
    cards.push({
      key: 'leadingRegion',
      icon: 'public',
      value: leading?.count ?? null,
      unitWord: strings.vinara.of(total),
      detail:
        leading === null ? null : (
          <>
            <span className={pageStyles.chips}>
              {leading.holders.map((h) => (
                <RegionChip key={h.key} slug={h.key} name={h.name} />
              ))}
            </span>
            {leading.holders.length === 1 && (
              <p className={pageStyles.cardNote}>{leading.holders[0]?.measures.join(', ')}</p>
            )}
          </>
        ),
    });
  }
  cards.push(
    {
      key: 'gapsClosing',
      icon: 'compare_arrows',
      value: closing.length,
      unitWord: strings.vinara.of(total),
      detail: measureList(closing, (m) =>
        text.closingOn(m.name, names(m.contenders), names(m.cardinals)),
      ),
    },
    {
      key: 'contenderAhead',
      icon: 'swap_vert',
      value: ahead.length,
      unitWord: strings.vinara.of(total),
      detail: measureList(ahead, (m) => text.aheadOf(m.name, names(m.contenders), m.window.to)),
    },
  );
  const soon = calendar === null ? null : electionsSoon(calendar);
  const next = soon?.[0];
  const nextDate = next?.facts.election ? electionDateText(next.facts.election) : null;
  cards.push({
    key: 'electionsSoon',
    icon: 'how_to_vote',
    value: soon?.length ?? null,
    unitWord: text.ofStates(states.length),
    detail:
      next === undefined || nextDate === null ? (
        soon === null ? null : (
          <p>{text.none}</p>
        )
      ) : (
        <p>{text.next(next.name, nextDate)}</p>
      ),
  });
  return cards;
}
