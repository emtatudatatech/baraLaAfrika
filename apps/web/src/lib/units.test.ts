import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { formatElevation, otherUnit, useUnits } from './units';

afterEach(() => {
  window.localStorage.clear();
});

describe('formatElevation', () => {
  it('formats metres and feet with grouping', () => {
    expect(formatElevation(5895)).toBe('5,895\u00a0m');
    expect(formatElevation(5895, 'ft')).toBe('19,341\u00a0ft');
    expect(formatElevation(0, 'ft')).toBe('0\u00a0ft');
  });

  it('uses a true minus sign for depths below sea level', () => {
    expect(formatElevation(-155)).toBe('−155\u00a0m');
    expect(formatElevation(-155, 'ft')).toBe('−509\u00a0ft');
    expect(formatElevation(-155)).not.toContain('-');
  });

  it('names the other unit', () => {
    expect(otherUnit('m')).toBe('ft');
    expect(otherUnit('ft')).toBe('m');
  });
});

describe('useUnits', () => {
  it('defaults to metres, persists feet and updates every user of the hook', () => {
    const first = renderHook(() => useUnits());
    const second = renderHook(() => useUnits());
    expect(first.result.current[0]).toBe('m');
    act(() => {
      first.result.current[1]('ft');
    });
    expect(first.result.current[0]).toBe('ft');
    expect(second.result.current[0]).toBe('ft');
    expect(window.localStorage.getItem('bla-units')).toBe('ft');
    act(() => {
      second.result.current[1]('m');
    });
    expect(first.result.current[0]).toBe('m');
    expect(window.localStorage.getItem('bla-units')).toBeNull();
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem('bla-units', 'furlongs');
    expect(renderHook(() => useUnits()).result.current[0]).toBe('m');
  });
});
