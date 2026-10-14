import { Link } from 'react-router';

import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { strings } from '../../lib/strings';
import styles from './HomePage.module.css';

const SECTIONS: readonly { to: string; icon: IconName; title: string; description: string }[] = [
  {
    to: '/countries',
    icon: 'flag',
    title: strings.pages.countries.title,
    description: strings.pages.countries.description,
  },
  {
    to: '/harim',
    icon: 'landscape',
    title: strings.pages.harim.title,
    description: strings.pages.harim.description,
  },
  {
    to: '/dhahabu',
    icon: 'diamond',
    title: strings.pages.dhahabu.title,
    description: strings.pages.dhahabu.description,
  },
];

/** Landing page. The Equal Earth map of Africa fills this hero from milestone 5. */
export function HomePage() {
  const page = strings.pages.home;
  return (
    <>
      <title>{`${strings.site.name} · Explore Africa's symbols, mountains and gold`}</title>
      <section className={styles.hero} aria-labelledby="home-title">
        <p className={styles.kicker}>{page.kicker}</p>
        <h1 id="home-title" className={styles.title}>
          {page.title}
        </h1>
        <p className={styles.lead}>{page.lead}</p>
      </section>
      <section aria-label={page.explore}>
        <ul className={styles.sections}>
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <Link to={section.to} className={`glass ${styles.card}`}>
                <span className={styles.cardIcon}>
                  <Icon name={section.icon} size={24} />
                </span>
                <span className={styles.cardTitle}>{section.title}</span>
                <span className={styles.cardText}>{section.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
