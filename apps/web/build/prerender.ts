/*
 * After `vite build` and the server build of src/entry-server.tsx, writes each main page's first
 * view into its HTML file (inside <div id="root">), so the layout, header and loading skeletons
 * paint as soon as the CSS arrives instead of after the app's script has run. The app does not
 * hydrate this markup; it renders afresh and replaces it (see src/main.tsx).
 *
 *   node build/prerender.ts   (run by `npm run build`)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(WEB, 'dist');
const SERVER = join(WEB, 'dist-server/entry-server.js');

/** The prerendered pages: the URL path and the file Netlify serves for it. */
export const PRERENDERED = [
  { path: '/', file: 'index.html' },
  { path: '/countries', file: 'countries/index.html' },
  { path: '/harim', file: 'harim/index.html' },
  { path: '/dhahabu', file: 'dhahabu/index.html' },
] as const;

/**
 * The page with the prerendered markup inside #root. Elements React hoists into <head> (title,
 * meta, link) are dropped from the markup: each page's file already carries its own.
 */
export function injectMarkup(html: string, markup: string): string {
  const body = markup.replace(/<(title)\b[^>]*>[\s\S]*?<\/\1>|<(meta|link)\b[^>]*\/?>/g, '');
  const root = '<div id="root"></div>';
  if (!html.includes(root)) throw new Error('No empty <div id="root"></div> to prerender into');
  return html.replace(root, `<div id="root">${body}</div>`);
}

/**
 * A prerendered page paints without its script, so the app starts after that first paint: the
 * module script becomes /boot.js (which imports it a frame later) and the entry's module
 * preloads go, leaving the connection to the styles and fonts the first paint needs. Pages
 * without prerendered markup keep loading the module directly.
 */
export function deferApp(html: string): string {
  const entry = /<script type="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/.exec(html);
  if (!entry?.[1]) throw new Error('No module script to defer');
  return html
    .replace(entry[0], `<script defer src="/boot.js" data-entry="${entry[1]}"></script>`)
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
}

async function main() {
  const { render } = (await import(pathToFileURL(SERVER).href)) as {
    render: (path: string) => Promise<string>;
  };
  for (const page of PRERENDERED) {
    const file = join(DIST, page.file);
    const html = await readFile(file, 'utf8');
    await writeFile(file, deferApp(injectMarkup(html, await render(page.path))));
  }
  console.log(`prerender: wrote the first view of ${String(PRERENDERED.length)} pages`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
