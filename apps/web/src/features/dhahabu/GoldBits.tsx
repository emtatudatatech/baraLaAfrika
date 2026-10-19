import type { GoldCountry, GoldUnit, PresenceTier } from '@bla/shared';

import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { formatMass, formatMonth, formatPct, formatPrice, formatUsd } from '../../lib/goldUnits';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './GoldBits.module.css';
import { tierColour } from './goldStats';

/*
 * The figures of the gold table and cards. Every figure shows its own year or date; "no data"
 * (—), a reported zero (0) and "included in other countries" look different; computed values say
 * so; mirror (partner-reported) trade is labelled.
 */

const text = strings.dhahabu;

const TIER_ICONS: Record<PresenceTier, IconName> = {
  major_producer: 'workspace_premium',
  producer: 'diamond',
  occurrences_known: 'explore',
  none_identified: 'remove',
  unknown: 'help',
};

/** The presence tier, with its evidence (basis, confidence, year, source) on hover, focus or tap. */
export function PresenceBadge({ row }: { row: GoldCountry }) {
  const { presence } = row;
  const tip = useTooltip({
    content: (
      <span className={styles.tip}>
        <strong>{text.evidenceFor(row.country.name)}</strong>
        <span>{presence.basis}</span>
        <span className={styles.tipMeta}>
          {text.confidence[presence.confidence]}
          {presence.asOfYear !== null && ` · ${text.asOfYear(presence.asOfYear)}`}
        </span>
        {presence.source && (
          <span className={styles.tipMeta}>
            {text.source}: {presence.source.title}
          </span>
        )}
        {presence.needsReview && presence.reviewNotes && (
          <span className={styles.tipMeta}>
            {text.needsReview}: {presence.reviewNotes}
          </span>
        )}
      </span>
    ),
  });
  return (
    <>
      <button
        type="button"
        className={cx(styles.badge, presence.tier === 'unknown' && styles.badgeUnknown)}
        style={{ '--tier': tierColour(presence.tier) }}
        data-tier={presence.tier}
        data-testid="presence-badge"
        {...tip.triggerProps}
      >
        <span className={styles.badgeSwatch} aria-hidden="true">
          <Icon name={TIER_ICONS[presence.tier]} size={18} />
        </span>
        <span>{text.presence[presence.tier]}</span>
        {presence.needsReview && (
          <span className={styles.review}>
            <Icon name="info" size={18} />
            <span className="visually-hidden">{text.needsReview}</span>
          </span>
        )}
      </button>
      {tip.tooltip}
    </>
  );
}

function NoData() {
  return (
    <span className={styles.none}>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{text.noData}</span>
    </span>
  );
}

function Hint({ label, hint }: { label: string; hint: string }) {
  const tip = useTooltip({ content: <span className={styles.tip}>{hint}</span> });
  return (
    <>
      <button type="button" className={styles.hint} {...tip.triggerProps}>
        {label}
      </button>
      {tip.tooltip}
    </>
  );
}

/** Mine production: tonnes (in the chosen unit), its year, and the computed value. */
export function ProductionFigure({ row, unit }: { row: GoldCountry; unit: GoldUnit }) {
  const p = row.production;
  if (p === null) return <NoData />;
  if (p.tonnes === null) {
    return (
      <span className={styles.figure}>
        <Hint label={text.includedInOther} hint={text.includedInOtherHint} />
        <span className={styles.meta}>{p.year}</span>
      </span>
    );
  }
  return (
    <span className={styles.figure}>
      <span className={styles.value}>
        {formatMass(p.tonnes, unit)}
        {p.basis === 'estimate' && (
          <>
            {' '}
            <Hint label={text.estimate} hint={text.estimateHint} />
          </>
        )}
      </span>
      <span className={styles.meta}>
        {p.year}
        {p.valueUsd !== null && p.priceUsdPerOz !== null && (
          <>
            {' · '}
            <Hint
              label={text.valueComputed(formatUsd(p.valueUsd))}
              hint={text.computedHint(formatPrice(p.priceUsdPerOz), p.year)}
            />
          </>
        )}
      </span>
    </span>
  );
}

/** Gold exports as reported (value, weight, year); partners' figure when the country has none. */
export function ExportsFigure({ row, unit }: { row: GoldCountry; unit: GoldUnit }) {
  const { reported, mirror } = row.exports;
  if (reported === null) {
    if (mirror === null) return <NoData />;
    return (
      <span className={styles.figure}>
        <NoData />
        <span className={styles.meta}>
          <Hint
            label={text.partnersReport(formatUsd(mirror.valueUsd), mirror.year)}
            hint={text.mirrorHint(mirror.partnerCount ?? 0)}
          />
        </span>
      </span>
    );
  }
  return (
    <span className={styles.figure}>
      <span className={styles.value}>{formatUsd(reported.valueUsd)}</span>
      <span className={styles.meta}>
        {reported.netWeightKg === null
          ? text.weightNotReported
          : formatMass(reported.netWeightKg / 1000, unit)}
        {' · '}
        {reported.year}
      </span>
    </span>
  );
}

/** Central bank holdings: tonnes, value, share of reserves, 12-month change, month. */
export function HoldingsFigure({ row, unit }: { row: GoldCountry; unit: GoldUnit }) {
  const h = row.holdings;
  const reporting = row.reporting;
  if (h === null) {
    if (reporting === null) return <NoData />;
    return (
      <span className={styles.figure}>
        <NoData />
        <span className={styles.meta}>
          <Hint label={text.reporting[reporting.status]} hint={reporting.note} />
        </span>
      </span>
    );
  }
  const late =
    reporting !== null && (reporting.status === 'late' || reporting.status === 'stale')
      ? reporting
      : null;
  return (
    <span className={styles.figure}>
      <span className={styles.value}>{formatMass(h.tonnes, unit)}</span>
      <span className={styles.meta}>
        {formatUsd(h.valueUsd)}
        {h.pctOfReserves !== null && ` · ${text.ofReserves(formatPct(h.pctOfReserves))}`}
      </span>
      <span className={styles.meta}>
        {late ? <Hint label={formatMonth(h.asOf)} hint={late.note} /> : formatMonth(h.asOf)}
        {h.change12mTonnes !== null &&
          h.change12mTonnes !== 0 &&
          ` · ${text.change12m(formatMass(h.change12mTonnes, unit, { sign: true }))}`}
      </span>
    </span>
  );
}

/** Gold's share of merchandise exports, both parts from the same year. */
export function ShareFigure({ row }: { row: GoldCountry }) {
  const s = row.exportShare;
  if (s === null) return <NoData />;
  if (s.pct === null) {
    return (
      <span className={styles.figure}>
        <Hint label={text.exceedsTotal} hint={text.exceedsTotalHint} />
        <span className={styles.meta}>{s.year}</span>
      </span>
    );
  }
  return (
    <span className={styles.figure}>
      <span className={styles.value}>{formatPct(s.pct)}</span>
      <span className={styles.meta}>{s.year}</span>
    </span>
  );
}
