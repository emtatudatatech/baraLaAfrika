import { describe, expect, it } from 'vitest';

import { PRERENDERED, deferApp, injectMarkup } from './prerender';

describe('prerender', () => {
  it('puts the markup in #root and drops what React hoists into <head>', () => {
    const html = '<head><title>Harim</title></head><body><div id="root"></div></body>';
    const markup =
      '<title>Harim · Bara La Afrika</title><meta name="description" content="x"/><link rel="icon" href="/x"/><main><h1>Harim</h1></main>';
    expect(injectMarkup(html, markup)).toBe(
      '<head><title>Harim</title></head><body><div id="root"><main><h1>Harim</h1></main></div></body>',
    );
  });

  it('refuses a page that is already prerendered', () => {
    expect(() => injectMarkup('<div id="root"><main></main></div>', '<main></main>')).toThrow(
      /No empty/,
    );
  });

  it('prerenders the four main pages, each into the file Netlify serves', () => {
    expect(PRERENDERED.map((page) => [page.path, page.file])).toEqual([
      ['/', 'index.html'],
      ['/countries', 'countries.html'],
      ['/harim', 'harim.html'],
      ['/dhahabu', 'dhahabu.html'],
    ]);
  });
});

describe('deferApp', () => {
  it('starts the app from /boot.js and drops the entry preloads', () => {
    const html =
      '<head><script type="module" crossorigin src="/assets/index-1.js"></script>\n    <link rel="modulepreload" crossorigin href="/assets/a.js">\n    <link rel="stylesheet" crossorigin href="/assets/c.css" /></head>';
    expect(deferApp(html)).toBe(
      '<head><script defer src="/boot.js" data-entry="/assets/index-1.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/c.css" /></head>',
    );
  });

  it('fails loudly when there is no module script', () => {
    expect(() => deferApp('<head></head>')).toThrow(/No module script/);
  });
});
