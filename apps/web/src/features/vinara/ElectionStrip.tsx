import { useId } from 'react';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { ElectionStatusChip } from '../countries/CountryFacts';
import { electionDateText } from '../countries/factsFormat';
import type { ElectionCalendar } from './vinaraSummary';
import styles from './VinaraPage.module.css';

const text = strings.vinara.elections;

/**
 * The election calendar for the scope: the next election that decides the executive in each
 * state, soonest first, in a strip that scrolls inside itself; then the states without a date.
 */
export function ElectionStrip({
  calendar,
  regionName,
}: {
  calendar: ElectionCalendar;
  /** The region's name, or null for Africa. */
  regionName: string | null;
}) {
  const titleId = useId();
  const names = (list: ElectionCalendar['noDate']) => list.map((c) => c.name).join(', ');
  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid="vinara-elections">
      <div className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {text.title}
        </h2>
        <p className={styles.intro}>{text.intro(regionName)}</p>
      </div>
      {calendar.dated.length === 0 ? (
        <p className={styles.intro}>{text.none}</p>
      ) : (
        // A scrolling region must take focus so keyboard users can scroll it (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div className={styles.strip} role="region" aria-label={text.listLabel} tabIndex={0}>
          <ol className={styles.stripList}>
            {calendar.dated.map((country) => {
              const election = country.facts.election;
              if (election === null) return null;
              const soon = election.status === 'within_12_months';
              return (
                <li
                  key={country.iso3}
                  className={cx('glass', styles.election, soon && styles.electionSoon)}
                  data-iso3={country.iso3}
                  data-testid="vinara-election"
                >
                  <span className={styles.electionDate}>
                    <Icon name="how_to_vote" size={18} />
                    {electionDateText(election)}
                  </span>
                  <span className={styles.electionCountry}>
                    <FlagImage
                      flag={country.flag}
                      countryName={country.name}
                      width={24}
                      decorative
                    />
                    {country.name}
                  </span>
                  {election.kind !== null && (
                    <span className={styles.electionKind}>
                      {strings.facts.electionKinds[election.kind]}
                    </span>
                  )}
                  {soon && <ElectionStatusChip status={election.status} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {(calendar.noDate.length > 0 || calendar.noElections.length > 0) && (
        <div className={styles.stripNotes}>
          {calendar.noDate.length > 0 && <p>{text.noDate(names(calendar.noDate))}</p>}
          {calendar.noElections.length > 0 && (
            <p>{text.noElections(names(calendar.noElections))}</p>
          )}
        </div>
      )}
    </section>
  );
}
