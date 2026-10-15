import type { RegionSlug } from '@bla/shared';
import { useState } from 'react';
import { Link } from 'react-router';

import { useRegions } from '../../app/data/regionsContext';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/iconNames';
import { api } from '../../lib/api';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { AfricaMap } from './AfricaMap';
import styles from './HomePage.module.css';
import { MapLegend } from './MapLegend';

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

/** Landing page: the Equal Earth map of Africa, countries coloured by region (spec §7.1). */
export function HomePage() {
  const page = strings.pages.home;
  const { resource: regions } = useRegions();
  const countries = useResource('countries:all', () => api.countries());
  const [isolated, setIsolated] = useState<RegionSlug | null>(null);
  const regionList = regions.data?.regions ?? [];

  return (
    <>
      <title>{`${strings.site.name} · Explore Africa's symbols, mountains and gold`}</title>
      <section className={styles.intro} aria-labelledby="home-title">
        <p className={styles.kicker}>{page.kicker}</p>
        <h1 id="home-title" className={styles.title}>
          {page.title}
        </h1>
        <p className={styles.lead}>{page.lead}</p>
      </section>

      <section className={styles.hero} aria-label={strings.map.label}>
        <AfricaMap
          countries={countries.data?.countries}
          countriesFailed={countries.status === 'error'}
          onRetryCountries={countries.retry}
          isolatedRegion={isolated}
          regionOrder={regionList.map((r) => r.slug)}
          legend={
            regionList.length > 0 ? (
              <MapLegend regions={regionList} selected={isolated} onSelect={setIsolated} />
            ) : undefined
          }
        />
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
