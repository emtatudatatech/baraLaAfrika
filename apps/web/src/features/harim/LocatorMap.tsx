import type { CountryRef } from '@bla/shared';
import { geoPath } from 'd3-geo';
import { useMemo } from 'react';

import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { fitAfricaProjection } from '../map/projection';
import {
  COUNTRIES_TOPOLOGY_URL,
  type CountriesTopology,
  buildMapGeometry,
  fetchJson,
} from '../map/topology';
import styles from './LocatorMap.module.css';
import { glyphPath } from './map/peakLayout';

const WIDTH = 320;
const HEIGHT = 300;

/**
 * A small Equal Earth inset of Africa marking one mountain (peak pages): its countries are
 * tinted in their region colour. Static (no zoom); the main Harim map is one link away.
 */
export function LocatorMap({
  name,
  lon,
  lat,
  countryIso3s,
  countries,
}: {
  name: string;
  lon: number;
  lat: number;
  countryIso3s: readonly string[];
  countries: ReadonlyMap<string, CountryRef>;
}) {
  // Shared with the other maps: one request per session.
  const geometry = useResource('geo:countries', () =>
    fetchJson<CountriesTopology>(COUNTRIES_TOPOLOGY_URL).then(buildMapGeometry),
  );
  const drawn = useMemo(() => {
    if (geometry.status !== 'success') return null;
    const projection = fitAfricaProjection(WIDTH, HEIGHT, 10);
    const path = geoPath(projection);
    return {
      shapes: geometry.data.shapes.map((shape) => ({
        iso3: shape.iso3,
        d: path(shape.geometry) ?? '',
      })),
      borders: path(geometry.data.borders) ?? '',
      point: projection([lon, lat]),
    };
  }, [geometry, lon, lat]);

  return (
    <div className={cx('glass', styles.frame)}>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={strings.harim.peakPage.locatorLabel(name)}
        data-testid="peak-locator"
      >
        <rect width={WIDTH} height={HEIGHT} className={styles.ocean} />
        {drawn && (
          <>
            {drawn.shapes.map((shape) => {
              const country = countries.get(shape.iso3);
              const own = countryIso3s.includes(shape.iso3);
              return (
                <path
                  key={shape.iso3}
                  d={shape.d}
                  className={cx(styles.country, own && styles.own)}
                  style={
                    own && country
                      ? { '--region': `var(--region-${country.region.slug})` }
                      : undefined
                  }
                />
              );
            })}
            <path d={drawn.borders} className={styles.borders} />
            {drawn.point && (
              <g className={styles.marker}>
                <circle cx={drawn.point[0]} cy={drawn.point[1]} r={14} className={styles.halo} />
                <path d={glyphPath(drawn.point[0], drawn.point[1], 7)} className={styles.glyph} />
              </g>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
