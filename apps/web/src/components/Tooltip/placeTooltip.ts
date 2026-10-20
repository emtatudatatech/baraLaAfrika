export interface Size {
  width: number;
  height: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const VIEWPORT_MARGIN = 8;
export const GAP = 8;

/**
 * Positions a tooltip next to its trigger: centred horizontally, on the preferred side if it
 * fits, otherwise flipped, and always clamped inside the viewport (never clipped).
 */
export function placeTooltip(
  trigger: RectLike,
  tooltip: Size,
  viewport: Size,
  preferred: 'top' | 'bottom',
): { left: number; top: number; side: 'top' | 'bottom' } {
  const spaceAbove = trigger.top - GAP - VIEWPORT_MARGIN;
  const spaceBelow = viewport.height - (trigger.top + trigger.height) - GAP - VIEWPORT_MARGIN;
  let side: 'top' | 'bottom' = preferred;
  if (preferred === 'top' && tooltip.height > spaceAbove && spaceBelow > spaceAbove)
    side = 'bottom';
  if (preferred === 'bottom' && tooltip.height > spaceBelow && spaceAbove > spaceBelow)
    side = 'top';

  const rawTop =
    side === 'top' ? trigger.top - GAP - tooltip.height : trigger.top + trigger.height + GAP;
  const rawLeft = trigger.left + trigger.width / 2 - tooltip.width / 2;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - tooltip.width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - tooltip.height - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(rawTop, VIEWPORT_MARGIN), maxTop),
    side,
  };
}
