import {
  type CountryRef,
  GOLD_SORTS,
  type GoldCountry,
  type GoldUnit,
  PRESENCE_TIERS,
  REGION_SLUGS,
  type GoldSort,
} from '@bla/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { type RegionOption, RegionFilter } from '../../components/RegionFilter/RegionFilter';
import { api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { useGoldUnit } from '../../lib/goldUnits';
import { strings } from '../../lib/strings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { useTimeRange } from '../coverage/timeRangeContext';
import harimStyles from '../harim/HarimPage.module.css';
import { GoldExport } from './GoldExport';
import { GoldStatsBand } from './GoldStatsBand';
import type { GoldStatAction } from './goldStats';
import { GoldCards, GoldTable, GoldTableSkeleton } from './GoldTable';
import {
  type GoldView,
  apiYear,
  nextSort,
  parseView,
  updateParams,
  visibleRows,
} from './goldQuery';
import { HowToRead } from './HowToRead';
import styles from './DhahabuPage.module.css';

const text = strings.dhahabu;

/**
 * `/dhahabu`: gold in Africa (spec 7.6). The statistics band and the country table follow the
 * ribbon's year range (its end is the reference year: each figure is the latest in or before it,
 * with its own year or date), the region, search, presence and sort live in the URL, and the
 * table exports as CSV with its sources and attributions.
 */
export function DhahabuPage() {
  const page = strings.pages.dhahabu;
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  const [unit, setUnit] = useGoldUnit();
  const { range, bounds } = useTimeRange();
  const year = apiYear(range, bounds);
  const isLg = useMediaQuery(minWidthQuery('lg'));
  const isWide = useMediaQuery(minWidthQuery('md'));
  const searchRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLElement>(null);

  const resource = useResource(`gold-countries:${year ?? 'latest'}`, () => api.goldCountries(year));
  // While another reference year loads, keep the previous rows (dimmed) instead of a flash.
  const [last, setLast] = useState<readonly GoldCountry[] | null>(null);
  if (resource.status === 'success' && resource.data.countries !== last) {
    setLast(resource.data.countries);
  }
  const rows = useMemo(
    () => (resource.status === 'success' ? resource.data.countries : (last ?? [])),
    [resource, last],
  );
  const stale = resource.status !== 'success' && last !== null;
  const visible = useMemo(() => visibleRows(rows, view), [rows, view]);
  const countries = useMemo(
    () => new Map<string, CountryRef>(rows.map((row) => [row.country.iso3, row.country])),
    [rows],
  );
  const regionOptions = useMemo<RegionOption[]>(
    () =>
      REGION_SLUGS.flatMap((slug) => {
        const members = rows.filter((row) => row.country.region.slug === slug);
        const first = members[0];
        return first ? [{ slug, name: first.country.region.name, count: members.length }] : [];
      }),
    [rows],
  );
  const regionName =
    view.region === null
      ? null
      : (regionOptions.find((option) => option.slug === view.region)?.name ?? null);

  // Views are shareable, not history entries: changes replace the current URL.
  const update = (change: Partial<GoldView>) => {
    setParams((current) => updateParams(current, change), {
      replace: true,
      preventScrollReset: true,
    });
  };

  useEffect(() => {
    const input = searchRef.current;
    if (input && input.value.trim() !== view.q) input.value = view.q;
  }, [view.q]);

  // A card that names a country brings its row into view, highlighted, with focus on its name.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => {
    if (highlighted === null || revealTick === 0) return;
    const row = document.querySelector(`#gold-results [data-iso3="${CSS.escape(highlighted)}"]`);
    if (!row) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    row.querySelector<HTMLElement>('[data-testid="gold-country-name"]')?.focus({
      preventScroll: true,
    });
  }, [highlighted, revealTick]);

  const onStatAction = (action: GoldStatAction) => {
    if (action.kind === 'sort') {
      update({ sort: action.sort });
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      controlsRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    // Make sure the country is listed: drop the search and presence filters that would hide it.
    const row = rows.find((r) => r.country.iso3 === action.iso3);
    if (row && !visible.includes(row)) update({ q: '', presence: null });
    setHighlighted(action.iso3);
    setRevealTick((n) => n + 1);
  };

  const hasFilters = view.region !== null || view.q !== '' || view.presence !== null;
  const clearFilters = () => {
    update({ region: null, q: '', presence: null });
  };
  const exportParams: Record<string, string | undefined> = {
    region: view.region ?? undefined,
    q: view.q || undefined,
    presence: view.presence ?? undefined,
    sort: view.sort === 'production' ? undefined : view.sort,
    year: year === undefined ? undefined : String(year),
  };
  const ready = resource.status === 'success' || stale;

  return (
    <>
      <title>{`${page.title} · ${strings.site.name}`}</title>
      <meta name="description" content={page.description} />
      <PageHeader
        icon="diamond"
        title={page.title}
        description={page.description}
        actions={
          <>
            <UnitsToggle unit={unit} onChange={setUnit} />
            <HowToRead />
          </>
        }
      />

      <GoldStatsBand
        region={view.region}
        regionName={regionName}
        year={year}
        countries={countries}
        unit={unit}
        onAction={onStatAction}
      />

      <section ref={controlsRef} className={harimStyles.controls} aria-label={text.filtersLabel}>
        <RegionFilter
          options={regionOptions}
          total={rows.length}
          value={view.region}
          onChange={(region) => {
            update({ region });
          }}
        />
        <div className={harimStyles.toolbar}>
          <label className={harimStyles.search}>
            <span className="visually-hidden">{text.searchLabel}</span>
            <Icon name="search" size={20} className={harimStyles.searchIcon} />
            <input
              ref={searchRef}
              type="search"
              defaultValue={view.q}
              placeholder={text.searchPlaceholder}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              data-testid="gold-search"
              onChange={(event) => {
                update({ q: event.currentTarget.value });
              }}
            />
          </label>
          <label className={harimStyles.select}>
            <span>{text.presenceFilter}</span>
            <select
              value={view.presence ?? ''}
              data-testid="gold-presence-filter"
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({ presence: PRESENCE_TIERS.find((tier) => tier === value) ?? null });
              }}
            >
              <option value="">{text.anyPresence}</option>
              {PRESENCE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {text.presence[tier]}
                </option>
              ))}
            </select>
          </label>
          {!isLg && (
            <label className={harimStyles.select}>
              <span>{text.sortLabel}</span>
              <select
                value={view.sort}
                data-testid="gold-sort"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  update({ sort: GOLD_SORTS.find((sort) => sort === value) ?? 'production' });
                }}
              >
                {GOLD_SORTS.map((sort: GoldSort) => (
                  <option key={sort} value={sort}>
                    {text.sorts[sort]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className={harimStyles.statusRow}>
          <p className={harimStyles.count} role="status">
            {ready && text.countryCount(visible.length, rows.length)}
          </p>
          {hasFilters && (
            <button type="button" className={harimStyles.clear} onClick={clearFilters}>
              {text.clearFilters}
            </button>
          )}
          <GoldExport viewParams={exportParams} />
        </div>
        <p className={styles.reference} data-testid="gold-reference">
          <Icon name="date_range" size={18} />
          {year === undefined ? text.referenceLatest : text.referenceYear(year)}
        </p>
      </section>

      <section
        id="gold-results"
        className={cx(
          harimStyles.results,
          isLg && 'glass glass--strong',
          isLg && harimStyles.panel,
          stale && styles.stale,
        )}
        aria-label={text.filtersLabel}
        aria-busy={resource.status === 'loading'}
      >
        {resource.status === 'loading' &&
          last === null &&
          (isWide ? <GoldTableSkeleton /> : <GoldTableSkeleton rows={4} />)}

        {resource.status === 'error' && last === null && (
          <div className={harimStyles.state} role="alert">
            <Icon name="error" size={32} />
            <p>{text.loadError}</p>
            <DevApiHint error={resource.error} />
            <button type="button" className={harimStyles.action} onClick={resource.retry}>
              <Icon name="refresh" size={20} />
              {text.retry}
            </button>
          </div>
        )}

        {ready && visible.length === 0 && (
          <div className={harimStyles.state} data-testid="gold-empty">
            <Icon name="search" size={32} />
            <p className={harimStyles.stateTitle}>{text.empty}</p>
            <p>{text.emptyHint}</p>
            {hasFilters && (
              <button type="button" className={harimStyles.action} onClick={clearFilters}>
                {text.clearFilters}
              </button>
            )}
          </div>
        )}

        {ready &&
          visible.length > 0 &&
          (isLg ? (
            <GoldTable
              rows={visible}
              unit={unit}
              highlighted={highlighted}
              sort={view.sort}
              onSort={(column) => {
                update({ sort: nextSort(view.sort, column) });
              }}
            />
          ) : (
            <GoldCards rows={visible} unit={unit} highlighted={highlighted} />
          ))}
      </section>
    </>
  );
}

function UnitsToggle({ unit, onChange }: { unit: GoldUnit; onChange: (unit: GoldUnit) => void }) {
  return (
    <div role="group" aria-label={text.unitsLabel} className={harimStyles.segmented}>
      {(['t', 'kg', 'oz'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={unit === option}
          data-testid={`gold-unit-${option}`}
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
