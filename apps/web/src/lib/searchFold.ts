/**
 * Lower-case and strip combining accents, so "cote" matches "Côte d'Ivoire" and "sao" matches
 * "São Tomé" (the same rule as the database's `search_fold`). Curly apostrophes become straight.
 */
export function searchFold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'");
}
