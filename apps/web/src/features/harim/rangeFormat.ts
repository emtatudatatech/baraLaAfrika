import type { RangeSummary } from '@bla/shared';

import type { IconName } from '../../components/Icon/iconNames';
import { strings } from '../../lib/strings';

const text = strings.harim.ranges;

export function rangeIcon(type: RangeSummary['rangeType']): IconName {
  if (type === 'volcanic') return 'volcano';
  if (type === 'fold') return 'landscape_2';
  return 'landscape';
}

export function rangeTypeLabel(type: RangeSummary['rangeType']): string {
  return type === null ? text.noType : text.types[type];
}
