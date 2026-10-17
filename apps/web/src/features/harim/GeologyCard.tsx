import { useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from './GeologyCard.module.css';

const text = strings.harim.geology;

/**
 * "Why are Africa's highest mountains where they are?" (spec 7.5): the prototype's notes,
 * corrected and checked against the cited articles. Open on larger screens, collapsed on phones.
 */
export function GeologyCard() {
  const [open, setOpen] = useState(() => window.matchMedia(minWidthQuery('md')).matches);
  return (
    <details
      className={cx('glass', styles.card)}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      data-testid="harim-geology"
    >
      <summary className={styles.summary}>
        <Icon name="landscape_2" size={24} className={styles.icon} />
        <span className={styles.title}>{text.title}</span>
        <Icon name="keyboard_arrow_down" className={styles.chevron} />
      </summary>
      <div className={styles.body}>
        <p className={styles.intro}>{text.intro}</p>
        <ul className={styles.points}>
          {text.points.map((point) => (
            <li key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </li>
          ))}
        </ul>
        <p className={styles.sources}>
          {text.sourcesNote}{' '}
          {text.sources.map((source, index) => (
            <span key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
                <span className="visually-hidden"> {strings.a11y.externalLink}</span>
              </a>
              {index < text.sources.length - 1 ? ', ' : '.'}
            </span>
          ))}
        </p>
      </div>
    </details>
  );
}
