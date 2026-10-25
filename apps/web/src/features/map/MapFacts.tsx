import type { CountrySummary } from '@bla/shared';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { ElectionSummary, LeaderSummary } from '../countries/CountryFacts';
import { areaText, populationText } from '../countries/factsFormat';
import styles from './MapFacts.module.css';

/**
 * A country's facts on the map: population, land area, leader and next election. The hover
 * tooltip shows them compactly; the popover (and the phone's bottom sheet) in full.
 */
export function MapFacts({
  country,
  variant,
}: {
  country: CountrySummary;
  variant: 'tooltip' | 'popover';
}) {
  const { facts } = country;
  const label = strings.popover;
  return (
    <dl
      className={cx(styles.facts, variant === 'tooltip' && styles.compact)}
      data-testid="map-facts"
    >
      <div>
        <dt>{label.population}</dt>
        <dd>{populationText(facts.population)}</dd>
      </div>
      <div>
        <dt>{label.area}</dt>
        <dd>{areaText(facts.landAreaKm2)}</dd>
      </div>
      <div>
        <dt>{label.leader}</dt>
        <dd>
          <LeaderSummary facts={facts} countryName={country.name} compact={variant === 'tooltip'} />
        </dd>
      </div>
      <div>
        <dt>{label.election}</dt>
        <dd>
          <ElectionSummary election={facts.election} />
        </dd>
      </div>
    </dl>
  );
}
