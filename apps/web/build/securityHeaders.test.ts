import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, inlineScriptHashes } from './securityHeaders';

describe('security headers', () => {
  it('hashes inline classic scripts and ignores external ones', () => {
    const html =
      '<script>a()</script><script type="module" src="/x.js"></script><script>\n</script>';
    const expected = `'sha256-${createHash('sha256').update('a()').digest('base64')}'`;
    expect(inlineScriptHashes(html)).toEqual([expected]);
  });

  it('allows exactly the theme bootstrap script in index.html', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const csp = contentSecurityPolicy(hashes);
    expect(csp).toContain(`script-src 'self' ${hashes[0] ?? ''}`);
    expect(csp).not.toContain("'unsafe-inline' https");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("img-src 'self' data: https://flagcdn.com");
  });
});
