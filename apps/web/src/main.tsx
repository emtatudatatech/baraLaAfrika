import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';

import { AppReady } from './app/AppReady';
import { RegionsProvider } from './app/data/RegionsProvider';
import { loadMatchedRoutes } from './app/hydration';
import { routes } from './app/router';
import { ThemeProvider } from './app/theme/ThemeProvider';

const container = document.getElementById('root');
if (container === null) throw new Error('#root element missing from index.html');

// The main pages ship their first view prerendered (build/prerender.ts). A bare URL hydrates it,
// keeping the painted page; a URL with a query (filters, an open drawer) renders afresh, since
// its first view differs from the prerendered one.
const hydrate = container.hasChildNodes() && window.location.search === '';
if (hydrate) await loadMatchedRoutes(routes, window.location);

const app = (
  <StrictMode>
    <ThemeProvider>
      <RegionsProvider>
        <RouterProvider router={createBrowserRouter(routes)} />
        <AppReady />
      </RegionsProvider>
    </ThemeProvider>
  </StrictMode>
);

if (hydrate) hydrateRoot(container, app);
else createRoot(container).render(app);
