import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { useTooltip } from '../../components/Tooltip/useTooltip';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { PRESETS, type YearRange, formatRange, matchesPreset, presetRange } from './timeRange';
import { useTimeRange } from './timeRangeContext';
import styles from './TimeRangeControl.module.css';

const text = strings.ribbon.years;

function years({ start, end }: YearRange): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/**
 * The ribbon's date-range control. Read-only (with an explanation) on pages whose data is not a
 * time series; on time-series pages a year-range picker with presets, bounded by the data's
 * coverage, or a visible "no data" state when nothing is loaded.
 */
export function TimeRangeControl({ loading }: { loading: boolean }) {
  const { interactive, bounds, range } = useTimeRange();
  if (!interactive) return <ReadOnlyControl />;
  if (bounds === null || range === null) {
    return loading ? <LoadingControl /> : <NoDataControl />;
  }
  return <YearRangePicker bounds={bounds} range={range} />;
}

function ReadOnlyControl() {
  const tip = useTooltip({ content: strings.ribbon.notTimeDependentHint, placement: 'bottom' });
  return (
    <>
      <button
        {...tip.triggerProps}
        type="button"
        className={cx(styles.control, styles.readOnly)}
        aria-disabled="true"
        data-testid="ribbon-range"
      >
        <Icon name="lock" size={18} />
        <span>{strings.ribbon.notTimeDependent}</span>
      </button>
      {tip.tooltip}
    </>
  );
}

function LoadingControl() {
  return (
    <span className={cx(styles.control, styles.inactive)} aria-hidden="true">
      <Icon name="date_range" size={18} />
      {text.loading}
    </span>
  );
}

function NoDataControl() {
  const tip = useTooltip({ content: text.noDataHint, placement: 'bottom' });
  return (
    <>
      <button
        {...tip.triggerProps}
        type="button"
        className={cx(styles.control, styles.inactive)}
        aria-disabled="true"
        data-testid="ribbon-years"
      >
        <Icon name="date_range" size={18} />
        <span>{text.noData}</span>
      </button>
      {tip.tooltip}
    </>
  );
}

function YearRangePicker({ bounds, range }: { bounds: YearRange; range: YearRange }) {
  const { setRange, ownDefault, isDefault } = useTimeRange();
  // A page with its own default years offers it first, in place of "Last 10 years".
  const presets = ownDefault ? PRESETS.filter((preset) => preset !== 'last10') : PRESETS;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Escape, clicks outside and focus moving outside close the panel (Escape returns focus to
  // the trigger).
  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && wrapperRef.current?.contains(target));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(styles.control, styles.trigger)}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="ribbon-years"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Icon name="date_range" size={18} />
        <span className="visually-hidden">{text.label}: </span>
        <span className={styles.value}>
          {ownDefault && isDefault ? (
            <>
              <span className={styles.long}>{text.ownDefault}</span>
              {/* Phones: a shorter label, so the ribbon's line keeps its room. */}
              <span className={styles.short} aria-hidden="true">
                {text.ownDefaultShort}
              </span>
            </>
          ) : (
            formatRange(range)
          )}
        </span>
        <Icon
          name="keyboard_arrow_down"
          size={18}
          className={cx(styles.chevron, open && styles.chevronOpen)}
        />
      </button>
      <div
        id={panelId}
        className={styles.panel}
        hidden={!open}
        role="group"
        aria-label={text.label}
      >
        <div className={styles.presets} role="group" aria-label={text.presetsLabel}>
          {ownDefault && (
            <button
              type="button"
              className={styles.preset}
              aria-pressed={isDefault}
              onClick={() => {
                setRange(presetRange('last10', bounds));
              }}
            >
              {text.ownDefault}
            </button>
          )}
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={styles.preset}
              aria-pressed={!(ownDefault && isDefault) && matchesPreset(preset, range, bounds)}
              onClick={() => {
                setRange(presetRange(preset, bounds));
              }}
            >
              {text.presets[preset]}
            </button>
          ))}
        </div>
        <div className={styles.selects}>
          <label>
            <span>{text.from}</span>
            <select
              value={range.start}
              onChange={(event) => {
                setRange({ start: Number(event.currentTarget.value), end: range.end });
              }}
            >
              {years({ start: bounds.start, end: range.end }).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{text.to}</span>
            <select
              value={range.end}
              onChange={(event) => {
                setRange({ start: range.start, end: Number(event.currentTarget.value) });
              }}
            >
              {years({ start: range.start, end: bounds.end }).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.note}>
          {text.covers(formatRange(bounds))}
          {ownDefault && ` ${text.ownDefaultNote}`}
        </p>
      </div>
    </div>
  );
}
