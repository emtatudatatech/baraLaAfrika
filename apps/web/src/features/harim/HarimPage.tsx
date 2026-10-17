import { type CountryRef, REGION_SLUGS, VOLCANIC_FILTERS } from '@bla/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { type RegionOption, RegionFilter } from '../../components/RegionFilter/RegionFilter';
import { api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { type Unit, formatElevation, useUnits } from '../../lib/units';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import styles from './HarimPage.module.css';
import {
  COUNTRY_SORTS,
  type CountrySort,
  type HarimView,
  PEAK_SORTS,
  type PeakSort,
  type View,
  filterPeaks,
  filterSummary,
  nextCountrySort,
  parseView,
  sortPeaks,
  sortSummary,
  updateParams,
} from './harimQuery';
import { PeakDrawer } from './PeakDrawer';
import { PeakList } from './PeakList';
import { PeaksTable } from './PeaksTable';
import { SummaryCards, SummaryCardsSkeleton } from './SummaryCards';
import { SummaryTable, SummaryTableSkeleton } from './SummaryTable';
import { TerritoryPeaks } from './TerritoryPeaks';

const text = strings.harim;
const SLIDER_MAX = 5500;
const SLIDER_STEP = 250;

/**
 * `/harim`: Africa's mountains country by country (the default view, one expandable row per
 * country) or as one list of every catalogued peak, with region chips, search, filters, a
 * metres/feet toggle and the whole view in the URL (§7.5).
 */
export function HarimPage() {
  const page = strings.pages.harim;
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  const rangesRequested = params.get('view') === 'ranges';
  const [unit, setUnit] = useUnits();
  const isWide = useMediaQuery(minWidthQuery('md'));
  const isLg = useMediaQuery(minWidthQuery('lg'));
  const isXl = useMediaQuery(minWidthQuery('xl'));
  // The lowest point and relief columns: shown from 1280px, optional from 1024px (the table
  // would not fit below that, so they live in the expanded row there).
  const [lowColumns, setLowColumns] = useState<boolean | null>(null);
  const showLowColumns = isLg && (lowColumns ?? isXl);
  const searchRef = useRef<HTMLInputElement>(null);

  // Rows are expanded locally; a country chosen in the URL (e.g. from the Countries tab) opens.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(view.country === null ? [] : [view.country]),
  );
  const [lastCountry, setLastCountry] = useState(view.country);
  if (view.country !== lastCountry) {
    setLastCountry(view.country);
    const iso3 = view.country;
    if (iso3 !== null) setExpanded((current) => new Set(current).add(iso3));
  }

  const summary = useResource('mountains:summary', () => api.mountainSummary());
  const needCatalogue = view.view === 'peaks' || expanded.size > 0;
  const catalogue = useResource(needCatalogue ? 'mountains:all' : null, () => api.mountains());

  const rows = useMemo(() => summary.data?.countries ?? [], [summary.data]);
  const mountains = useMemo(() => catalogue.data?.mountains ?? [], [catalogue.data]);
  const countries = useMemo(
    () => new Map<string, CountryRef>(rows.map((row) => [row.country.iso3, row.country])),
    [rows],
  );
  const maxHeight = useMemo(
    () => Math.max(0, ...rows.map((row) => row.highestPeak?.elevationM ?? 0)),
    [rows],
  );
  const countryOptions = useMemo(
    () => [...countries.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [countries],
  );
  const rangeOptions = useMemo(() => {
    const ranges = new Map<string, string>();
    for (const mountain of mountains) {
      if (mountain.range) ranges.set(mountain.range.slug, mountain.range.name);
    }
    return [...ranges].sort((a, b) => a[1].localeCompare(b[1], 'en'));
  }, [mountains]);

  const visibleRows = useMemo(
    () => sortSummary(filterSummary(rows, view), view.sort as CountrySort),
    [rows, view],
  );
  const visiblePeaks = useMemo(
    () => sortPeaks(filterPeaks(mountains, view, countries), view.sort as PeakSort),
    [mountains, view, countries],
  );

  const regionOptions = useMemo<RegionOption[]>(
    () =>
      REGION_SLUGS.flatMap((slug) => {
        const first = rows.find((row) => row.country.region.slug === slug);
        if (!first) return [];
        const count =
          view.view === 'country'
            ? rows.filter((row) => row.country.region.slug === slug).length
            : mountains.filter((m) =>
                m.countries.some((iso3) => countries.get(iso3)?.region.slug === slug),
              ).length;
        return [{ slug, name: first.country.region.name, count }];
      }),
    [rows, mountains, countries, view.view],
  );

  // Views are shareable, not history entries: changes replace the current URL.
  const update = (change: Partial<HarimView>) => {
    setParams((current) => updateParams(current, change), { replace: true });
  };
  const switchView = (next: View) => {
    if (next === view.view) return;
    // The peak-only filters mean nothing by country; dropping them keeps shared URLs honest.
    update(
      next === 'country'
        ? { view: next, minHeight: null, volcanic: null, range: null }
        : { view: next },
    );
  };
  const openPeak = (slug: string) => {
    update({ peak: slug });
  };
  const toggleCountry = (iso3: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(iso3)) next.delete(iso3);
      else next.add(iso3);
      return next;
    });
  };

  useEffect(() => {
    const input = searchRef.current;
    if (input && input.value.trim() !== view.q) input.value = view.q;
  }, [view.q]);

  const isPeaks = view.view === 'peaks';
  const hasFilters =
    view.region !== null ||
    view.q !== '' ||
    view.country !== null ||
    (isPeaks && (view.minHeight !== null || view.volcanic !== null || view.range !== null));
  const clearFilters = () => {
    update({ region: null, q: '', country: null, minHeight: null, volcanic: null, range: null });
  };
  const preview = view.peak === null ? undefined : mountains.find((m) => m.slug === view.peak);
  const title = preview
    ? `${preview.name} · ${page.title} · ${strings.site.name}`
    : `${page.title} · ${strings.site.name}`;
  const prominentPreset = isPeaks && view.sort === 'prominence';
  const loading = summary.status === 'loading' || (isPeaks && catalogue.status === 'loading');
  const failed =
    summary.status === 'error'
      ? summary
      : isPeaks && catalogue.status === 'error'
        ? catalogue
        : null;
  const ready = summary.status === 'success' && (!isPeaks || catalogue.status === 'success');

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="landscape" title={page.title} description={page.description} />

      {rangesRequested && (
        <p className={styles.notice} role="note">
          <Icon name="info" size={20} />
          {text.rangesSoon}
        </p>
      )}

      <section className={styles.controls} aria-label={text.filtersLabel}>
        <div className={styles.topRow}>
          <div role="group" aria-label={text.viewLabel} className={styles.segmented}>
            {(['country', 'peaks'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view.view === option}
                data-testid={`harim-view-${option}`}
                onClick={() => {
                  switchView(option);
                }}
              >
                <Icon
                  name={option === 'country' ? 'flag' : 'landscape'}
                  size={20}
                  className={styles.segmentedIcon}
                />
                {text.views[option]}
              </button>
            ))}
          </div>
          <UnitsToggle unit={unit} onChange={setUnit} />
        </div>

        <RegionFilter
          options={regionOptions}
          total={isPeaks ? mountains.length : rows.length}
          value={view.region}
          onChange={(region) => {
            update({ region });
          }}
        />

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span className="visually-hidden">{text.searchLabel}</span>
            <Icon name="search" size={20} className={styles.searchIcon} />
            <input
              ref={searchRef}
              type="search"
              defaultValue={view.q}
              placeholder={text.searchPlaceholder[view.view]}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                update({ q: event.currentTarget.value });
              }}
            />
          </label>
          <label className={styles.select}>
            <span>{text.countryFilter}</span>
            <select
              value={view.country ?? ''}
              data-testid="harim-country-filter"
              onChange={(event) => {
                update({ country: event.currentTarget.value || null });
              }}
            >
              <option value="">{text.anyCountry}</option>
              {countryOptions.map((country) => (
                <option key={country.iso3} value={country.iso3}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          {!isWide && (
            <label className={styles.select}>
              <span>{text.sortLabel}</span>
              <select
                value={view.sort}
                data-testid="harim-sort"
                onChange={(event) => {
                  update({ sort: event.currentTarget.value as CountrySort | PeakSort });
                }}
              >
                {(isPeaks ? PEAK_SORTS : COUNTRY_SORTS).map((sort) => (
                  <option key={sort} value={sort}>
                    {isPeaks
                      ? text.peakSorts[sort as PeakSort]
                      : text.countrySorts[sort as CountrySort]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={prominentPreset}
            data-testid="harim-prominent"
            onClick={() => {
              if (prominentPreset) update({ sort: 'height' });
              else update({ view: 'peaks', sort: 'prominence' });
            }}
          >
            <Icon name="trending_up" size={20} />
            {text.mostProminent}
          </button>
          {!isPeaks && isLg && (
            <button
              type="button"
              className={styles.chip}
              aria-pressed={showLowColumns}
              data-testid="harim-low-columns"
              onClick={() => {
                setLowColumns(!showLowColumns);
              }}
            >
              <Icon name="south" size={20} />
              {text.showLowColumns}
            </button>
          )}
        </div>

        {isPeaks && (
          <div className={styles.toolbar}>
            <label className={styles.select}>
              <span>{text.rangeFilter}</span>
              <select
                value={view.range ?? ''}
                data-testid="harim-range-filter"
                onChange={(event) => {
                  update({ range: event.currentTarget.value || null });
                }}
              >
                <option value="">{text.anyRange}</option>
                {/* A range in the URL but not (yet) in the list still shows as selected. */}
                {view.range !== null && !rangeOptions.some(([slug]) => slug === view.range) && (
                  <option value={view.range}>{view.range}</option>
                )}
                {rangeOptions.map(([slug, name]) => (
                  <option key={slug} value={slug}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.select}>
              <span>{text.volcanicFilter}</span>
              <select
                value={view.volcanic ?? ''}
                data-testid="harim-volcanic-filter"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  update({
                    volcanic: VOLCANIC_FILTERS.find((option) => option === value) ?? null,
                  });
                }}
              >
                <option value="">{text.volcanicOptions.any}</option>
                {VOLCANIC_FILTERS.map((option) => (
                  <option key={option} value={option}>
                    {text.volcanicOptions[option]}
                  </option>
                ))}
              </select>
            </label>
            <MinHeightSlider
              value={view.minHeight}
              unit={unit}
              onChange={(minHeight) => {
                update({ minHeight });
              }}
            />
          </div>
        )}

        <div className={styles.statusRow}>
          <p className={styles.count} role="status">
            {ready &&
              (isPeaks
                ? text.peakCount(visiblePeaks.length, mountains.length)
                : text.countryCount(visibleRows.length, rows.length))}
          </p>
          {hasFilters && (
            <button type="button" className={styles.clear} onClick={clearFilters}>
              {text.clearFilters}
            </button>
          )}
        </div>
      </section>

      <section
        className={cx(styles.results, isWide && 'glass glass--strong', isWide && styles.panel)}
        aria-label={text.views[view.view]}
        aria-busy={loading}
      >
        {loading && (isWide ? <SummaryTableSkeleton /> : <SummaryCardsSkeleton />)}

        {failed && (
          <div className={styles.state} role="alert">
            <Icon name="error" size={32} />
            <p>{text.loadError}</p>
            <DevApiHint error={failed.error} />
            <button type="button" className={styles.action} onClick={failed.retry}>
              <Icon name="refresh" size={20} />
              {text.retry}
            </button>
          </div>
        )}

        {ready && (isPeaks ? visiblePeaks.length === 0 : visibleRows.length === 0) && (
          <div className={styles.state} data-testid="harim-empty">
            <Icon name="search" size={32} />
            <p className={styles.stateTitle}>{isPeaks ? text.empty : text.emptyCountries}</p>
            <p>{text.emptyHint}</p>
            {hasFilters && (
              <button type="button" className={styles.action} onClick={clearFilters}>
                {text.clearFilters}
              </button>
            )}
          </div>
        )}

        {ready &&
          !isPeaks &&
          visibleRows.length > 0 &&
          (isWide ? (
            <SummaryTable
              rows={visibleRows}
              maxHeight={maxHeight}
              sort={view.sort as CountrySort}
              onSort={(column) => {
                update({ sort: nextCountrySort(view.sort as CountrySort, column) });
              }}
              expanded={expanded}
              onToggle={toggleCountry}
              showLowColumns={showLowColumns}
              catalogue={catalogue}
              countries={countries}
              unit={unit}
              onOpenPeak={openPeak}
            />
          ) : (
            <SummaryCards
              rows={visibleRows}
              expanded={expanded}
              onToggle={toggleCountry}
              catalogue={catalogue}
              countries={countries}
              unit={unit}
              onOpenPeak={openPeak}
            />
          ))}

        {ready &&
          isPeaks &&
          visiblePeaks.length > 0 &&
          // Six columns do not fit below 1024px: the compact list is used there.
          (isLg ? (
            <PeaksTable
              mountains={visiblePeaks}
              sort={view.sort as PeakSort}
              onSort={(sort) => {
                update({ sort });
              }}
              countries={countries}
              unit={unit}
              onOpenPeak={openPeak}
            />
          ) : (
            <PeakList
              mountains={visiblePeaks}
              countries={countries}
              unit={unit}
              onOpenPeak={openPeak}
            />
          ))}

        {ready && isPeaks && catalogue.data?.capped && (
          <p className={styles.notice}>{text.capped}</p>
        )}
      </section>

      {!isPeaks && summary.status === 'success' && (
        <TerritoryPeaks countries={countries} unit={unit} onOpenPeak={openPeak} />
      )}

      {view.peak !== null && (
        <PeakDrawer
          key={view.peak}
          slug={view.peak}
          preview={preview}
          countries={countries}
          unit={unit}
          onOpenPeak={openPeak}
          onClose={() => {
            update({ peak: null });
          }}
        />
      )}
    </>
  );
}

function UnitsToggle({ unit, onChange }: { unit: Unit; onChange: (unit: Unit) => void }) {
  return (
    <div role="group" aria-label={text.unitsLabel} className={styles.segmented}>
      {(['m', 'ft'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={unit === option}
          data-testid={`harim-unit-${option}`}
          onClick={() => {
            onChange(option);
          }}
        >
          <span aria-hidden="true">{option}</span>
          <span className="visually-hidden">{text.units[option]}</span>
        </button>
      ))}
    </div>
  );
}

function MinHeightSlider({
  value,
  unit,
  onChange,
}: {
  value: number | null;
  unit: Unit;
  onChange: (value: number | null) => void;
}) {
  const label = value === null ? text.minHeightAny : `≥ ${formatElevation(value, unit)}`;
  return (
    <label className={styles.slider}>
      <span>
        {text.minHeight}: <strong className={styles.sliderValue}>{label}</strong>
      </span>
      <input
        type="range"
        min={0}
        max={SLIDER_MAX}
        step={SLIDER_STEP}
        value={value ?? 0}
        aria-valuetext={label}
        data-testid="harim-min-height"
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          onChange(next > 0 ? next : null);
        }}
      />
    </label>
  );
}
