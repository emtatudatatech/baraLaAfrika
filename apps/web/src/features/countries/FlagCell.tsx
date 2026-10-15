import type { CountrySummary } from '@bla/shared';

import { FlagImage } from '../../components/FlagImage/FlagImage';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { strings } from '../../lib/strings';
import styles from './FlagCell.module.css';

export interface FlagCellProps {
  country: CountrySummary;
  width: number;
}

/**
 * The flag as a focusable control. Hover and keyboard focus show the research document's flag
 * text (summary, then the fuller description); a tap toggles it (no hover-only affordance).
 * The text is linked with aria-describedby, Escape dismisses it, and it is kept in the viewport.
 */
export function FlagCell({ country, width }: FlagCellProps) {
  const tip = useTooltip({
    content: (
      <span className={styles.tip}>
        <strong>{country.flagDesignSummary}</strong>
        {country.flagDesignDetail !== null && <span>{country.flagDesignDetail}</span>}
      </span>
    ),
  });
  const { onClick, ...triggerProps } = tip.triggerProps;
  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-label={strings.countries.flagButton(country.name)}
        {...triggerProps}
        onClick={(event) => {
          // The flag has its own action: it must not also open the row's drawer.
          event.stopPropagation();
          onClick();
        }}
        data-testid="flag-button"
      >
        <FlagImage flag={country.flag} countryName={country.name} width={width} />
      </button>
      {tip.tooltip}
    </>
  );
}
