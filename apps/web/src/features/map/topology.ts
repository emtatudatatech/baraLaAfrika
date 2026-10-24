import type { MultiLineString, MultiPolygon } from 'geojson';
import { merge, mesh } from 'topojson-client';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';

/* Map geometry from the topologies written by `python -m pipelines boundaries`. */

export interface CountryGeometryProps {
  iso3: string;
  disputed?: boolean;
}

export type CountriesTopology = Topology<{
  countries: GeometryCollection<CountryGeometryProps>;
}>;
export type ContextTopology = Topology<{ land: GeometryCollection }>;

export interface MapShape {
  iso3: string;
  disputed: boolean;
  geometry: MultiPolygon;
}

export interface MapGeometry {
  shapes: MapShape[];
  /** Land borders between different countries (drawn once, not per country). */
  borders: MultiLineString;
  /** Coastlines (edges belonging to a single shape). */
  coast: MultiLineString;
  /** The borders between two countries for which `test(iso3, iso3)` holds. */
  bordersWhere: (test: (a: string, b: string) => boolean) => MultiLineString;
}

export const COUNTRIES_TOPOLOGY_URL = '/geo/africa.topo.json';
export const CONTEXT_TOPOLOGY_URL = '/geo/africa-context.topo.json';

/** The iso3/disputed properties the boundaries pipeline writes on each geometry. */
function propsOf(geometry: { properties?: unknown }): CountryGeometryProps | undefined {
  const props = geometry.properties as Partial<CountryGeometryProps> | undefined;
  return typeof props?.iso3 === 'string'
    ? { iso3: props.iso3, disputed: props.disputed === true }
    : undefined;
}

export function buildMapGeometry(topology: CountriesTopology): MapGeometry {
  const collection = topology.objects.countries;
  const groups = new Map<string, GeometryObject[]>();
  for (const geometry of collection.geometries) {
    const props = propsOf(geometry);
    if (!props) continue;
    const group = groups.get(props.iso3) ?? [];
    group.push(geometry);
    groups.set(props.iso3, group);
  }
  // Merging dissolves shared edges, so Somaliland (tagged SOM) and Somalia become one shape.
  const shapes = [...groups.entries()].map(([iso3, geometries]) => ({
    iso3,
    disputed: geometries.some((g) => propsOf(g)?.disputed === true),
    geometry: merge(topology, geometries as Parameters<typeof merge>[1]),
  }));
  const isoOf = (g: GeometryObject) => propsOf(g)?.iso3;
  return {
    shapes,
    borders: mesh(topology, collection, (a, b) => a !== b && isoOf(a) !== isoOf(b)),
    coast: mesh(topology, collection, (a, b) => a === b),
    bordersWhere: (test) =>
      mesh(topology, collection, (a, b) => {
        const [first, second] = [isoOf(a), isoOf(b)];
        return (
          a !== b &&
          first !== second &&
          first !== undefined &&
          second !== undefined &&
          test(first, second)
        );
      }),
  };
}

export function buildContextLand(topology: ContextTopology): MultiPolygon {
  return merge(topology, topology.objects.land.geometries as Parameters<typeof merge>[1]);
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${String(response.status)})`);
  return (await response.json()) as T;
}
