import type { VinaraMetricKey } from '@bla/shared';

import type { IconName } from '../../components/Icon/iconNames';

/** Each measure's icon. */
export const METRIC_ICONS: Record<VinaraMetricKey, IconName> = {
  population: 'groups',
  land_area: 'map',
  gdp_usd: 'paid',
  gdp_ppp: 'shopping_basket',
  gdp_per_capita_ppp: 'person',
  gdp_growth: 'trending_up',
  inflation: 'price_change',
  government_debt: 'account_balance',
  gni_usd: 'payments',
  currency_performance: 'currency_exchange',
  currency_stability: 'balance',
  military_usd: 'shield',
  hdi: 'school',
};
