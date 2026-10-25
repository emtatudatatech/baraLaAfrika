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
  {
    name: 'UN M49 standard',
    href: 'https://unstats.un.org/unsd/methodology/m49/',
    licence: 'Cited classification; the table is not republished',
    note: 'The five regions (Middle Africa is shown as Central Africa)',
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
    note: 'Curated mountain facts, each cited to its article; current leaders and next elections, from its lists',
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
    note: 'Source: International Monetary Fund, International Liquidity, World Economic Outlook and Exchange Rates (data.imf.org). Transformed: ounces converted to tonnes, US dollar values computed at monthly average prices, and exchange rates put on today’s currency unit where a currency changed; see each export for details.',
  },
  {
    name: 'U.S. Geological Survey',
    href: 'https://www.usgs.gov/',
    licence: 'Public domain (U.S. Government work)',
  },
  {
    name: 'World Bank',
    href: 'https://www.worldbank.org/',
    licence: 'CC BY 4.0',
    note: 'Source: World Bank, World Development Indicators and International Debt Statistics',
  },
  {
    name: 'SIPRI Military Expenditure Database',
    href: 'https://www.sipri.org/databases/milex',
    licence: 'SIPRI terms: non-commercial use of a small part of the database, credited',
    note: 'Military spending, the latest ten years, read through the World Bank',
  },
  {
    name: 'UNDP Human Development Report',
    href: 'https://hdr.undp.org/',
    licence: 'CC BY 3.0 IGO',
    note: 'The Human Development Index, read from Our World in Data’s copy of the series when UNDP’s site does not answer',
  },
  {
    name: 'European Central Bank',
    href: 'https://data.ecb.europa.eu/',
    licence: 'Source: ECB statistics',
    note: 'Daily reference rates; currencies fixed to the euro or the rand are derived from them at their official parities',
  },
  {
    name: 'Bank for International Settlements',
    href: 'https://data.bis.org/topics/XRU',
    licence: 'Unrestricted use, with the BIS cited as the source',
    note: 'Daily US dollar rates for Algeria and Mauritius',
  },
  {
    name: 'Central banks of Kenya, Tanzania, Zambia, Angola, The Gambia, Liberia, Malawi, Tunisia and Morocco',
    href: 'https://frankfurter.dev/',
    licence: 'Official rates published for public use',
    note: 'Each bank’s daily rates as published, read through Frankfurter (MIT-licensed)',
  },
  {
    name: 'UN Comtrade',
    href: 'https://comtradeplus.un.org/',
    licence: 'UN Comtrade terms of use',
  },
];
