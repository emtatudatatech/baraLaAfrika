import type { CoverageDataset, CoverageResponse, DatasetKey } from '@bla/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_DATA } from '../router';
import { ThemeProvider } from '../theme/ThemeProvider';
import { Layout } from './Layout';

function dataset(key: DatasetKey, partial: Partial<CoverageDataset> = {}): CoverageDataset {
  return {
    key,
    name: `Full name of ${key}`,
    provider: 'Provider',
    license: 'Licence',
    attribution: 'Attribution',
    coverageStart: null,
    coverageEnd: null,
    asOf: '2026-10-14',
    lastRefreshedAt: '2026-10-15T08:00:00Z',
    refreshCadence: 'manual',
    ...partial,
  };
}

/** Coverage the stubbed API knows; any other requested key is reported as missing. */
let known: CoverageDataset[] = [];

beforeEach(() => {
  known = [
    dataset('symbology-pdf'),
    dataset('flags-flagpedia', { asOf: '2026-10-15', refreshCadence: 'monthly' }),
    dataset('boundaries-natural-earth', { asOf: '2018-05-23', refreshCadence: 'static' }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const keys = (url.searchParams.get('datasets') ?? '').split(',');
      const body: CoverageResponse = {
        datasets: known.filter((d) => keys.includes(d.key)),
        missing: keys.filter((key) => !known.some((d) => d.key === key)) as DatasetKey[],
      };
      return Promise.resolve(Response.json(body));
    }),
  );
});

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: Layout,
        children: [
          { index: true, handle: ROUTE_DATA.home, Component: () => <h1>Home</h1> },
          { path: 'countries', handle: ROUTE_DATA.countries, Component: () => <h1>Countries</h1> },
          { path: 'dhahabu', handle: ROUTE_DATA.dhahabu, Component: () => <h1>Dhahabu</h1> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

describe('Layout', () => {
  it('renders the nav in the specified order with future sections disabled', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const items = within(nav)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      'homeHome',
      'publicCountries',
      'landscapeHarim',
      'diamondDhahabu',
      'history_eduHistoryscheduleComing soon',
      'exploreContemporary AfricascheduleComing soon',
    ]);
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).queryByRole('link', { name: /History/ })).toBeNull();
  });

  it('marks the current page in the nav', () => {
    renderAt('/countries');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: /Countries/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the route datasets with live coverage and a read-only control on reference pages', async () => {
    renderAt('/countries');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    // The kind label appears in the one-line summary and again in the (collapsed) details.
    expect(within(ribbon).getAllByText('Reference data')[0]).toBeVisible();
    expect(within(ribbon).getAllByText('Flags: Flagpedia').length).toBeGreaterThan(0);
    // The newest "as of" among the route's datasets, from /api/coverage.
    expect(await within(ribbon).findByTestId('ribbon-as-of')).toHaveTextContent(
      'as of 15 Oct 2026',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/coverage?datasets=flags-flagpedia%2Csymbology-pdf',
      expect.anything(),
    );
    const control = within(ribbon).getByTestId('ribbon-range');
    expect(control).toHaveAttribute('aria-disabled', 'true');
    const tooltipId = control.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(tooltipId)).toHaveTextContent(
      "This page's data is not time-dependent",
    );
    await userEvent.tab();
    await userEvent.tab();
    // Skip link, then the ribbon's range control receives focus and opens its tooltip.
    expect(control).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeVisible();
  });

  it('lists each dataset’s details in the expandable sheet', async () => {
    renderAt('/');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    await within(ribbon).findByTestId('ribbon-as-of');
    await userEvent.click(within(ribbon).getByRole('button', { name: 'Show data details' }));
    const list = within(ribbon).getByRole('list', { name: 'Datasets behind this view' });
    const boundaries = within(list)
      .getAllByRole('listitem')
      .find((item) => item.dataset.dataset === 'boundaries-natural-earth');
    expect(boundaries).toHaveTextContent('Full name of boundaries-natural-earth');
    // (The colons after the labels are drawn by CSS.)
    expect(boundaries).toHaveTextContent(/As of\s*23 May 2018/);
    expect(boundaries).toHaveTextContent(/Updates\s*Does not change/);
    expect(boundaries).toHaveTextContent(/Last refreshed\s*15 Oct 2026/);
    expect(boundaries).toHaveTextContent(/Licence\s*Licence/);
  });

  it('marks datasets that are not loaded yet', async () => {
    renderAt('/dhahabu');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    expect(within(ribbon).getAllByText('Time series')[0]).toBeVisible();
    expect(await within(ribbon).findByText('Gold price (not loaded yet)')).toBeInTheDocument();
    // No data, so no range to pick: a visible "no data" state, never an invented range.
    const years = within(ribbon).getByTestId('ribbon-years');
    expect(years).toHaveTextContent('No data yet');
    expect(years).toHaveAttribute('aria-disabled', 'true');
    expect(within(ribbon).queryByTestId('ribbon-range')).toBeNull();
  });

  it('makes the year range interactive on time-series pages and syncs it to the URL', async () => {
    known = [
      dataset('gold-price', {
        coverageStart: '1990-01-01',
        coverageEnd: '2026-09-30',
        refreshCadence: 'monthly',
      }),
      dataset('gold-production', {
        coverageStart: '2000-01-01',
        coverageEnd: '2024-12-31',
        refreshCadence: 'annual',
      }),
    ];
    const router = renderAt('/dhahabu?to=2020');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    expect(await within(ribbon).findByText('Gold price: Jan 1990–Sep 2026')).toBeInTheDocument();
    const trigger = await within(ribbon).findByRole('button', { name: /Years shown/ });
    expect(trigger).toHaveTextContent('1990–2020');

    await userEvent.click(trigger);
    await userEvent.click(within(ribbon).getByRole('button', { name: 'Last 5 years' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?from=2022');
    });
    expect(trigger).toHaveTextContent('2022–2026');
    expect(within(ribbon).getByRole('button', { name: 'Last 5 years' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.selectOptions(within(ribbon).getByRole('combobox', { name: 'To' }), '2024');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?from=2022&to=2024');
    });
    // The From list never offers years after the chosen end, nor before the data.
    const from = within(ribbon).getByRole('combobox', { name: 'From' });
    const options = within(from)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options[0]).toBe('1990');
    expect(options.at(-1)).toBe('2024');

    await userEvent.click(within(ribbon).getByRole('button', { name: 'All years' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('clamps a shared range to the data', async () => {
    known = [dataset('gold-price', { coverageStart: '2000-01-01', coverageEnd: '2025-12-31' })];
    renderAt('/dhahabu?from=1850&to=2099');
    const trigger = await screen.findByRole('button', { name: /Years shown/ });
    expect(trigger).toHaveTextContent('2000–2025');
  });

  it('ignores range params on reference pages', async () => {
    renderAt('/countries?from=2010&to=2015');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    await within(ribbon).findByTestId('ribbon-as-of');
    expect(within(ribbon).queryByTestId('ribbon-years')).toBeNull();
    expect(within(ribbon).getByTestId('ribbon-range')).toHaveTextContent('Not time-dependent');
  });

  it('has a skip link to the main landmark', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});
