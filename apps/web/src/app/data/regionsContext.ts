import type { Region, RegionSlug } from '@bla/shared';
import { createContext, useContext } from 'react';

import type { Resource } from '../../lib/useResource';

export interface RegionsValue {
  resource: Resource<{ regions: Region[] }>;
  bySlug: Map<RegionSlug, Region>;
}

export const RegionsContext = createContext<RegionsValue | null>(null);

export function useRegions(): RegionsValue {
  const value = useContext(RegionsContext);
  if (value === null) throw new Error('useRegions must be used inside <RegionsProvider>');
  return value;
}
