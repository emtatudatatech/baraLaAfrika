import { REGION_SLUGS, type RegionSlug } from '@bla/shared';
import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { Icon } from '../../components/Icon/Icon';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl';
import { api } from '../../lib/api';
import { minWidthQuery } from '../../lib/breakpoints';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useResource } from '../../lib/useResource';
import { latestParams } from '../../lib/latestParams';
import styles from './CountriesPage.module.css';
import { CountriesTable, CountriesTableSkeleton } from './CountriesTable';
import { CountryCards, CountryCardsSkeleton } from './CountryCards';
import { CountryDrawer } from './CountryDrawer';
import {
  type CountriesView,
  DEFAULT_SORT,
  type SortKey,
  type TableView,
  VIEW_SORT_KEYS,
  filterCountries,
  formatSort,
  parseSort,
  parseView,
  sortCountries,
  toggleSort,
  updateParams,
} from './countryQuery';
import { type RegionOption, RegionFilter } from '../../components/RegionFilter/RegionFilter';

/** `/countries`: all 54 countries, filterable, searchable and sortable, with URL state (§7.2). */
export function CountriesPage() {
  const page = strings.pages.countries;
  const text = strings.countries;
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  // Shared with the home page's map: one request per session.
  const countries = useResource('countries:all', () => api.countries());
  const isWide = useMediaQuery(minWidthQuery('md'));
  const searchRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => countries.data?.countries ?? [], [countries.data]);
  const visible = useMemo(() => sortCountries(filterCountries(all, view), view.sort), [all, view]);
  const regionOptions = useMemo<RegionOption[]>(
    () =>
      REGION_SLUGS.flatMap((slug: RegionSlug) => {
        const members = all.filter((country) => country.region.slug === slug);
        const first = members[0];
        return first ? [{ slug, name: first.region.name, count: members.length }] : [];
      }),
    [all],
  );
  const selected =
    view.country === null ? undefined : all.find((country) => country.iso3 === view.country);

  // Views are shareable, not history entries: filter changes replace the current URL.
  const update = (change: Partial<CountriesView>) => {
    setParams(() => updateParams(latestParams(), change), { replace: true });
  };

  // The search box is uncontrolled (no caret jumps while the URL updates); keep it in step when
  // the URL changes from elsewhere (Clear filters, back/forward).
  useEffect(() => {
    const input = searchRef.current;
    if (input && input.value.trim() !== view.q) input.value = view.q;
  }, [view.q]);

  const hasFilters = view.region !== null || view.q !== '';

  // A sort that belongs to the other view's columns falls back to the default.
  const switchView = (next: TableView) => {
    update({
      view: next,
      ...(VIEW_SORT_KEYS[next].includes(view.sort.key) ? {} : { sort: DEFAULT_SORT }),
    });
  };
  const directionLabel = (key: SortKey, direction: 'asc' | 'desc') => {
    const labels: Partial<Record<SortKey, { asc: string; desc: string }>> = text.directions;
    const custom = labels[key];
    if (custom !== undefined) return custom[direction];
    return direction === 'asc' ? text.ascending : text.descending;
  };
  const title = selected
    ? `${selected.name} · ${page.title} · ${strings.site.name}`
    : `${page.title} · ${strings.site.name}`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={page.description} />
      <PageHeader icon="flag" title={page.title} description={page.description} />

      <section className={styles.controls} aria-label={text.filtersLabel}>
        <SegmentedControl
          label={text.viewLabel}
          value={view.view}
          onChange={switchView}
          testId="countries-view"
          options={[
            { value: 'symbols', label: text.views.symbols, icon: 'flag' },
            { value: 'facts', label: text.views.facts, icon: 'public' },
          ]}
        />
        <RegionFilter
          options={regionOptions}
          total={all.length}
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
              placeholder={text.searchPlaceholder}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                update({ q: event.currentTarget.value });
              }}
            />
          </label>
          {!isWide && (
            <label className={styles.sort}>
              <span>{text.sortLabel}</span>
              <select
                value={formatSort(view.sort)}
                onChange={(event) => {
                  update({ sort: parseSort(event.currentTarget.value) });
                }}
              >
                {VIEW_SORT_KEYS[view.view].flatMap((key) =>
                  (['asc', 'desc'] as const).map((direction) => (
                    <option key={`${key}-${direction}`} value={formatSort({ key, direction })}>
                      {`${text.sortOptions[key]} (${directionLabel(key, direction)})`}
                    </option>
                  )),
                )}
              </select>
            </label>
          )}
          <p className={styles.count} role="status">
            {countries.status === 'success' && text.resultCount(visible.length, all.length)}
          </p>
        </div>
      </section>

      <section
        className={cx(styles.results, isWide && 'glass glass--strong', isWide && styles.panel)}
        aria-label={page.title}
        aria-busy={countries.status === 'loading'}
      >
        {countries.status === 'loading' &&
          (isWide ? <CountriesTableSkeleton view={view.view} /> : <CountryCardsSkeleton />)}

        {countries.status === 'error' && (
          <div className={styles.state} role="alert">
            <Icon name="error" size={32} />
            <p>{text.loadError}</p>
            <DevApiHint error={countries.error} />
            <button type="button" className={styles.action} onClick={countries.retry}>
              <Icon name="refresh" size={20} />
              {text.retry}
            </button>
          </div>
        )}

        {countries.status === 'success' && visible.length === 0 && (
          <div className={styles.state} data-testid="countries-empty">
            <Icon name="search" size={32} />
            <p className={styles.stateTitle}>{text.empty}</p>
            <p>{text.emptyHint}</p>
            {hasFilters && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  update({ region: null, q: '' });
                }}
              >
                {text.clearFilters}
              </button>
            )}
          </div>
        )}

        {countries.status === 'success' &&
          visible.length > 0 &&
          (isWide ? (
            <CountriesTable
              view={view.view}
              countries={visible}
              sort={view.sort}
              onSort={(key) => {
                update({ sort: toggleSort(view.sort, key) });
              }}
              onOpen={(iso3) => {
                update({ country: iso3 });
              }}
            />
          ) : (
            <CountryCards
              view={view.view}
              countries={visible}
              onOpen={(iso3) => {
                update({ country: iso3 });
              }}
            />
          ))}
      </section>

      {selected && (
        <CountryDrawer
          key={selected.iso3}
          country={selected}
          onClose={() => {
            update({ country: null });
          }}
        />
      )}
    </>
  );
}
