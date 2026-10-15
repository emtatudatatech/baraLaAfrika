import { type ReactNode, useEffect, useMemo } from 'react';

import { api } from '../../lib/api';
import { darkThemePalette } from '../../lib/colour';
import { useResource } from '../../lib/useResource';
import { RegionsContext } from './regionsContext';

/**
 * Loads the regions once and publishes their approved colours as CSS custom properties
 * (--region-<slug>-light / -dark), which tokens.css maps to --region-<slug> per theme.
 */
export function RegionsProvider({ children }: { children: ReactNode }) {
  const resource = useResource('regions', () => api.regions());
  const regions = resource.data?.regions;

  useEffect(() => {
    if (!regions) return;
    const light: Record<string, string> = {};
    for (const region of regions) if (region.colorHex) light[region.slug] = region.colorHex;
    const dark = darkThemePalette(light);
    const style = document.documentElement.style;
    for (const [slug, hex] of Object.entries(light)) {
      style.setProperty(`--region-${slug}-light`, hex);
      style.setProperty(`--region-${slug}-dark`, dark[slug] ?? hex);
    }
  }, [regions]);

  const value = useMemo(
    () => ({ resource, bySlug: new Map((regions ?? []).map((r) => [r.slug, r])) }),
    [resource, regions],
  );
  return <RegionsContext value={value}>{children}</RegionsContext>;
}
