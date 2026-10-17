import { metresToFeet } from '@bla/shared';
import { useCallback, useSyncExternalStore } from 'react';

import { readStorage, writeStorage } from './storage';

export type Unit = 'm' | 'ft';
const STORAGE_KEY = 'bla-units';
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/**
 * `5,895 m`, `19,341 ft`, `−155 m`: a true minus sign (never a hyphen) and a no-break space, so
 * a figure never wraps away from its unit.
 */
export function formatElevation(metres: number, unit: Unit = 'm'): string {
  const value = Math.round(unit === 'm' ? metres : metresToFeet(metres));
  const text = number.format(Math.abs(value));
  return `${value < 0 ? '\u2212' : ''}${text}\u00a0${unit}`;
}

/** The other unit, for a secondary label. */
export function otherUnit(unit: Unit): Unit {
  return unit === 'm' ? 'ft' : 'm';
}

const listeners = new Set<() => void>();

function readUnit(): Unit {
  return readStorage(STORAGE_KEY) === 'ft' ? 'ft' : 'm';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The viewer's height unit (metres by default), persisted and shared by every component. */
export function useUnits(): [Unit, (unit: Unit) => void] {
  const unit = useSyncExternalStore<Unit>(subscribe, readUnit, () => 'm');
  const setUnit = useCallback((next: Unit) => {
    writeStorage(STORAGE_KEY, next === 'm' ? null : next);
    for (const listener of listeners) listener();
  }, []);
  return [unit, setUnit];
}
