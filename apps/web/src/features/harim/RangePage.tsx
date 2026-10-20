import type { CountryRef } from '@bla/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { ApiRequestError, api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { formatElevation, useUnits } from '../../lib/units';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { type PeakSort, sortPeaks } from './harimQuery';
import { type HarimMapHandle, HarimMap } from './map/HarimMap';
import { toMapPeak } from './map/mapModel';
import type { PeakLinks } from './peakLinks';
import { PeakList } from './PeakList';
import { PeaksTable } from './PeaksTable';
import { rangeIcon, rangeTypeLabel } from './rangeFormat';
import styles from './RangePage.module.css';

const text = strings.harim;
const page = text.rangePage;

/**
 * `/harim/ranges/:slug` (spec 7.5.2): a range's sourced description and formation note
 * ("needs verification" where unsourced), a map fitted to its peaks, its peaks table and links to
 * the countries it spans.
 */
export function RangePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [unit] = useUnits();
  const isLg = useMediaQuery(minWidthQuery('lg'));
  const resource = useResource(`range:${slug}`, () => api.range(slug));
  const summary = useResource('mountains:summary', () => api.mountainSummary());
  const countries = useMemo(
    () =>
      new Map<string, CountryRef>(
        (summary.data?.countries ?? []).map((row) => [row.country.iso3, row.country]),
      ),
    [summary.data],
  );
  const range = resource.status === 'success' ? resource.data.range : undefined;
  const [sort, setSort] = useState<PeakSort>('height');
  const mountains = useMemo(() => (range ? sortPeaks(range.mountains, sort) : []), [range, sort]);
  const mapPeaks = useMemo(() => (range ? range.mountains.map(toMapPeak) : []), [range]);

  const mapRef = useRef<HarimMapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const onMapReady = useCallback(() => {
    setMapReady(true);
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const mapSlotRef = useRef<HTMLDivElement>(null);

  // The map opens fitted to the range's mountains.
  useEffect(() => {
    if (mapReady && mapPeaks.length > 0)
      mapRef.current?.fitPeaks(
        mapPeaks.map((p) => p.slug),
        8,
      );
  }, [mapReady, mapPeaks]);

  const openPeak = (peakSlug: string) => {
    void navigate(`/harim/peaks/${peakSlug}`);
  };
  const links: PeakLinks = {
    selected,
    onHover: setHovered,
    onShowOnMap: (peakSlug) => {
      setSelected(peakSlug);
      mapRef.current?.focusPeak(peakSlug);
      mapSlotRef.current?.scrollIntoView({ block: 'start' });
    },
    onShowCountryOnMap: () => undefined,
  };
  const showInTable = (peakSlug: string) => {
    setSelected(peakSlug);
    const row = document.querySelector(`#range-peaks [data-slug="${CSS.escape(peakSlug)}"]`);
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector<HTMLElement>('button:not([data-testid="show-on-map"])')?.focus({
      preventScroll: true,
    });
  };

  if (resource.status === 'error') {
    const missing = resource.error instanceof ApiRequestError && resource.error.status === 404;
    return (
      <div className={cx('glass', styles.state)} role="alert">
        <title>{`${page.notFound} · ${strings.site.name}`}</title>
        <Icon name="error" size={32} />
        <p>{missing ? page.notFound : page.loadError}</p>
        {!missing && <DevApiHint error={resource.error} />}
        <Link to="/harim?view=ranges">{page.back}</Link>
      </div>
    );
  }
  if (!range) {
    return (
      <div className={styles.page} aria-busy="true">
        <span className={cx('skeleton', styles.skeletonTitle)} />
        <span className={cx('skeleton', styles.skeletonBlock)} />
      </div>
    );
  }

  const tint = range.tintRegion ? `var(--region-${range.tintRegion})` : 'var(--color-line-strong)';
  const hasText = range.description !== null || range.formationNote !== null;
  const description =
    range.description ?? `${range.name}: ${strings.harim.mountainCount(range.peakCount)}.`;

  return (
    <article className={styles.page} data-testid="range-page" data-slug={range.slug}>
      <title>{`${range.name} · ${strings.pages.harim.title} · ${strings.site.name}`}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={`${range.name} · Harim`} />
      <meta property="og:description" content={description} />

      <nav aria-label={page.kicker}>
        <Link to="/harim?view=ranges" className={styles.back}>
          <Icon name="arrow_downward" size={18} className={styles.backIcon} />
          {page.back}
        </Link>
      </nav>

      <header className={cx('glass', styles.hero)} style={{ '--tint': tint }}>
        <p className={styles.kicker}>
          <Icon name={rangeIcon(range.rangeType)} size={18} />
          {page.kicker}
          {range.rangeType !== null && ` · ${rangeTypeLabel(range.rangeType)}`}
        </p>
        <h1 className={styles.title}>{range.name}</h1>
        {range.needsReview && (
          <p className={styles.unsourced} data-testid="range-needs-review">
            {page.unsourced}
          </p>
        )}
      </header>

      <div className={styles.columns}>
        <section className={cx('glass', styles.card)} aria-labelledby="range-about">
          <h2 id="range-about" className={styles.cardTitle}>
            <Icon name="history_edu" size={20} />
            {page.about}
          </h2>
          {hasText ? (
            <>
              {range.description !== null && (
                <p data-testid="range-description">{range.description}</p>
              )}
              {range.formationNote !== null && (
                <>
                  <h3 className={styles.subheading}>{page.formation}</h3>
                  <p>{range.formationNote}</p>
                </>
              )}
              {range.source && (
                <p className={styles.meta}>
                  {page.source}:{' '}
                  <a href={range.source.url} target="_blank" rel="noopener noreferrer">
                    {range.source.title}
                    <span className="visually-hidden"> {strings.drawer.newTab}</span>
                  </a>
                </p>
              )}
            </>
          ) : (
            <p className={styles.meta}>{page.noText}</p>
          )}
        </section>

        <section className={cx('glass', styles.card)} aria-labelledby="range-facts">
          <h2 id="range-facts" className={styles.cardTitle}>
            <Icon name="landscape" size={20} />
            {page.facts}
          </h2>
          <dl className={styles.facts}>
            <div>
              <dt>{page.type}</dt>
              <dd>{rangeTypeLabel(range.rangeType)}</dd>
            </div>
            {range.lengthKm !== null && (
              <div>
                <dt>{page.length}</dt>
                <dd>{page.km(range.lengthKm)}</dd>
              </div>
            )}
            <div>
              <dt>{page.mountains}</dt>
              <dd>{range.peakCount}</dd>
            </div>
            {range.tallest && (
              <div>
                <dt>{page.tallest}</dt>
                <dd>
                  <Link to={`/harim/peaks/${range.tallest.slug}`}>{range.tallest.name}</Link>{' '}
                  <span className={styles.figure}>
                    {formatElevation(range.tallest.elevationM, unit)}
                  </span>
                </dd>
              </div>
            )}
          </dl>
          <h3 className={styles.subheading}>{page.countryLinks}</h3>
          <ul className={styles.countries}>
            {range.countries.map((iso3) => {
              const country = countries.get(iso3);
              const name = country?.name ?? iso3;
              return (
                <li key={iso3}>
                  {country && (
                    <FlagImage flag={country.flag} countryName={name} width={28} decorative />
                  )}
                  <Link to={`/harim?country=${iso3}`}>{page.countryMountains(name)}</Link>
                  <Link to={`/countries?country=${iso3}`} className={styles.muted}>
                    {text.countryProfile}
                    <span className="visually-hidden">: {name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div ref={mapSlotRef} className={styles.mapSlot}>
        <HarimMap
          handleRef={mapRef}
          peaks={mapPeaks}
          total={mapPeaks.length}
          countries={countries}
          region={null}
          country={null}
          unit={unit}
          highlighted={hovered}
          selected={selected}
          onSelect={setSelected}
          onOpenPeak={openPeak}
          onShowInTable={showInTable}
          onReady={onMapReady}
          tableId="range-peaks"
        />
      </div>

      <section id="range-peaks" className={styles.peaks} aria-labelledby="range-peaks-title">
        <h2 id="range-peaks-title" className={styles.sectionTitle}>
          {page.peaksTitle}
        </h2>
        {isLg ? (
          <div className={cx('glass glass--strong', styles.panel)}>
            <PeaksTable
              mountains={mountains}
              sort={sort}
              onSort={setSort}
              countries={countries}
              unit={unit}
              onOpenPeak={openPeak}
              links={links}
            />
          </div>
        ) : (
          <PeakList
            mountains={mountains}
            countries={countries}
            unit={unit}
            onOpenPeak={openPeak}
            links={links}
          />
        )}
      </section>
    </article>
  );
}
