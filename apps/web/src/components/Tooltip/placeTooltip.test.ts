import { describe, expect, it } from 'vitest';

import { GAP, VIEWPORT_MARGIN, placeTooltip } from './placeTooltip';

const viewport = { width: 390, height: 844 };
const tooltip = { width: 200, height: 60 };

describe('placeTooltip', () => {
  it('centres above the trigger when there is room', () => {
    const result = placeTooltip(
      { left: 145, top: 400, width: 100, height: 20 },
      tooltip,
      viewport,
      'top',
    );
    expect(result).toEqual({ left: 95, top: 400 - GAP - 60, side: 'top' });
  });

  it('flips below when there is no room above', () => {
    const result = placeTooltip(
      { left: 145, top: 10, width: 100, height: 20 },
      tooltip,
      viewport,
      'top',
    );
    expect(result.side).toBe('bottom');
    expect(result.top).toBe(10 + 20 + GAP);
  });

  it('clamps to the left and right viewport edges', () => {
    const atLeft = placeTooltip(
      { left: 0, top: 400, width: 20, height: 20 },
      tooltip,
      viewport,
      'top',
    );
    expect(atLeft.left).toBe(VIEWPORT_MARGIN);
    const atRight = placeTooltip(
      { left: 380, top: 400, width: 10, height: 20 },
      tooltip,
      viewport,
      'top',
    );
    expect(atRight.left).toBe(viewport.width - tooltip.width - VIEWPORT_MARGIN);
  });

  it('never returns a position outside the viewport, even for oversized tooltips', () => {
    const huge = { width: 500, height: 900 };
    const result = placeTooltip(
      { left: 100, top: 100, width: 10, height: 10 },
      huge,
      viewport,
      'bottom',
    );
    expect(result.left).toBe(VIEWPORT_MARGIN);
    expect(result.top).toBe(VIEWPORT_MARGIN);
  });
});
