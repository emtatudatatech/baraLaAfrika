-- 0010_regions_m49.sql
-- The five regions follow the UN M49 standard. Membership and names are data
-- (db/seeds/countries.json); this migration only updates the table descriptions, which named
-- the research document's grouping.

COMMENT ON TABLE regions IS
  'The five UN M49 regions of Africa (Northern, Western, Middle — shown as Central — Eastern and Southern Africa). Data, so it can change.';
COMMENT ON COLUMN regions.name IS
  'Display name, e.g. "Western Africa" (M49''s names, except Middle Africa, shown as "Central Africa").';
COMMENT ON COLUMN regions.description IS
  'Regional introduction from the research document (citations removed); written for the document''s grouping, which differs from M49 for five states.';
COMMENT ON COLUMN countries.region_id IS 'The country''s UN M49 region.';
