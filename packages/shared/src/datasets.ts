/**
 * Dataset keys referenced by routes (for the data ribbon) and by the `datasets` table.
 * Keep in sync with the rows the pipelines write; tests check the seed against this list.
 */
export const DATASET_KEYS = [
  'symbology-pdf',
  'flags-flagpedia',
  'boundaries-natural-earth',
  'mountains-baseline',
  'mountains-wikidata',
  'mountains-geonames',
  'gold-price',
  'gold-production',
  'gold-official-reserves',
  'gold-trade',
  'gold-presence',
  'gold-mines',
  'vinara-wdi',
  'vinara-imf-weo',
  'vinara-sipri',
  'vinara-hdr',
  'vinara-ids',
  'vinara-leaders',
  'vinara-elections',
  'vinara-fx-imf',
  'vinara-fx-daily',
] as const;

export type DatasetKey = (typeof DATASET_KEYS)[number];
