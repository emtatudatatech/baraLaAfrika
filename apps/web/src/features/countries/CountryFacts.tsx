import type { CountryFacts, Election, Leader } from '@bla/shared';

import { Icon } from '../../components/Icon/Icon';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './CountryFacts.module.css';
import { electionText } from './factsFormat';

/** "Election within 12 months" (highlighted), "No election within 12 months" or "No date set". */
export function ElectionStatusChip({ status }: { status: Election['status'] }) {
  return (
    <span
      className={cx(styles.chip, status === 'within_12_months' && styles.chipSoon)}
      data-status={status}
    >
      <Icon name="schedule" size={18} className={styles.chipIcon} />
      {strings.facts.electionStatus[status]}
    </span>
  );
}

/** The election that decides the executive, and its status. */
export function ElectionSummary({ election }: { election: Election | null }) {
  if (election === null) return <span className={styles.muted}>{strings.facts.noData}</span>;
  return (
    <span className={styles.stack}>
      <span>{electionText(election)}</span>
      {election.decides !== 'none' && <ElectionStatusChip status={election.status} />}
    </span>
  );
}

function LeaderBadges({ leader }: { leader: Leader }) {
  return (
    <>
      {leader.transitional && <span className={styles.badge}>{strings.facts.transitional}</span>}
      {leader.deFacto && <span className={styles.badge}>{strings.facts.deFacto}</span>}
    </>
  );
}

/**
 * The executive leader (title above the name), then the other office holder on a quieter line.
 * `compact` keeps the other office holder on one line for tight spaces (the map tooltip).
 */
export function LeaderSummary({
  facts,
  countryName,
  compact = false,
}: {
  facts: CountryFacts;
  countryName: string;
  compact?: boolean;
}) {
  const [executive, other] = facts.leaders;
  if (executive === undefined) {
    return <span className={styles.muted}>{strings.facts.leaderPending}</span>;
  }
  return (
    <span className={styles.stack}>
      <span className={styles.leader}>
        <span className={styles.title}>{executive.title}</span>
        <span className={styles.nameRow}>
          <span className={styles.name}>{executive.name}</span>
          <LeaderBadges leader={executive} />
          {!compact && facts.note !== null && (
            <FactsNote note={facts.note} countryName={countryName} />
          )}
        </span>
      </span>
      {other !== undefined && (
        <span className={styles.other}>
          {other.title} – {other.name}
          {(other.transitional || other.deFacto) && ' '}
          <LeaderBadges leader={other} />
        </span>
      )}
    </span>
  );
}

/** An "i" button whose tooltip explains a country's political context. */
function FactsNote({ note, countryName }: { note: string; countryName: string }) {
  const { triggerProps, tooltip } = useTooltip({ content: note });
  return (
    <>
      <button
        type="button"
        className={styles.noteButton}
        aria-label={strings.facts.noteLabel(countryName)}
        {...triggerProps}
      >
        <Icon name="info" size={18} />
      </button>
      {tooltip}
    </>
  );
}
