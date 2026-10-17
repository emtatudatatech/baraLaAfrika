import { describe, expect, it } from 'vitest';

import { harimShells, renderShell, siteOrigin } from './pageShells';

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
