import { describe, expect, it } from 'vitest';

import type { Rolldown } from 'vite';

import {
  harimShells,
  renderShell,
  robotsTxt,
  routeAssets,
  routeModuleOf,
  siteOrigin,
  siteShells,
  sitemapXml,
  withPreloads,
} from './pageShells';

const HTML = `<!doctype html><html><head>
    <title>Bara La Afrika</title>
    <meta
      name="description"
      content="The site."
    />
    <meta property="og:title" content="Bara La Afrika" />
    <meta
      property="og:description"
      content="An explorer."
    />
    <meta name="twitter:card" content="summary_large_image" />
  </head><body></body></html>`;

const seeds = {
  mountains: [
    {
      slug: 'mount-kenya',
      name: 'Mount Kenya',
      elevation_m: 5199,
      countries: [{ iso3: 'KEN' }],
      territory_name: null,
      range: null,
      summit_kind: 'massif',
    },
    {
      slug: 'batian',
      name: 'Batian',
      elevation_m: 5199,
      countries: [{ iso3: 'KEN' }],
      territory_name: null,
      range: 'aberdare',
      summit_kind: 'summit',
    },
    {
      slug: 'teide',
      name: 'Teide "Big" <one>',
      elevation_m: 3715,
      countries: [],
      territory_name: 'Canary Islands',
      range: null,
      summit_kind: 'standalone',
    },
    {
      slug: 'satima',
      name: 'Mount Satima',
      elevation_m: 4001,
      countries: [{ iso3: 'KEN' }],
      territory_name: null,
      range: 'aberdare',
      summit_kind: 'standalone',
    },
  ],
  ranges: [
    { slug: 'aberdare', name: 'Aberdare Range', description: 'A range in Kenya.' },
    { slug: 'empty', name: 'Empty Range', description: null },
  ],
  countryNames: new Map([['KEN', 'Kenya']]),
};

describe('page shells', () => {
  it('describes /harim, every mountain and every range with mountains', () => {
    const shells = harimShells(seeds);
    expect(shells.map((s) => s.path)).toEqual([
      'harim',
      'harim/peaks/mount-kenya',
      'harim/peaks/batian',
      'harim/peaks/teide',
      'harim/peaks/satima',
      'harim/ranges/aberdare',
    ]);
    const kenya = shells.find((s) => s.path === 'harim/peaks/mount-kenya');
    // The same wording the peak page sets for itself (src/lib/strings.test.ts checks that side).
    expect(kenya?.description).toBe(
      'Mount Kenya (5,199 m) in Kenya: height, sources, names and nearby peaks.',
    );
    expect(kenya?.title).toBe('Mount Kenya · Harim · Mountains of Africa · Bara La Afrika');
    expect(shells.find((s) => s.path === 'harim/peaks/teide')?.description).toContain(
      'in Canary Islands',
    );
    expect(shells.find((s) => s.path === 'harim/ranges/aberdare')?.description).toBe(
      'A range in Kenya.',
    );
  });

  it('writes the title, description and preview tags, escaped', () => {
    const [, , , teide] = harimShells(seeds);
    if (!teide) throw new Error('missing');
    const html = renderShell(HTML, teide, 'https://bla.example');
    expect(html).toContain('<title>Teide &quot;Big&quot; &lt;one&gt; · Harim');
    expect(html).toMatch(/<meta name="description" content="Teide &quot;Big&quot;/);
    expect(html).toContain('<meta property="og:title" content="Teide &quot;Big&quot;');
    expect(html).toContain(
      '<meta property="og:image" content="https://bla.example/og/harim.png" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://bla.example/harim/peaks/teide" />',
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://bla.example/og/harim.png" />',
    );
    // One of each tag (replaced, not added).
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it('uses the production URL in production and the deploy URL elsewhere', () => {
    expect(
      siteOrigin({ CONTEXT: 'production', URL: 'https://bla.app/', DEPLOY_PRIME_URL: 'x' }),
    ).toBe('https://bla.app');
    expect(
      siteOrigin({
        CONTEXT: 'deploy-preview',
        URL: 'https://bla.app',
        DEPLOY_PRIME_URL: 'https://p.bla.app',
      }),
    ).toBe('https://p.bla.app');
    expect(siteOrigin({})).toBe('');
  });
});

describe('route preloads, site shells and the sitemap', () => {
  const chunk = (fileName: string, facade: string | null, imports: string[], css: string[] = []) =>
    ({
      type: 'chunk',
      fileName,
      facadeModuleId: facade,
      isEntry: facade === '/app/src/main.tsx',
      imports,
      viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
    }) as unknown as Rolldown.OutputChunk;
  const bundle = {
    'index.js': chunk('assets/index.js', '/app/src/main.tsx', ['assets/shared.js']),
    'shared.js': chunk('assets/shared.js', null, []),
    'home.js': chunk(
      'assets/HomePage.js',
      '/app/src/features/map/HomePage.tsx',
      ['assets/shared.js', 'assets/map.js'],
      ['assets/HomePage.css'],
    ),
    'map.js': chunk('assets/map.js', null, [], ['assets/map.css']),
    'style.css': { type: 'asset', fileName: 'assets/index.css' },
  } as unknown as Rolldown.OutputBundle;

  it('preloads a route’s chunks and styles that the entry does not already load', () => {
    const home = routeAssets(bundle).get('features/map/HomePage.tsx');
    expect(home).toEqual({
      js: ['assets/HomePage.js', 'assets/map.js'],
      css: ['assets/HomePage.css', 'assets/map.css'],
    });
    const html = withPreloads('<head></head>', home);
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/HomePage.css" />');
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/map.js" />');
    expect(html).not.toContain('shared.js');
    expect(withPreloads('<head></head>', undefined)).toBe('<head></head>');
    // Styles only, for a page that paints without its scripts.
    const stylesOnly = withPreloads('<head></head>', home, '/', false);
    expect(stylesOnly).toContain('HomePage.css');
    expect(stylesOnly).not.toContain('modulepreload');
  });

  it('maps each shell to its route', () => {
    expect(routeModuleOf('')).toBe('features/map/HomePage.tsx');
    expect(routeModuleOf('harim/peaks/mount-kenya')).toBe('features/harim/PeakPage.tsx');
    expect(routeModuleOf('dhahabu')).toBe('features/dhahabu/DhahabuPage.tsx');
    expect(routeModuleOf('history')).toBeUndefined();
    expect(siteShells().map((shell) => [shell.path, shell.image])).toEqual([
      ['countries', '/og/site.png'],
      ['dhahabu', '/og/dhahabu.png'],
    ]);
  });

  it('writes a sitemap with absolute URLs and points robots.txt at it', () => {
    const xml = sitemapXml('https://bla.app', ['', 'harim', 'harim/peaks/a&b']);
    expect(xml).toContain('<loc>https://bla.app/</loc>');
    expect(xml).toContain('<loc>https://bla.app/harim/peaks/a&amp;b</loc>');
    expect(robotsTxt('https://bla.app')).toContain('Sitemap: https://bla.app/sitemap.xml');
    expect(robotsTxt('')).toBe('User-agent: *\nAllow: /\n');
  });
});
