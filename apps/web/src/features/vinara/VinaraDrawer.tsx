import type { CountrySummary, VinaraCountryMeasure, VinaraCountryResponse } from '@bla/shared';
import { Link } from 'react-router';

import { Drawer, DrawerError, DrawerSection, DrawerSkeleton } from '../../components/Drawer/Drawer';
import { drawerStyles } from '../../components/Drawer/drawerStyles';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { api } from '../../lib/api';
import { formatMonth } from '../../lib/goldUnits';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { ElectionSummary, LeaderSummary } from '../countries/CountryFacts';
import { ordinal } from './charts/vinaraChart';
import { METRIC_ICONS } from './metricIcons';
import { formatMoney, formatVinaraValue, formatWindow } from './vinaraFormat';
import styles from './VinaraDrawer.module.css';

const text = strings.vinara.drawer;

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const day = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * The state's drawer on /vinara (?country=): its figure and rank on every measure over the
 * page's years, its leaders and next election, context figures, who its public external debt is
 * owed to, and its currency.
 */
export function VinaraDrawer({
  country,
  from,
  to,
  onClose,
}: {
  country: CountrySummary;
  from: number | undefined;
  to: number | undefined;
  onClose: () => void;
}) {
  const detail = useResource(
    `vinara-country:${country.iso3}:${String(from ?? '')}:${String(to ?? '')}`,
    () => api.vinaraCountry({ iso3: country.iso3, from, to }),
  );
  const data = detail.status === 'success' ? detail.data : undefined;

  return (
    <Drawer
      title={country.name}
      media={
        <FlagImage flag={country.flag} countryName={country.name} width={72} loading="eager" />
      }
      subtitle={<RegionChip slug={country.region.slug} name={country.region.name} />}
      accent={`var(--region-${country.region.slug})`}
      testId="vinara-drawer"
      onClose={onClose}
    >
      <p className={styles.profileLink}>
        <Icon name="public" size={20} />
        <Link to={`/countries?country=${country.iso3}`} data-testid="vinara-drawer-profile">
          {text.profile}
        </Link>
      </p>
      {detail.status === 'error' && <DrawerError error={detail.error} onRetry={detail.retry} />}

      <DrawerSection icon="military_tech" title={text.measures}>
        {data === undefined ? <DrawerSkeleton count={6} /> : <Measures data={data} />}
      </DrawerSection>

      <DrawerSection icon="how_to_vote" title={text.leaders}>
        <div className={styles.facts}>
          <LeaderSummary facts={country.facts} countryName={country.name} />
          <ElectionSummary election={country.facts.election} />
        </div>
      </DrawerSection>

      {data !== undefined && data.context.length > 0 && (
        <DrawerSection icon="analytics" title={text.context}>
          <dl className={styles.context}>
            {data.context.map((figure) => (
              <div key={figure.key}>
                <dt>{figure.name}</dt>
                <dd>
                  {formatVinaraValue(
                    { key: 'population', unit: figure.unit, decimals: figure.decimals },
                    figure.value,
                  )}
                  <span className={styles.muted}> · {figure.year}</span>
                  {figure.estimate && (
                    <span className={styles.badge}>{strings.vinara.table.estimate}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </DrawerSection>
      )}

      {data !== undefined && <Debt data={data} />}
      {data !== undefined && <Currency data={data} />}

      <p className={drawerStyles.meta}>{text.source}</p>
    </Drawer>
  );
}

function rankText(m: VinaraCountryMeasure, regionName: string): string[] {
  if (m.rankAfrica === null) return [];
  const lines = [text.rankAfrica(ordinal(m.rankAfrica), m.rankedAfrica)];
  if (m.rankRegion !== null) {
    lines.push(text.rankRegion(ordinal(m.rankRegion), m.rankedRegion, regionName));
  }
  return lines;
}

function Measures({ data }: { data: VinaraCountryResponse }) {
  return (
    <ul className={styles.measures} data-testid="vinara-drawer-measures">
      {data.measures.map((m) => {
        const leads = m.rankAfrica === 1 || m.rankRegion === 1;
        return (
          <li key={m.key} data-metric={m.key} data-testid="vinara-drawer-measure">
            <span className={styles.measureIcon} aria-hidden="true">
              <Icon name={METRIC_ICONS[m.key]} size={18} />
            </span>
            <div className={styles.measureBody}>
              <span className={styles.measureName}>
                {m.name}
                <span className={styles.muted}> · {formatWindow(m.window)}</span>
              </span>
              {m.value === null ? (
                <span className={styles.muted}>
                  {text.notRanked}: {m.unrankedReason}
                </span>
              ) : (
                <>
                  <span className={styles.value}>
                    {formatVinaraValue(m, m.value)}
                    {m.kind === 'level' && m.year !== null && (
                      <span className={styles.muted}> · {m.year}</span>
                    )}
                    {m.estimate && (
                      <span className={styles.badge}>{strings.vinara.table.estimate}</span>
                    )}
                  </span>
                  <span className={leads ? styles.rankLead : styles.rank}>
                    {rankText(m, data.country.region.name).join(' · ')}
                  </span>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Debt({ data }: { data: VinaraCountryResponse }) {
  const { debt } = data;
  if (debt === null) {
    return (
      <DrawerSection icon="account_balance" title={text.debt(null)}>
        <p className={styles.muted}>{text.noDebt}</p>
      </DrawerSection>
    );
  }
  return (
    <DrawerSection icon="account_balance" title={text.debt(debt.year)}>
      <p className={styles.muted}>{text.debtTotal(formatMoney(debt.totalUsd, 'US$'))}</p>
      <ul className={styles.creditors} data-testid="vinara-drawer-creditors">
        {debt.creditors.map((c) => (
          <li key={`${c.kind}:${c.name}`}>
            <span className={styles.creditorName}>
              {c.name}
              <span className={styles.muted}> · {text.creditorKinds[c.kind]}</span>
            </span>
            <span className={styles.creditorValue}>
              {formatMoney(c.amountUsd, 'US$')} · {c.sharePct.toFixed(1)}%
            </span>
            {/* Decorative: the share is written beside it. */}
            <span className={styles.creditorBar} aria-hidden="true">
              <span style={{ width: `${String(Math.max(1, c.sharePct))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {debt.othersUsd > 0 && (
        <p className={styles.muted}>{text.debtOthers(formatMoney(debt.othersUsd, 'US$'))}</p>
      )}
    </DrawerSection>
  );
}

function Currency({ data }: { data: VinaraCountryResponse }) {
  const { currency } = data;
  if (currency === null) return null;
  const lines: string[] = [];
  if (currency.unionName !== null) lines.push(text.union(currency.unionName));
  lines.push(
    currency.peg === null
      ? text.noPeg
      : text.peg(
          new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(currency.peg.parity),
          currency.peg.anchor,
          day(currency.peg.since),
        ),
  );
  if (currency.daily !== null) {
    lines.push(
      text.daily(currency.daily.source, day(currency.daily.first), day(currency.daily.last)),
    );
    if (currency.daily.basis === 'derived') lines.push(text.derived);
  } else {
    lines.push(text.monthlyOnly);
  }
  if (currency.monthly !== null) {
    const month =
      currency.monthly.lastMonth === null ? '' : formatMonth(currency.monthly.lastMonth);
    const { status } = currency.monthly;
    lines.push(status === 'none' ? text.monthly.none() : text.monthly[status](month));
  }
  return (
    <DrawerSection icon="currency_exchange" title={`${text.currency}: ${currency.code}`}>
      <ul className={styles.currency} data-testid="vinara-drawer-currency">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </DrawerSection>
  );
}
