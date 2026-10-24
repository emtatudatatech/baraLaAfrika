import {
  type CountryRef,
  REGION_SLUGS,
  type RegionSlug,
  VINARA_METRICS,
  type VinaraMetricKey,
  type VinaraResponse,
  isRegionSlug,
} from '@bla/shared';
import { useCallback, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { type RegionOption, RegionFilter } from '../../components/RegionFilter/RegionFilter';
import { ApiRequestError, api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { latestParams } from '../../lib/latestParams';
import { strings } from '../../lib/strings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { formatRange } from '../coverage/timeRange';
import { useTimeRange } from '../coverage/timeRangeContext';
import { ElectionStrip } from './ElectionStrip';
import { MeasureDetail } from './MeasureDetail';
import { RegionComparison } from './RegionComparison';
import { VinaraDrawer } from './VinaraDrawer';
import { VinaraExport } from './VinaraExport';
import { VinaraCards, VinaraTable } from './VinaraTable';
import { VinaraStatsBand } from './VinaraStatsBand';
import { apiWindow } from './vinaraQuery';
import { electionCalendar } from './vinaraSummary';
import styles from './VinaraPage.module.css';

const text = strings.vinara;

/**
 * `/vinara`: the cardinal (the leading state) and the silent contender (the runner-up) for each
 * measure, in Africa or one UN M49 region (?region=), over each measure's last ten complete
 * years or the ribbon's years (?from=&to=). Every ranking, window and signal comes from
 * /api/vinara (computed in the database; rules in docs/vinara-method.md).
 */
export function VinaraPage() {
  const page = strings.pages.vinara;
  const [params, setParams] = useSearchParams();
  const regionParam = params.get('region');
  const region: RegionSlug | null = isRegionSlug(regionParam) ? regionParam : null;
  // The measure shown in detail (?metric=) and the open drawer (?country=).
  const metricKey: VinaraMetricKey =
    VINARA_METRICS.find((k) => k === params.get('metric')) ?? 'population';
  const countryParam = /^[A-Z]{3}$/.test(params.get('country') ?? '')
    ? params.get('country')
    : null;
  const { range, isDefault } = useTimeRange();
  const { from, to } = apiWindow(range, isDefault, params);
  const isLg = useMediaQuery(minWidthQuery('lg'));
  const tableTitleId = useId();

  const key = `vinara:${region ?? 'africa'}:${String(from ?? '')}:${String(to ?? '')}`;
  const resource = useResource(key, () => api.vinara({ region, from, to }));
  // While another scope or range loads, keep the previous rankings (dimmed) instead of a flash.
  const [last, setLast] = useState<VinaraResponse | null>(null);
  if (resource.status === 'success' && resource.data !== last) setLast(resource.data);
  const data = resource.status === 'success' ? resource.data : last;
  const stale = resource.status !== 'success' && data !== null;

  // Flags, region names and election facts (the same cached list as the other pages).
  const summaries = useResource('countries:all', () => api.countries());
  const all = useMemo(() => summaries.data?.countries ?? [], [summaries.data]);
  const countries = useMemo(() => new Map<string, CountryRef>(all.map((c) => [c.iso3, c])), [all]);
  const states = useMemo(
    () => (region === null ? all : all.filter((c) => c.region.slug === region)),
    [all, region],
  );
  const regionOptions = useMemo<RegionOption[]>(
    () =>
      REGION_SLUGS.flatMap((slug) => {
        const members = all.filter((c) => c.region.slug === slug);
        const first = members[0];
        return first ? [{ slug, name: first.region.name, count: members.length }] : [];
      }),
    [all],
  );
  const regionName =
    region === null ? null : (regionOptions.find((o) => o.slug === region)?.name ?? null);
  const scopeName = regionName ?? strings.statsBand.allAfrica;
  const calendar = useMemo(
    () => (summaries.status === 'success' ? electionCalendar(states) : null),
    [summaries.status, states],
  );
  // The scope's states: from the countries list, or the rankings' own count until it loads.
  const total =
    states.length > 0
      ? states.length
      : data?.metrics[0]
        ? data.metrics[0].ranked + data.metrics[0].unranked.length
        : 0;

  // Views are shareable, not history entries: changes replace the current URL.
  const setParam = useCallback(
    (name: string, value: string | null) => {
      setParams(
        () => {
          const nextParams = latestParams();
          if (value === null) nextParams.delete(name);
          else nextParams.set(name, value);
          return nextParams;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );
  const setRegion = (next: RegionSlug | null) => {
    setParam('region', next);
  };
  const openCountry = useCallback(
    (iso3: string) => {
      setParam('country', iso3);
    },
    [setParam],
  );
  const drawerCountry =
    countryParam === null ? undefined : all.find((c) => c.iso3 === countryParam);
  const exportParams: Record<string, string | undefined> = {
    region: region ?? undefined,
    from: from === undefined ? undefined : String(from),
    to: to === undefined ? undefined : String(to),
  };

  const metrics = data?.metrics ?? null;
  // The rankings shown are for the scope asked for (the previous scope's stay dimmed).
  const shownRegion = data?.region ?? null;

  return (
    <>
      <title>{`${page.title} · ${strings.site.name}`}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="military_tech" title={page.title} description={page.description} />

      <section className={styles.controls} aria-label={text.scopeLabel}>
        <RegionFilter
          options={regionOptions}
          total={all.length}
          value={region}
          onChange={setRegion}
        />
        <p className={styles.window} data-testid="vinara-window">
          <Icon name="date_range" size={18} />
          {isDefault || range === null ? text.windowDefault : text.windowChosen(formatRange(range))}
        </p>
      </section>

      {resource.status === 'error' && data === null ? (
        <div className={cx('glass', styles.state)} role="alert">
          <Icon name="error" size={32} />
          <p>
            {resource.error instanceof ApiRequestError &&
            resource.error.code === 'service_unavailable'
              ? text.empty
              : text.loadError}
          </p>
          <DevApiHint error={resource.error} />
          <button type="button" className={styles.action} onClick={resource.retry}>
            <Icon name="refresh" size={20} />
            {text.retry}
          </button>
        </div>
      ) : (
        <>
          <VinaraStatsBand
            metrics={metrics}
            region={shownRegion}
            regionName={
              shownRegion === null
                ? null
                : (regionOptions.find((o) => o.slug === shownRegion)?.name ?? null)
            }
            calendar={calendar}
            states={states}
            countries={countries}
            stale={stale}
          />

          <section
            className={styles.section}
            aria-labelledby={tableTitleId}
            aria-busy={metrics === null || stale}
          >
            <div className={styles.sectionHead}>
              <div className={styles.titleRow}>
                <h2 id={tableTitleId} className={styles.sectionTitle}>
                  {text.table.title}
                </h2>
                <VinaraExport params={exportParams} />
              </div>
              <p className={styles.intro}>{text.table.intro}</p>
            </div>
            {metrics === null ? (
              <div
                className={styles.tableSkeleton}
                aria-hidden="true"
                data-testid="vinara-skeleton"
              >
                {Array.from({ length: 6 }, (_, index) => (
                  <span key={index} className="skeleton" />
                ))}
              </div>
            ) : isLg ? (
              <div className={cx('glass glass--strong', styles.panel, stale && styles.stale)}>
                <VinaraTable
                  metrics={metrics}
                  total={total}
                  scopeName={scopeName}
                  countries={countries}
                  onOpen={openCountry}
                />
              </div>
            ) : (
              <div className={cx(stale && styles.stale)}>
                <VinaraCards
                  metrics={metrics}
                  total={total}
                  countries={countries}
                  onOpen={openCountry}
                />
              </div>
            )}
          </section>

          {metrics !== null && (
            <MeasureDetail
              metrics={metrics}
              metric={metricKey}
              region={region}
              from={from}
              to={to}
              onMetric={(next) => {
                setParam('metric', next === 'population' ? null : next);
              }}
              onOpen={openCountry}
            />
          )}

          {metrics !== null && shownRegion === null && (
            <div className={cx(stale && styles.stale)}>
              <RegionComparison metrics={metrics} wide={isLg} />
            </div>
          )}
        </>
      )}

      {calendar !== null && <ElectionStrip calendar={calendar} regionName={regionName} />}

      {drawerCountry !== undefined && (
        <VinaraDrawer
          key={drawerCountry.iso3}
          country={drawerCountry}
          from={from}
          to={to}
          onClose={() => {
            setParam('country', null);
          }}
        />
      )}
    </>
  );
}
