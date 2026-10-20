import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router';

import { AppReady } from './app/AppReady';
import { RegionsProvider } from './app/data/RegionsProvider';
import { routes } from './app/router';
import { ThemeProvider } from './app/theme/ThemeProvider';

/**
 * The build's prerender (build/prerender.ts): a page's first view (layout, header, controls and
 * loading skeletons, before any data) as HTML, so it paints before the app's script has loaded.
 * The browser does not hydrate it; the app renders afresh and replaces it (see main.tsx).
 */
export async function render(path: string): Promise<string> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(path, 'http://localhost')));
  if (context instanceof Response) throw new Error(`${path} redirected while prerendering`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(
    <StrictMode>
      <ThemeProvider>
        <RegionsProvider>
          <StaticRouterProvider router={router} context={context} hydrate={false} />
          {/* The same tree as main.tsx (AppReady renders nothing), so hydration matches. */}
          <AppReady />
        </RegionsProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
