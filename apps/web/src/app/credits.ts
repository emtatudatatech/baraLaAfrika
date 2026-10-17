export interface Credit {
  name: string;
  href: string;
  licence: string;
  note?: string;
}

/**
 * Credits and licences shown in the footer. Attribution wording for sources whose terms require
 * it (GeoNames, the IMF) is reproduced here and in the data exports.
 */
export const CREDITS: readonly Credit[] = [
  {
    name: 'State symbology research document',
    href: '/countries',
    licence: 'Project research; sources cited per country',
  },
  {
    name: 'Natural Earth',
    href: 'https://www.naturalearthdata.com/',
    licence: 'Public domain',
    note: 'Country boundaries (admin-0, 1:50m)',
  },
  { name: 'Flagpedia', href: 'https://flagpedia.net/', licence: 'Flag images via flagcdn.com' },
  {
    name: 'Material Symbols',
    href: 'https://fonts.google.com/icons',
    licence: 'Apache License 2.0',
  },
  {
    name: 'Fraunces and Instrument Sans',
    href: 'https://fontsource.org/',
    licence: 'SIL Open Font License 1.1',
  },
  { name: 'Wikidata', href: 'https://www.wikidata.org/', licence: 'CC0 1.0' },
  {
    name: 'GeoNames',
    href: 'https://www.geonames.org/',
    licence: 'CC BY 4.0, attribution required',
    note: 'Contains data from GeoNames (geonames.org)',
  },
  {
    name: 'The World Factbook (final edition)',
    href: 'https://github.com/factbook/factbook.json',
    licence: 'Public domain (U.S. Government work)',
    note: 'Countries’ highest and lowest points, as a cross-check',
  },
  {
    name: 'Wikipedia',
    href: 'https://www.wikipedia.org/',
    licence: 'CC BY-SA 4.0',
    note: 'Curated mountain facts, each cited to its article',
  },
  {
    name: 'Smithsonian Global Volcanism Program',
    href: 'https://volcano.si.edu/',
    licence: 'Linked for reference only; no data republished',
    note: 'Volcano pages, found through Wikidata',
  },
  {
    name: 'Harim prototype',
    href: 'https://github.com/emtatudatatech/harim',
    licence: 'Curated baseline by emtatudatatech',
  },
  {
    name: 'International Monetary Fund',
    href: 'https://data.imf.org/',
    licence: 'IMF terms of use',
    note: 'Source: International Monetary Fund, International Financial Statistics (data.imf.org). Values may be transformed (e.g. ounces to tonnes); see each export for details.',
  },
  {
    name: 'U.S. Geological Survey',
    href: 'https://www.usgs.gov/',
    licence: 'Public domain (U.S. Government work)',
  },
  {
    name: 'British Geological Survey',
    href: 'https://www.bgs.ac.uk/',
    licence: 'Open Government Licence (to be confirmed)',
  },
  { name: 'World Bank', href: 'https://www.worldbank.org/', licence: 'CC BY 4.0' },
  {
    name: 'UN Comtrade',
    href: 'https://comtradeplus.un.org/',
    licence: 'UN Comtrade terms of use',
  },
  {
    name: 'World Gold Council · Goldhub',
    href: 'https://www.gold.org/goldhub',
    licence: 'Linked for reference only; no data republished',
  },
];
