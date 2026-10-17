import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCountUp } from './useCountUp';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCountUp', () => {
  it('counts up to the target within the duration, then stops', () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { result } = renderHook(() => useCountUp(800, true, 800));
    expect(result.current).toEqual({ value: 0, counting: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.counting).toBe(true);
    expect(result.current.value).toBeGreaterThan(400); // ease-out: past halfway at half time
    expect(result.current.value).toBeLessThan(800);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toEqual({ value: 800, counting: false });
  });

  it('shows the target at once with reduced motion, when not animating, or for null', () => {
    stubReducedMotion(true);
    expect(renderHook(() => useCountUp(337, true)).result.current).toEqual({
      value: 337,
      counting: false,
    });
    stubReducedMotion(false);
    expect(renderHook(() => useCountUp(337, false)).result.current.value).toBe(337);
    expect(renderHook(() => useCountUp(null, true)).result.current.value).toBeNull();
  });

  it('shows a new target at once', () => {
    stubReducedMotion(false);
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, true), {
      initialProps: { target: 100 },
    });
    rerender({ target: 48 });
    expect(result.current).toEqual({ value: 48, counting: false });
  });
});
