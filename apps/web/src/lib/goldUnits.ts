import { type GoldUnit, TROY_OZ_PER_TONNE } from '@bla/shared';
import { useCallback, useSyncExternalStore } from 'react';

import { readStorage, writeStorage } from './storage';

/*
 * Dhahabu's units: tonnes are stored; kilograms and troy ounces are display conversions with the
 * shared constant. Money is nominal US dollars. Figures keep a no-break space before their unit
 * and a true minus sign.
 */

const STORAGE_KEY = 'bla-gold-units';
const MINUS = '−';
const NBSP = ' ';

function fixed(value: number, digits: number): string {
  return new Intl.NumberFormat('en', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
}

function signed(value: number, text: string, sign: boolean): string {
  if (value < 0) return `${MINUS}${text}`;
  return sign && value > 0 ? `+${text}` : text;
}

/** Decimals that keep about three significant figures for tonnes. */
function tonneDigits(tonnes: number): number {
  const size = Math.abs(tonnes);
  if (size === 0 || size >= 100) return 0;
  if (size >= 10) return 1;
  if (size >= 1) return 2;
  return 3;
}

/** A mass in the chosen unit: `149 t`, `149,000 kg`, `4.79 million oz`. */
export function formatMass(tonnes: number, unit: GoldUnit, { sign = false } = {}): string {
  switch (unit) {
    case 't':
      return `${signed(tonnes, fixed(tonnes, tonneDigits(tonnes)), sign)}${NBSP}t`;
    case 'kg': {
      const kg = tonnes * 1000;
      return `${signed(kg, fixed(kg, Math.abs(kg) < 10 && kg !== 0 ? 1 : 0), sign)}${NBSP}kg`;
    }
    case 'oz': {
      const oz = tonnes * TROY_OZ_PER_TONNE;
      const size = Math.abs(oz);
      const text =
        size >= 1e6 ? `${fixed(oz / 1e6, size >= 1e8 ? 0 : 2)}${NBSP}million` : fixed(oz, 0);
      return `${signed(oz, text, sign)}${NBSP}oz`;
    }
  }
}

/** The unit word alone, for a column header or a card's unit. */
export function massUnitLabel(unit: GoldUnit): string {
  return unit === 't' ? 't' : unit === 'kg' ? 'kg' : 'troy oz';
}

/** Nominal US dollars, compact: `US$7.62 bn`, `US$345 m`, `US$12,345`. */
export function formatUsd(value: number, { sign = false } = {}): string {
  const size = Math.abs(value);
  let text: string;
  if (size >= 1e9) text = `${fixed(value / 1e9, size >= 1e11 ? 0 : size >= 1e10 ? 1 : 2)}${NBSP}bn`;
  else if (size >= 1e6) text = `${fixed(value / 1e6, size >= 1e8 ? 0 : 1)}${NBSP}m`;
  else text = fixed(value, 0);
  return signed(value, `US$${text}`, sign);
}

/** A price per troy ounce: `US$4,319/oz`. */
export function formatPrice(usdPerOz: number): string {
  return `US$${fixed(usdPerOz, usdPerOz >= 1000 ? 0 : 2)}/oz`;
}

/** A percentage: `63.1%` (one decimal). */
export function formatPct(value: number, { sign = false } = {}): string {
  return signed(value, `${fixed(value, 1)}%`, sign);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An ISO date as its month: `2026-07-31` → `Jul 2026`. */
export function formatMonth(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`;
}

const listeners = new Set<() => void>();

function readUnit(): GoldUnit {
  const stored = readStorage(STORAGE_KEY);
  return stored === 'kg' || stored === 'oz' ? stored : 't';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The viewer's gold mass unit (tonnes by default), persisted and shared by every component. */
export function useGoldUnit(): [GoldUnit, (unit: GoldUnit) => void] {
  const unit = useSyncExternalStore<GoldUnit>(subscribe, readUnit, () => 't');
  const setUnit = useCallback((next: GoldUnit) => {
    writeStorage(STORAGE_KEY, next === 't' ? null : next);
    for (const listener of listeners) listener();
  }, []);
  return [unit, setUnit];
}
