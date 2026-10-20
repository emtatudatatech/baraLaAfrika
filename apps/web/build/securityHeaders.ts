import { createHash } from 'node:crypto';

import type { Plugin } from 'vite';

/** Every inline classic <script> in the built HTML (the theme bootstrap). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = match[1] ?? '';
    if (body.trim() === '') continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export function contentSecurityPolicy(scriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    // Inline style attributes position tooltips/popovers and pass region colours as custom properties.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://flagcdn.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Emits `dist/_headers` with a Content-Security-Policy that allows exactly the inline scripts
 * present in the built index.html (by SHA-256), so the no-flash theme bootstrap runs while all
 * other inline script is blocked. Static security headers live in netlify.toml.
 */
export function securityHeadersPlugin(): Plugin {
  return {
    name: 'bla-security-headers',
    // Client builds only (not the prerender's server build).
    apply: (_config, env) => env.command === 'build' && env.isSsrBuild !== true,
    enforce: 'post',
    generateBundle: {
      // Vite's HTML plugin emits index.html during generateBundle; run after it.
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (index?.type !== 'asset' || typeof index.source !== 'string') {
          this.error('index.html missing from bundle; cannot compute CSP hashes');
        }
        const csp = contentSecurityPolicy(inlineScriptHashes(index.source));
        this.emitFile({
          type: 'asset',
          fileName: '_headers',
          source: `/*\n  Content-Security-Policy: ${csp}\n`,
        });
      },
    },
  };
}
