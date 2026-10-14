import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { ROUTE_DATA } from '../router';
import { ThemeProvider } from '../theme/ThemeProvider';
import { Layout } from './Layout';

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
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
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

  it('shows the route datasets and a read-only range control on reference pages', async () => {
    renderAt('/countries');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    // The kind label appears in the one-line summary and again in the (collapsed) details.
    expect(within(ribbon).getAllByText('Reference data')[0]).toBeVisible();
    expect(within(ribbon).getAllByText('Flags: Flagpedia').length).toBeGreaterThan(0);
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

  it('marks time-series pages and omits the read-only control there', () => {
    renderAt('/dhahabu');
    const ribbon = screen.getByRole('complementary', { name: 'Data behind this view' });
    expect(within(ribbon).getAllByText('Time series')[0]).toBeVisible();
    expect(within(ribbon).queryByTestId('ribbon-range')).toBeNull();
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
