import { strings } from '../../lib/strings';
import { CREDITS } from '../credits';
import styles from './SiteFooter.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`glass ${styles.inner}`}>
        <h2 className={styles.heading}>{strings.footer.creditsHeading}</h2>
        <ul className={styles.credits}>
          {CREDITS.map((credit) => {
            const external = credit.href.startsWith('http');
            return (
              <li key={credit.name}>
                <a
                  href={credit.href}
                  {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                >
                  {credit.name}
                  {external && (
                    <span className="visually-hidden"> {strings.a11y.externalLink}</span>
                  )}
                </a>
                <span className={styles.licence}>{credit.licence}</span>
                {credit.note !== undefined && <span className={styles.note}>{credit.note}</span>}
              </li>
            );
          })}
        </ul>
        <p className={styles.disclaimer}>{strings.footer.disclaimer}</p>
        <p className={styles.disclaimer}>{strings.footer.notAdvice}</p>
      </div>
    </footer>
  );
}
