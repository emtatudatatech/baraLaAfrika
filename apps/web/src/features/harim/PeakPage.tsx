import type { CountryRef } from '@bla/shared';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { DrawerReview, DrawerSources } from '../../components/Drawer/Drawer';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { ApiRequestError, api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { formatElevation, otherUnit, useUnits } from '../../lib/units';
import { useResource } from '../../lib/useResource';
import { LocatorMap } from './LocatorMap';
import { ConfidenceBadge, HighPointBadge, UltraBadge } from './PeakBits';
import { isUltra, nearbyPeaks, peakTypeLabel } from './peakFormat';
import styles from './PeakPage.module.css';
import { useCopy } from './useCopy';

const text = strings.harim;
const page = text.peakPage;
const labels = text.drawer;

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
}

/**
 * `/harim/peaks/:slug` (spec 7.5.3): one mountain's full page: height with its confidence and
 * every sourced alternative, the facts, local names and name origin, a locator map, nearby
 * peaks and the sources.
 */
export function PeakPage() {
  const { slug = '' } = useParams();
  const [unit] = useUnits();
  const detail = useResource(`mountain:${slug}`, () => api.mountain(slug));
  const summary = useResource('mountains:summary', () => api.mountainSummary());
  const catalogue = useResource('mountains:all', () => api.mountains());
  const [linkState, copyLink] = useCopy();
  const [coordState, copyCoords] = useCopy();
  const countries = useMemo(
    () =>
      new Map<string, CountryRef>(
        (summary.data?.countries ?? []).map((row) => [row.country.iso3, row.country]),
      ),
    [summary.data],
  );
  const mountain = detail.status === 'success' ? detail.data.mountain : undefined;
  const nearby = useMemo(
    () => (mountain && catalogue.data ? nearbyPeaks(mountain, catalogue.data.mountains) : []),
    [mountain, catalogue.data],
  );

  if (detail.status === 'error') {
    const missing = detail.error instanceof ApiRequestError && detail.error.status === 404;
    return (
      <div className={cx('glass', styles.state)} role="alert">
        <title>{`${text.peakPage.notFound} · ${strings.site.name}`}</title>
        <Icon name="error" size={32} />
        <p>{missing ? page.notFound : page.loadError}</p>
        {!missing && <DevApiHint error={detail.error} />}
        <Link to="/harim?view=peaks" className={styles.back}>
          {page.back}
        </Link>
      </div>
    );
  }

  if (!mountain) {
    return (
      <div className={styles.page} aria-busy="true" data-testid="peak-page-loading">
        <span className={cx('skeleton', styles.skeletonTitle)} />
        <span className={cx('skeleton', styles.skeletonBlock)} />
      </div>
    );
  }

  const where =
    mountain.territory ??
    mountain.countries.map((iso3) => countries.get(iso3)?.name ?? iso3).join(', ');
  const title = `${mountain.name} · ${strings.pages.harim.title} · ${strings.site.name}`;
  const description = page.description(
    mountain.name,
    formatElevation(mountain.elevationM, 'm'),
    where,
  );
  const coordinates = `${mountain.lat.toFixed(5)}, ${mountain.lon.toFixed(5)}`;

  return (
    <article className={styles.page} data-testid="peak-page" data-slug={mountain.slug}>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={`${mountain.name} · Harim`} />
      <meta property="og:description" content={description} />

      <nav className={styles.crumbs} aria-label={page.kicker}>
        <Link to="/harim?view=peaks" className={styles.back}>
          <Icon name="arrow_downward" size={18} className={styles.backIcon} />
          {page.back}
        </Link>
      </nav>

      <header className={cx('glass', styles.hero)}>
        <p className={styles.kicker}>{page.kicker}</p>
        <h1 className={styles.title}>{mountain.name}</h1>
        <p className={styles.height}>
          <strong>{formatElevation(mountain.elevationM, unit)}</strong>
          <span>{formatElevation(mountain.elevationM, otherUnit(unit))}</span>
        </p>
        <div className={styles.heroMeta}>
          {mountain.territory !== null ? (
            <span>{text.map.territory(mountain.territory)}</span>
          ) : (
            mountain.countries.map((iso3) => {
              const country = countries.get(iso3);
              return (
                <Link key={iso3} to={`/harim?country=${iso3}`} className={styles.country}>
                  {country && (
                    <FlagImage
                      flag={country.flag}
                      countryName={country.name}
                      width={28}
                      decorative
                    />
                  )}
                  {country?.name ?? iso3}
                </Link>
              );
            })
          )}
          {mountain.range && (
            <Link to={`/harim/ranges/${mountain.range.slug}`} className={styles.chipLink}>
              <Icon name="landscape_2" size={18} />
              {mountain.range.name}
            </Link>
          )}
          {mountain.isVolcanic && (
            <span className={styles.volcano} data-testid="peak-volcanic">
              <Icon name="volcano" size={18} />
              {text.peakTypes.volcano} · {text.volcanicStatus[mountain.volcanicStatus ?? 'unknown']}
            </span>
          )}
          {mountain.highPointOf.length > 0 && <HighPointBadge />}
        </div>
        <button
          type="button"
          className={styles.copy}
          data-testid="peak-copy-link"
          onClick={() => {
            copyLink(window.location.href);
          }}
        >
          <Icon name="open_in_new" size={18} />
          {linkState === 'copied'
            ? page.copied
            : linkState === 'failed'
              ? page.copyFailed
              : page.copyLink}
        </button>
      </header>

      {mountain.needsReview && <DrawerReview notes={mountain.reviewNotes} />}

      <div className={styles.columns}>
        <section className={cx('glass', styles.card)} aria-labelledby="peak-height">
          <h2 id="peak-height" className={styles.cardTitle}>
            <Icon name="altitude" size={20} />
            {labels.height}
          </h2>
          <p className={styles.confidence}>
            <ConfidenceBadge confidence={mountain.confidence} />{' '}
            <span>{text.confidenceHint[mountain.confidence]}</span>
          </p>
          <p className={styles.meta}>
            {labels.elevationSource}:{' '}
            <a href={mountain.elevationSource.url} target="_blank" rel="noopener noreferrer">
              {mountain.elevationSource.title}
              <span className="visually-hidden"> {strings.drawer.newTab}</span>
            </a>
          </p>
          <h3 className={styles.subheading}>{labels.alternatives}</h3>
          {mountain.elevationAlternatives.length === 0 ? (
            <p className={styles.meta}>{labels.noAlternatives}</p>
          ) : (
            <ul className={styles.list} data-testid="peak-alternatives">
              {mountain.elevationAlternatives.map((alternative) => (
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
        </section>

        <section className={cx('glass', styles.card)} aria-labelledby="peak-facts">
          <h2 id="peak-facts" className={styles.cardTitle}>
            <Icon name="landscape" size={20} />
            {labels.facts}
          </h2>
          <dl className={styles.facts}>
            <div>
              <dt>{labels.prominence}</dt>
              <dd data-testid="peak-prominence">
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
            <div>
              <dt>{labels.isolation}</dt>
              <dd>
                {mountain.isolationKm === null ? text.unknown : labels.km(mountain.isolationKm)}
              </dd>
            </div>
            <div>
              <dt>{labels.coordinates}</dt>
              <dd>
                <span className={styles.figure}>
                  {coordinate(mountain.lat, 'N', 'S')}, {coordinate(mountain.lon, 'E', 'W')}
                </span>
                <button
                  type="button"
                  className={styles.inlineButton}
                  data-testid="peak-copy-coordinates"
                  onClick={() => {
                    copyCoords(coordinates);
                  }}
                >
                  {coordState === 'copied'
                    ? page.copied
                    : coordState === 'failed'
                      ? page.copyFailed
                      : page.copyCoordinates}
                </button>
              </dd>
            </div>
            <div>
              <dt>{labels.type}</dt>
              <dd>{peakTypeLabel(mountain)}</dd>
            </div>
            {mountain.parent && (
              <div>
                <dt>{labels.massif}</dt>
                <dd>
                  <Link to={`/harim/peaks/${mountain.parent.slug}`}>{mountain.parent.name}</Link>
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
                        <Link to={`/harim/peaks/${summit.slug}`}>{summit.name}</Link>{' '}
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
        </section>

        <section className={cx('glass', styles.card)} aria-labelledby="peak-names">
          <h2 id="peak-names" className={styles.cardTitle}>
            <Icon name="history_edu" size={20} />
            {labels.names}
          </h2>
          {mountain.localNames.length === 0 && mountain.nameOrigin === null ? (
            <p className={styles.meta} data-testid="peak-no-names">
              {labels.noNames}
            </p>
          ) : (
            <>
              {mountain.localNames.length > 0 && (
                <ul className={styles.list} aria-label={labels.localNames}>
                  {mountain.localNames.map((name) => (
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
              {mountain.nameOrigin !== null && (
                <>
                  <h3 className={styles.subheading}>{labels.nameOrigin}</h3>
                  <p>{mountain.nameOrigin.text}</p>
                  <p className={styles.meta}>
                    {mountain.nameOrigin.source ? (
                      <a
                        href={mountain.nameOrigin.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {mountain.nameOrigin.source.title}
                        <span className="visually-hidden"> {strings.drawer.newTab}</span>
                      </a>
                    ) : (
                      <span className={styles.unsourced}>{labels.unsourced}</span>
                    )}
                  </p>
                </>
              )}
            </>
          )}
          {mountain.notes !== null && (
            <>
              <h3 className={styles.subheading}>{labels.notes}</h3>
              <p>{mountain.notes}</p>
            </>
          )}
        </section>

        <section className={cx('glass', styles.card)} aria-labelledby="peak-where">
          <h2 id="peak-where" className={styles.cardTitle}>
            <Icon name="map" size={20} />
            {page.locator}
          </h2>
          <LocatorMap
            name={mountain.name}
            lon={mountain.lon}
            lat={mountain.lat}
            countryIso3s={mountain.countries}
            countries={countries}
          />
          <h3 className={styles.subheading}>{page.nearby}</h3>
          <p className={styles.meta}>{page.nearbyHint}</p>
          {catalogue.status === 'success' && nearby.length === 0 ? (
            <p className={styles.meta}>{page.noNearby}</p>
          ) : (
            <ul className={styles.nearby} data-testid="peak-nearby">
              {nearby.map((peak) => (
                <li key={peak.slug}>
                  <Link to={`/harim/peaks/${peak.slug}`}>{peak.name}</Link>
                  <span className={styles.figure}>{formatElevation(peak.elevationM, unit)}</span>
                  <span className={styles.muted}>{page.kmAway(peak.km)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={cx('glass', styles.card)} aria-labelledby="peak-sources">
        <h2 id="peak-sources" className={styles.cardTitle}>
          <Icon name="info" size={20} />
          {labels.sources}
        </h2>
        <DrawerSources
          note={labels.sourcesNote}
          sources={mountain.sources.map((source) => ({
            key: source.key,
            title: source.title,
            url: source.url,
            reliabilityTier: source.reliabilityTier,
            usedFor: source.fields.map((field) => text.sourceFields[field]),
          }))}
        />
      </section>
    </article>
  );
}
