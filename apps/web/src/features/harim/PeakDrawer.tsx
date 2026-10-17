import type { CountryRef, Mountain } from '@bla/shared';
import { Link } from 'react-router';

import {
  Drawer,
  DrawerError,
  DrawerReview,
  DrawerSection,
  DrawerSkeleton,
  DrawerSources,
} from '../../components/Drawer/Drawer';
import { drawerStyles } from '../../components/Drawer/drawerStyles';
import { Icon } from '../../components/Icon/Icon';
import { api } from '../../lib/api';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation } from '../../lib/units';
import { useResource } from '../../lib/useResource';
import styles from './PeakDrawer.module.css';
import { ConfidenceBadge, CountryList, Height, HighPointBadge, UltraBadge } from './PeakBits';
import { isUltra, peakTypeLabel } from './peakFormat';

const text = strings.harim;
const labels = text.drawer;

export interface PeakDrawerProps {
  slug: string;
  /** The row already on screen, if any: shown at once while the full record loads. */
  preview: Mountain | undefined;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  onOpenPeak: (slug: string) => void;
  onClose: () => void;
}

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(3)}° ${value < 0 ? negative : positive}`;
}

/**
 * One mountain in the shared drawer: its height in metres and feet with the confidence and every
 * other sourced height, the facts, local names and name origin, and its sources.
 */
export function PeakDrawer({
  slug,
  preview,
  countries,
  unit,
  onOpenPeak,
  onClose,
}: PeakDrawerProps) {
  const detail = useResource(`mountain:${slug}`, () => api.mountain(slug));
  const full = detail.status === 'success' ? detail.data.mountain : undefined;
  const mountain: Mountain | undefined = full ?? preview;
  const loading = detail.status === 'loading';
  const firstCountry =
    mountain?.countries[0] === undefined ? undefined : countries.get(mountain.countries[0]);

  return (
    <Drawer
      title={mountain?.name ?? text.peaksLoading}
      subtitle={
        mountain && (
          <p className={styles.subtitle}>
            <CountryList
              iso3s={mountain.countries}
              countries={countries}
              territory={mountain.territory}
            />
            {mountain.highPointOf.length > 0 && <HighPointBadge />}
          </p>
        )
      }
      media={<Icon name="landscape" size={40} className={styles.media} />}
      accent={firstCountry ? `var(--region-${firstCountry.region.slug})` : 'var(--color-accent)'}
      testId="peak-drawer"
      onClose={onClose}
    >
      <Link to={`/harim/peaks/${slug}`} className={styles.fullPage} data-testid="peak-full-page">
        <Icon name="open_in_new" size={18} />
        {text.peakPage.openFull}
      </Link>

      {mountain?.needsReview && <DrawerReview notes={full?.reviewNotes ?? null} />}

      {detail.status === 'error' && <DrawerError error={detail.error} onRetry={detail.retry} />}

      {mountain && (
        <DrawerSection icon="altitude" title={labels.height}>
          <p className={styles.heightLine}>
            <Height metres={mountain.elevationM} unit={unit} both className={styles.bigHeight} />
            <ConfidenceBadge confidence={mountain.confidence} />
          </p>
          <p className={drawerStyles.meta}>{text.confidenceHint[mountain.confidence]}</p>
          {full ? (
            <>
              <p className={drawerStyles.meta} data-testid="elevation-source">
                {labels.elevationSource}:{' '}
                <a href={full.elevationSource.url} target="_blank" rel="noopener noreferrer">
                  {full.elevationSource.title}
                  <span className="visually-hidden"> {strings.drawer.newTab}</span>
                </a>
              </p>
              <h4 className={styles.subheading}>{labels.alternatives}</h4>
              {full.elevationAlternatives.length === 0 ? (
                <p className={drawerStyles.meta}>{labels.noAlternatives}</p>
              ) : (
                <ul className={styles.list} data-testid="elevation-alternatives">
                  {full.elevationAlternatives.map((alternative) => (
                    <li key={`${alternative.source.key}-${String(alternative.elevationM)}`}>
                      <span className={styles.figure}>
                        {formatElevation(alternative.elevationM, unit)}
                      </span>{' '}
                      <a href={alternative.source.url} target="_blank" rel="noopener noreferrer">
                        {alternative.source.title}
                        <span className="visually-hidden"> {strings.drawer.newTab}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            loading && <DrawerSkeleton count={2} />
          )}
        </DrawerSection>
      )}

      {mountain && (
        <DrawerSection icon="landscape" title={labels.facts}>
          <dl className={styles.facts}>
            <div>
              <dt>{labels.prominence}</dt>
              <dd>
                {mountain.prominenceM === null ? (
                  text.unknownProminence
                ) : (
                  <>
                    {formatElevation(mountain.prominenceM, unit)}{' '}
                    {isUltra(mountain.prominenceM) && <UltraBadge />}
                  </>
                )}
              </dd>
            </div>
            {mountain.isolationKm !== null && (
              <div>
                <dt>{labels.isolation}</dt>
                <dd>{labels.km(mountain.isolationKm)}</dd>
              </div>
            )}
            <div>
              <dt>{labels.coordinates}</dt>
              <dd className={styles.figure}>
                {coordinate(mountain.lat, 'N', 'S')}, {coordinate(mountain.lon, 'E', 'W')}
              </dd>
            </div>
            <div>
              <dt>{labels.range}</dt>
              <dd>{mountain.range?.name ?? text.unknown}</dd>
            </div>
            <div>
              <dt>{labels.type}</dt>
              <dd>{peakTypeLabel(mountain)}</dd>
            </div>
            {mountain.parent && (
              <div>
                <dt>{labels.massif}</dt>
                <dd>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => {
                      if (mountain.parent) onOpenPeak(mountain.parent.slug);
                    }}
                  >
                    {mountain.parent.name}
                  </button>
                </dd>
              </div>
            )}
            {mountain.summits.length > 0 && (
              <div>
                <dt>{labels.summits}</dt>
                <dd>
                  <ul className={styles.list}>
                    {mountain.summits.map((summit) => (
                      <li key={summit.slug}>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => {
                            onOpenPeak(summit.slug);
                          }}
                        >
                          {summit.name}
                        </button>{' '}
                        <span className={styles.figure}>
                          {formatElevation(summit.elevationM, unit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </DrawerSection>
      )}

      <DrawerSection icon="history_edu" title={labels.names}>
        {full ? (
          full.localNames.length === 0 && full.nameOrigin === null ? (
            <p className={drawerStyles.meta}>{labels.noNames}</p>
          ) : (
            <>
              {full.localNames.length > 0 && (
                <ul className={styles.list} aria-label={labels.localNames}>
                  {full.localNames.map((name) => (
                    <li key={`${name.language}-${name.name}`}>
                      <strong>{name.name}</strong>{' '}
                      <span className={styles.muted}>({name.language})</span>
                      {name.meaning !== null && <>: {name.meaning}</>}{' '}
                      <a href={name.source.url} target="_blank" rel="noopener noreferrer">
                        {name.source.title}
                        <span className="visually-hidden"> {strings.drawer.newTab}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {full.nameOrigin !== null && (
                <>
                  <h4 className={styles.subheading}>{labels.nameOrigin}</h4>
                  <p>{full.nameOrigin.text}</p>
                  <p className={drawerStyles.meta}>
                    {full.nameOrigin.source ? (
                      <a
                        href={full.nameOrigin.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {full.nameOrigin.source.title}
                        <span className="visually-hidden"> {strings.drawer.newTab}</span>
                      </a>
                    ) : (
                      <span className={styles.unsourced}>{labels.unsourced}</span>
                    )}
                  </p>
                </>
              )}
            </>
          )
        ) : (
          loading && <DrawerSkeleton count={2} />
        )}
      </DrawerSection>

      {full?.notes != null && (
        <DrawerSection icon="info" title={labels.notes}>
          <p>{full.notes}</p>
        </DrawerSection>
      )}

      <DrawerSection icon="info" title={labels.sources}>
        {full ? (
          <DrawerSources
            note={labels.sourcesNote}
            sources={full.sources.map((source) => ({
              key: source.key,
              title: source.title,
              url: source.url,
              reliabilityTier: source.reliabilityTier,
              usedFor: source.fields.map((field) => text.sourceFields[field]),
            }))}
          />
        ) : (
          loading && <DrawerSkeleton count={3} />
        )}
      </DrawerSection>
    </Drawer>
  );
}
