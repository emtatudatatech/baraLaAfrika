import type { CountrySummary } from '@bla/shared';

import { AnimalStatusBadge } from '../../components/AnimalStatusBadge/AnimalStatusBadge';
import {
  Drawer,
  DrawerDetail,
  DrawerError,
  DrawerReview,
  DrawerSection,
  DrawerSkeleton,
  DrawerSources,
} from '../../components/Drawer/Drawer';
import { drawerStyles } from '../../components/Drawer/drawerStyles';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { api } from '../../lib/api';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { territoryNote } from '../map/territoryNotes';
import styles from './CountryDrawer.module.css';

export interface CountryDrawerProps {
  /** The summary already on screen; the full profile is fetched on open. */
  country: CountrySummary;
  onClose: () => void;
}

/** Full country profile in the shared drawer (side panel; bottom sheet on phones). */
export function CountryDrawer({ country, onClose }: CountryDrawerProps) {
  const detail = useResource(`country:${country.iso3}`, () => api.country(country.iso3));
  const full = detail.status === 'success' ? detail.data.country : undefined;
  const note = territoryNote(country.iso3);
  const loading = detail.status === 'loading';

  return (
    <Drawer
      title={country.name}
      media={
        <FlagImage flag={country.flag} countryName={country.name} width={72} loading="eager" />
      }
      subtitle={
        <>
          {country.officialName !== null && (
            <p className={styles.official}>
              <span className="visually-hidden">{strings.drawer.officialName}: </span>
              {country.officialName}
            </p>
          )}
          <RegionChip slug={country.region.slug} name={country.region.name} />
        </>
      }
      accent={`var(--region-${country.region.slug})`}
      testId="country-drawer"
      onClose={onClose}
    >
      {note !== undefined && <p className={styles.territory}>{note}</p>}

      {country.needsReview && <DrawerReview notes={full?.reviewNotes ?? null} />}

      {detail.status === 'error' && <DrawerError error={detail.error} onRetry={detail.retry} />}

      <DrawerSection icon="history_edu" title={strings.drawer.meaning}>
        <p className={drawerStyles.lead}>{country.etymologySummary}</p>
        <DrawerDetail loading={loading} text={full?.etymologyDetail} />
        {country.etymologyCategory !== null && (
          <p className={drawerStyles.meta}>
            {strings.drawer.category}: {strings.etymologyCategory[country.etymologyCategory]}
          </p>
        )}
      </DrawerSection>

      <DrawerSection icon="flag" title={strings.drawer.flag}>
        <p className={drawerStyles.lead}>{country.flagDesignSummary}</p>
        {country.flagDesignDetail !== null && <p>{country.flagDesignDetail}</p>}
      </DrawerSection>

      <DrawerSection icon="workspace_premium" title={strings.drawer.symbol}>
        <p className={drawerStyles.lead}>{country.nationalSymbolSummary}</p>
        <DrawerDetail loading={loading} text={full?.nationalSymbolDetail} />
      </DrawerSection>

      <DrawerSection icon="pets" title={strings.drawer.animal}>
        <p className={drawerStyles.lead}>
          {country.nationalAnimalName}
          {full?.nationalAnimalScientific != null && (
            <>
              {' '}
              <i className={styles.scientific}>({full.nationalAnimalScientific})</i>
            </>
          )}{' '}
          <AnimalStatusBadge status={country.animalStatus} />
        </p>
        <p className={drawerStyles.meta}>{strings.animalStatusHint[country.animalStatus]}</p>
        <DrawerDetail loading={loading} text={full?.nationalAnimalDetail} />
      </DrawerSection>

      <DrawerSection icon="info" title={strings.drawer.sources}>
        {full ? (
          <DrawerSources
            note={strings.drawer.sourcesNote}
            sources={full.sources.map((source) => ({
              key: source.key,
              title: source.title,
              url: source.url,
              reliabilityTier: source.reliabilityTier,
              refNo: source.refNo,
              usedFor: source.fields.map((field) => strings.profileField[field]),
            }))}
          />
        ) : (
          loading && <DrawerSkeleton count={3} />
        )}
      </DrawerSection>
    </Drawer>
  );
}
