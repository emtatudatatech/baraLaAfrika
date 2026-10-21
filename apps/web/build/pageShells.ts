import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ChunkMetadata, Plugin, ResolvedConfig, Rolldown } from 'vite';

/*
 * Page shells: a copy of the built index.html for /countries, /harim, /dhahabu and every
 * mountain and range page, with that page's title, description and Open Graph tags. Social
 * crawlers do not run JavaScript, so without these every shared link would show the site's
 * generic text. Browsers get the same single-page app either way. Each shell is a flat file
 * (`harim.html`, `harim/peaks/<slug>.html`): Netlify serves /harim from harim.html as is, while a
 * folder's harim/index.html would answer /harim with a redirect to /harim/.
 *
 * Each shell (and index.html, for the home page) also preloads its own route's code-split chunk
 * and styles, so they download alongside the entry instead of after it has run. The build also
 * writes sitemap.xml and points robots.txt at it when the deploy's address is known.
 */

export interface ShellMeta {
  /** Path without leading slash, e.g. "harim/peaks/mount-kenya". */
  path: string;
  title: string;
  description: string;
  /** Site-relative image path, e.g. "/og/harim.png". */
  image: string;
}

/** The single-page app with no page of its own, served for every path without a shell. */
export const APP_HTML = 'app.html';

const SITE = 'Bara La Afrika';
const HARIM = 'Harim · Mountains of Africa';
const DHAHABU = 'Dhahabu · Gold in Africa';

/** Which route module each shell path renders (its lazy chunk is preloaded). */
export const ROUTE_MODULES: readonly { match: (path: string) => boolean; module: string }[] = [
  { match: (path) => path === '', module: 'features/map/HomePage.tsx' },
  { match: (path) => path === 'countries', module: 'features/countries/CountriesPage.tsx' },
  { match: (path) => path.startsWith('harim/peaks/'), module: 'features/harim/PeakPage.tsx' },
  { match: (path) => path.startsWith('harim/ranges/'), module: 'features/harim/RangePage.tsx' },
  { match: (path) => path === 'harim', module: 'features/harim/HarimPage.tsx' },
  { match: (path) => path === 'dhahabu', module: 'features/dhahabu/DhahabuPage.tsx' },
];

/** A route chunk's files that the entry does not already load. */
export interface RouteAssets {
  js: string[];
  css: string[];
}

type ChunkWithCss = Rolldown.OutputChunk & { viteMetadata?: Pick<ChunkMetadata, 'importedCss'> };

/** Each route module's chunk, its static imports and their styles, minus the entry's own. */
export function routeAssets(bundle: Rolldown.OutputBundle): Map<string, RouteAssets> {
  const chunks = Object.values(bundle).filter(
    (c: Rolldown.OutputAsset | Rolldown.OutputChunk): c is ChunkWithCss => c.type === 'chunk',
  );
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const closure = (start: ChunkWithCss): Set<string> => {
    const seen = new Set<string>();
    const visit = (chunk: ChunkWithCss | undefined) => {
      if (!chunk || seen.has(chunk.fileName)) return;
      seen.add(chunk.fileName);
      for (const file of chunk.imports) visit(byFile.get(file));
    };
    visit(start);
    return seen;
  };
  const entry = chunks.find((chunk) => chunk.isEntry);
  const loaded = entry ? closure(entry) : new Set<string>();
  const assets = new Map<string, RouteAssets>();
  for (const { module } of ROUTE_MODULES) {
    const chunk = chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith(module));
    if (!chunk) continue;
    const files = [...closure(chunk)].filter((file) => !loaded.has(file));
    assets.set(module, {
      js: files,
      css: files.flatMap((file) => [...(byFile.get(file)?.viteMetadata?.importedCss ?? [])]),
    });
  }
  return assets;
}

/**
 * The html with <link>s that load a route's styles and (unless `scripts` is false) fetch its
 * chunks early, before </head>. Prerendered pages paint without their scripts, so they take the
 * styles only and leave the script's bandwidth to what the first paint needs.
 */
export function withPreloads(
  html: string,
  assets: RouteAssets | undefined,
  base = '/',
  scripts = true,
): string {
  if (!assets) return html;
  const tags = [
    // Stylesheets, not preloads: prerendered pages need them to paint (Vite's loader skips a
    // stylesheet that is already linked when the route's chunk later imports it).
    ...assets.css.map((file) => `<link rel="stylesheet" crossorigin href="${base}${file}" />`),
    ...(scripts
      ? assets.js.map((file) => `<link rel="modulepreload" crossorigin href="${base}${file}" />`)
      : []),
  ];
  return tags.length === 0
    ? html
    : html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`);
}

/** The route module a shell path renders, if any. */
export function routeModuleOf(path: string): string | undefined {
  return ROUTE_MODULES.find((route) => route.match(path))?.module;
}

/** The top-level pages' shells (Harim's are in harimShells). */
export function siteShells(): ShellMeta[] {
  return [
    {
      path: 'countries',
      title: `Countries · ${SITE}`,
      description:
        'All 54 African states: the meaning of their names, their flags, national symbols and national animals.',
      image: '/og/site.png',
    },
    {
      path: 'dhahabu',
      title: `${DHAHABU} · ${SITE}`,
      description:
        'Where gold is found in Africa, how much is mined and traded, and how much central banks hold.',
      image: '/og/dhahabu.png',
    },
  ];
}

/** sitemap.xml for the site's pages (absolute URLs, as the protocol requires). */
export function sitemapXml(origin: string, paths: readonly string[]): string {
  const urls = paths
    .map((path) => `  <url><loc>${escapeAttribute(`${origin}/${path}`)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt: everything allowed, and the sitemap when its address is known. */
export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${origin}/sitemap.xml\n` : ''}`;
}
const number = new Intl.NumberFormat('en');

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function setMeta(html: string, attribute: 'name' | 'property', key: string, value: string): string {
  const tag = `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`;
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/>`);
  return pattern.test(html)
    ? html.replace(pattern, tag)
    : html.replace('</head>', `    ${tag}\n  </head>`);
}

/** The built index.html with one page's title, description and preview tags. */
export function renderShell(html: string, meta: ShellMeta, origin: string): string {
  const url = `${origin}/${meta.path}`;
  let out = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeAttribute(meta.title)}</title>`,
  );
  out = setMeta(out, 'name', 'description', meta.description);
  out = setMeta(out, 'property', 'og:title', meta.title);
  out = setMeta(out, 'property', 'og:description', meta.description);
  out = setMeta(out, 'property', 'og:image', `${origin}${meta.image}`);
  out = setMeta(out, 'property', 'og:url', url);
  out = setMeta(out, 'name', 'twitter:image', `${origin}${meta.image}`);
  return out;
}

interface SeedMountain {
  slug: string;
  name: string;
  elevation_m: number;
  countries: { iso3: string }[];
  territory_name: string | null;
  range: string | null;
  summit_kind: string;
}

/** The Harim pages' metadata, from the committed seeds (no database at build time). */
export function harimShells(seeds: {
  mountains: SeedMountain[];
  ranges: { slug: string; name: string; description: string | null }[];
  countryNames: ReadonlyMap<string, string>;
}): ShellMeta[] {
  const image = '/og/harim.png';
  const shells: ShellMeta[] = [
    {
      path: 'harim',
      title: `${HARIM} · ${SITE}`,
      description: 'Africa’s mountains and their heights, country by country.',
      image,
    },
  ];
  for (const m of seeds.mountains) {
    const where =
      m.territory_name ??
      m.countries.map((c) => seeds.countryNames.get(c.iso3) ?? c.iso3).join(', ');
    shells.push({
      path: `harim/peaks/${m.slug}`,
      title: `${m.name} · ${HARIM} · ${SITE}`,
      description: `${m.name} (${number.format(m.elevation_m)} m) in ${where}: height, sources, names and nearby peaks.`,
      image,
    });
  }
  const counted = new Map<string, number>();
  for (const m of seeds.mountains) {
    if (m.range && m.summit_kind !== 'summit' && m.territory_name === null) {
      counted.set(m.range, (counted.get(m.range) ?? 0) + 1);
    }
  }
  for (const range of seeds.ranges) {
    const count = counted.get(range.slug) ?? 0;
    if (count === 0) continue;
    shells.push({
      path: `harim/ranges/${range.slug}`,
      title: `${range.name} · ${HARIM} · ${SITE}`,
      description:
        range.description ??
        `${range.name}: ${String(count)} ${count === 1 ? 'mountain' : 'mountains'}.`,
      image,
    });
  }
  return shells;
}

/** The deploy's address (Netlify sets URL / DEPLOY_PRIME_URL); empty locally. */
export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const origin = env.CONTEXT === 'production' ? env.URL : (env.DEPLOY_PRIME_URL ?? env.URL);
  return (origin ?? '').replace(/\/$/, '');
}

export function pageShellsPlugin(seedsDir: string): Plugin {
  let config: ResolvedConfig;
  let assets = new Map<string, RouteAssets>();
  return {
    name: 'bla-page-shells',
    // Builds write the shells; `vite preview` serves them (see configurePreviewServer).
    // Client builds and `vite preview`; not the prerender's server build.
    apply: (_config, env) =>
      (env.command === 'build' && env.isSsrBuild !== true) || env.isPreview === true,
    configResolved(resolved) {
      config = resolved;
    },
    // `vite preview` (local checks and e2e) serves a page's shell (e.g. /harim/peaks/<slug> from
    // harim/peaks/<slug>.html) as Netlify does, instead of falling back to the plain app.
    configurePreviewServer(server) {
      const outDir = join(config.root, config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const [path = '', query] = (request.url ?? '').split('?');
        const suffix = query ? `?${query}` : '';
        if (
          path !== '/' &&
          !path.endsWith('/') &&
          !path.includes('.') &&
          !path.startsWith('/api')
        ) {
          const shell = join(outDir, `${path}.html`);
          // A page's shell, or (like netlify.toml's fallback) the plain app for any other path.
          request.url = existsSync(shell) ? `${path}.html${suffix}` : `/${APP_HTML}${suffix}`;
        }
        next();
      });
    },
    // The site's own preview image on every page that has no shell of its own.
    transformIndexHtml(html) {
      return setMeta(
        setMeta(html, 'property', 'og:image', `${siteOrigin()}/og/site.png`),
        'name',
        'twitter:image',
        `${siteOrigin()}/og/site.png`,
      );
    },
    generateBundle(_options, bundle) {
      assets = routeAssets(bundle);
    },
    async closeBundle() {
      const outDir = join(config.root, config.build.outDir);
      const html = await readFile(join(outDir, 'index.html'), 'utf8');
      // The prerendered pages (build/prerender.ts) paint without scripts: styles only.
      const prerendered = new Set(['', 'countries', 'harim', 'dhahabu']);
      const preloaded = (path: string) => {
        const module = routeModuleOf(path);
        return withPreloads(
          html,
          module === undefined ? undefined : assets.get(module),
          config.base,
          !prerendered.has(path),
        );
      };
      // Every path without a page of its own gets the plain app (netlify.toml's fallback); the
      // home page preloads its route, and is prerendered after the build (build/prerender.ts).
      await writeFile(join(outDir, APP_HTML), html);
      await writeFile(join(outDir, 'index.html'), preloaded(''));
      const read = async (name: string): Promise<unknown> =>
        JSON.parse(await readFile(join(seedsDir, name), 'utf8')) as unknown;
      const { mountains } = (await read('mountains.json')) as { mountains: SeedMountain[] };
      const { ranges } = (await read('mountain_ranges.json')) as {
        ranges: { slug: string; name: string; description: string | null }[];
      };
      const { countries } = (await read('countries.json')) as {
        countries: { iso3: string; name: string }[];
      };
      const shells = [
        ...siteShells(),
        ...harimShells({
          mountains,
          ranges,
          countryNames: new Map(countries.map((c) => [c.iso3, c.name])),
        }),
      ];
      const origin = siteOrigin();
      await Promise.all(
        shells.map(async (shell) => {
          const file = join(outDir, `${shell.path}.html`);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, renderShell(preloaded(shell.path), shell, origin));
        }),
      );
      config.logger.info(`bla-page-shells: wrote ${String(shells.length)} page shells`);
      await writeFile(join(outDir, 'robots.txt'), robotsTxt(origin));
      if (origin) {
        await writeFile(
          join(outDir, 'sitemap.xml'),
          sitemapXml(origin, ['', ...shells.map((shell) => shell.path)]),
        );
        config.logger.info(`bla-page-shells: wrote sitemap.xml for ${origin}`);
      } else {
        config.logger.info('bla-page-shells: no site address (URL), so no sitemap.xml');
      }
    },
  };
}
