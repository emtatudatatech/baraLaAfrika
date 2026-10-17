import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

/*
 * Page shells for link previews: a copy of the built index.html for /harim and for every
 * mountain and range page, with that page's title, description and Open Graph tags. Social
 * crawlers do not run JavaScript, so without these every shared link would show the site's
 * generic text. Browsers get the same single-page app either way; Netlify serves
 * /harim/peaks/<slug>/index.html before the SPA fallback.
 */

export interface ShellMeta {
  /** Path without leading slash, e.g. "harim/peaks/mount-kenya". */
  path: string;
  title: string;
  description: string;
  /** Site-relative image path, e.g. "/og/harim.png". */
  image: string;
}

const SITE = 'Bara La Afrika';
const HARIM = 'Harim · Mountains of Africa';
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
  return {
    name: 'bla-page-shells',
    // Builds write the shells; `vite preview` serves them (see configurePreviewServer).
    apply: (_config, env) => env.command === 'build' || env.isPreview === true,
    configResolved(resolved) {
      config = resolved;
    },
    // `vite preview` (local checks and e2e) serves a shell for /harim/peaks/<slug> as Netlify
    // does, instead of falling back to the plain index.html.
    configurePreviewServer(server) {
      const outDir = join(config.root, config.build.outDir);
      server.middlewares.use((request, _response, next) => {
        const [path = '', query] = (request.url ?? '').split('?');
        if (path.startsWith('/harim') && !path.endsWith('/') && !path.includes('.')) {
          const shell = join(outDir, path, 'index.html');
          if (existsSync(shell)) request.url = `${path}/index.html${query ? `?${query}` : ''}`;
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
    async closeBundle() {
      const outDir = join(config.root, config.build.outDir);
      const html = await readFile(join(outDir, 'index.html'), 'utf8');
      const read = async (name: string): Promise<unknown> =>
        JSON.parse(await readFile(join(seedsDir, name), 'utf8')) as unknown;
      const { mountains } = (await read('mountains.json')) as { mountains: SeedMountain[] };
      const { ranges } = (await read('mountain_ranges.json')) as {
        ranges: { slug: string; name: string; description: string | null }[];
      };
      const { countries } = (await read('countries.json')) as {
        countries: { iso3: string; name: string }[];
      };
      const shells = harimShells({
        mountains,
        ranges,
        countryNames: new Map(countries.map((c) => [c.iso3, c.name])),
      });
      const origin = siteOrigin();
      await Promise.all(
        shells.map(async (shell) => {
          const file = join(outDir, shell.path, 'index.html');
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, renderShell(html, shell, origin));
        }),
      );
      config.logger.info(`bla-page-shells: wrote ${String(shells.length)} page shells`);
    },
  };
}
