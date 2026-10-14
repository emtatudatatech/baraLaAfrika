import { createBrowserRouter } from 'react-router';

import type { RouteDataHandle } from '../features/coverage/routeData';
import { Layout } from './layout/Layout';
import { NotFoundPage } from './NotFoundPage';
import { RootErrorBoundary } from './RootErrorBoundary';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/**
 * Route table. Each data route declares its datasets for the ribbon (see routeData.ts); route
 * modules are code-split with `lazy`.
 */
export const ROUTE_DATA = {
  home: {
    datasets: ['symbology-pdf', 'boundaries-natural-earth', 'flags-flagpedia'],
    timeDependent: false,
  },
  countries: {
    datasets: ['symbology-pdf', 'flags-flagpedia'],
    timeDependent: false,
  },
  harim: {
    datasets: ['mountains-baseline', 'mountains-wikidata', 'mountains-geonames'],
    timeDependent: false,
  },
  dhahabu: {
    datasets: ['gold-price', 'gold-production', 'gold-trade', 'gold-official-reserves'],
    timeDependent: true,
  },
} as const satisfies Record<string, RouteDataHandle>;

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    ErrorBoundary: RootErrorBoundary,
    children: [
      {
        ErrorBoundary: RouteErrorBoundary,
        children: [
          {
            index: true,
            handle: ROUTE_DATA.home,
            lazy: {
              Component: async () => (await import('../features/map/HomePage')).HomePage,
            },
          },
          {
            path: 'countries',
            handle: ROUTE_DATA.countries,
            lazy: {
              Component: async () =>
                (await import('../features/countries/CountriesPage')).CountriesPage,
            },
          },
          {
            path: 'harim',
            handle: ROUTE_DATA.harim,
            lazy: {
              Component: async () => (await import('../features/harim/HarimPage')).HarimPage,
            },
          },
          {
            path: 'dhahabu',
            handle: ROUTE_DATA.dhahabu,
            lazy: {
              Component: async () => (await import('../features/dhahabu/DhahabuPage')).DhahabuPage,
            },
          },
          { path: '*', Component: NotFoundPage },
        ],
      },
    ],
  },
]);
