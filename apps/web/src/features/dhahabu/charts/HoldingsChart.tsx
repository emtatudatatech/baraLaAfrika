import type { GoldCountry, GoldHoldingsChange, GoldSeries, GoldUnit } from '@bla/shared';
import { TROY_OZ_PER_TONNE } from '@bla/shared';
import { type PointerEvent, type Ref, useId, useMemo, useState } from 'react';

import { DevApiHint } from '../../../components/DevApiHint/DevApiHint';
import { Icon } from '../../../components/Icon/Icon';
import { api } from '../../../lib/api';
import { cx } from '../../../lib/cx';
import { formatMass, formatMonth, formatUsd, massUnitLabel } from '../../../lib/goldUnits';
import { strings } from '../../../lib/strings';
import { useResource } from '../../../lib/useResource';
import chartStyles from '../../harim/chart/HighestPeakChart.module.css';
import { barPath } from '../../harim/chart/chartScale';
import { linePath, linear, niceTicks, periodToYear, useWidth, yearTicks } from './chartMath';
import { largestHolders, spreadLabels } from './chartData';
import styles from './GoldCharts.module.css';

const text = strings.dhahabu.charts.holdings;
const LEFT = 56;
const TOP = 14;
const PLOT = 220;
const AXIS = 24;
const LABEL_ROOM = 112;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

type Mode = 'tonnes' | 'usd';

const BRIDGE_CLASS = {
  total: styles.bridgeTotal,
  price: styles.bridgePrice,
  volume: styles.bridgeVolume,
};

/**
 * "Central bank gold holdings" (spec 7.6 item 5): monthly lines for the largest holders over the
 * ribbon's range, in tonnes or US dollars, then the price-versus-volume split for one bank.
 */
export function HoldingsChart({
  rows,
  from,
  to,
  unit,
  scopeName,
  focusRef,
}: {
  rows: readonly GoldCountry[];
  from: number;
  to: number;
  unit: GoldUnit;
  scopeName: string | null;
  /** The section, so a card can bring it into view. */
  focusRef?: Ref<HTMLElement>;
}) {
  const [mode, setMode] = useState<Mode>('tonnes');
  const holders = useMemo(() => largestHolders(rows), [rows]);
  const isos = holders.map((h) => h.country.iso3);
  const titleId = useId();

  const series = useResource(
    isos.length === 0
      ? null
      : `gold-series:holdings:${mode}:${isos.join(',')}:${String(from)}:${String(to)}`,
    () =>
      api.goldSeries({
        metric: mode === 'tonnes' ? 'holdings_tonnes' : 'holdings_usd',
        countries: isos,
        from,
        to,
        granularity: 'month',
      }),
  );

  return (
    <section
      ref={focusRef}
      id="gold-holdings"
      className={cx(chartStyles.section, styles.anchor)}
      aria-labelledby={titleId}
      data-testid="gold-holdings-chart"
      tabIndex={-1}
    >
      <div className={chartStyles.head}>
        <h3 id={titleId} className={chartStyles.title}>
          <Icon name="account_balance" size={24} />
          {text.title}
        </h3>
        <div role="group" aria-label={text.showIn} className={chartStyles.segmented}>
          {(['tonnes', 'usd'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              data-testid={`gold-holdings-mode-${option}`}
              onClick={() => {
                setMode(option);
              }}
            >
              {option === 'tonnes' ? text.tonnes : text.usd}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.subtitle}>
        {from}–{to}
        {scopeName !== null && ` · ${scopeName}`}
        {mode === 'usd' && ` · ${text.computedNote}`}
      </p>
      {holders.length === 0 && <p className={styles.empty}>{strings.dhahabu.charts.noData}</p>}
      {series.status === 'error' && (
        <div className={styles.error} role="alert">
          <p>{strings.dhahabu.charts.loadError}</p>
          <DevApiHint error={series.error} />
          <button type="button" className={styles.retry} onClick={series.retry}>
            {strings.dhahabu.charts.retry}
          </button>
        </div>
      )}
      {series.status === 'loading' && (
        <div className={cx('skeleton', styles.skeleton)} aria-hidden="true" />
      )}
      {series.status === 'success' && (
        <Lines
          series={series.data.series}
          order={isos}
          mode={mode}
          unit={unit}
          from={from}
          to={to}
        />
      )}
      {holders.length > 0 && <PriceVolumeSplit holders={holders} from={from} to={to} unit={unit} />}
    </section>
  );
}

function Lines({
  series,
  order,
  mode,
  unit,
  from: rangeFrom,
  to,
}: {
  series: readonly GoldSeries[];
  order: readonly string[];
  mode: Mode;
  unit: GoldUnit;
  from: number;
  to: number;
}) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const descId = useId();
  const sorted = order.flatMap((iso3) => series.filter((s) => s.country.iso3 === iso3));
  const colour = (index: number) => `var(--series-${String(index + 1)})`;

  const toShown = (value: number) =>
    mode === 'usd'
      ? value
      : unit === 't'
        ? value
        : unit === 'kg'
          ? value * 1000
          : value * TROY_OZ_PER_TONNE;
  const format = (value: number) => (mode === 'usd' ? formatUsd(value) : formatMass(value, unit));
  // Start at the first report when the range begins earlier (reports start in 2000).
  const first = Math.min(
    ...sorted.flatMap((s) => s.points.map((p) => Number(p.period.slice(0, 4)))),
  );
  const from = Number.isFinite(first) && first > rangeFrom ? first : rangeFrom;
  const max = Math.max(0, ...sorted.flatMap((s) => s.points.map((p) => p.value ?? 0)));
  const ticks = niceTicks(max);
  const labelRoom = width < 520 ? 84 : LABEL_ROOM;
  const plotWidth = Math.max(40, width - LEFT - labelRoom);
  const x = linear([from, to + 1], [LEFT, LEFT + plotWidth]);
  const y = linear([0, ticks.at(-1) ?? 1], [TOP + PLOT, TOP]);
  const height = TOP + PLOT + AXIS;
  const months = [...new Set(sorted.flatMap((s) => s.points.map((p) => p.period)))].sort();

  const ends = sorted.map((s) => {
    const last = s.points.findLast((p) => p.value !== null);
    return last ? y(last.value ?? 0) : TOP;
  });
  const labelYs = spreadLabels(ends);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const year = from + ((event.clientX - rect.left - LEFT) / plotWidth) * (to + 1 - from);
    let best: string | null = null;
    let distance = Infinity;
    for (const month of months) {
      const d = Math.abs(periodToYear(month) - year);
      if (d < distance) {
        distance = d;
        best = month;
      }
    }
    setHover(best);
  };

  return (
    <>
      {from > rangeFrom && <p className={styles.subtitle}>{text.startsAt(from)}</p>}
      <ul className={chartStyles.legend} aria-label={text.title}>
        {sorted.map((s, index) => (
          <li key={s.country.iso3}>
            <span className={styles.lineSwatch} style={{ '--swatch': colour(index) }} />
            {s.country.name}
          </li>
        ))}
      </ul>
      <div ref={frameRef} className={cx('glass', chartStyles.frame)}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-labelledby={descId}
            data-testid="gold-holdings-svg"
            onPointerMove={onMove}
            onPointerLeave={() => {
              setHover(null);
            }}
          >
            <desc id={descId}>{text.description(sorted.length)}</desc>
            {ticks.map((tick) => (
              <g key={tick} aria-hidden="true">
                <line
                  x1={LEFT}
                  x2={LEFT + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={chartStyles.grid}
                />
                <text x={LEFT - 6} y={y(tick)} className={styles.yTick}>
                  {mode === 'usd'
                    ? formatUsd(tick).replace('US$', '')
                    : number.format(toShown(tick))}
                </text>
              </g>
            ))}
            <text x={LEFT} y={TOP - 4} className={styles.panelLabel} aria-hidden="true">
              {mode === 'usd' ? 'US$' : massUnitLabel(unit)}
            </text>
            {sorted.map((s, index) => (
              <path
                key={s.country.iso3}
                d={linePath(
                  s.points.map((p) => ({
                    x: x(periodToYear(p.period)),
                    y: p.value === null ? null : y(p.value),
                  })),
                )}
                className={styles.line}
                style={{ '--line': colour(index) }}
                data-testid="gold-holdings-line"
                data-iso3={s.country.iso3}
              />
            ))}
            {sorted.map((s, index) => (
              <text
                key={s.country.iso3}
                x={LEFT + plotWidth + 6}
                y={labelYs[index] ?? TOP}
                className={styles.directLabel}
                aria-hidden="true"
              >
                {s.country.name.length > 12 && width < 520
                  ? `${s.country.name.slice(0, 11)}…`
                  : s.country.name}
              </text>
            ))}
            {yearTicks(from, to, Math.max(2, Math.floor(plotWidth / 70))).map((year) => (
              <text
                key={year}
                x={x(year)}
                y={height - 6}
                className={chartStyles.tick}
                aria-hidden="true"
              >
                {year}
              </text>
            ))}
            {hover !== null && (
              <line
                x1={x(periodToYear(hover))}
                x2={x(periodToYear(hover))}
                y1={TOP}
                y2={TOP + PLOT}
                className={styles.crosshair}
              />
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            className={cx('glass glass--strong', chartStyles.tooltip)}
            style={{
              top: `${String(TOP + 8)}px`,
              left: `${String(
                x(periodToYear(hover)) + 260 > width
                  ? Math.max(8, x(periodToYear(hover)) - 252)
                  : x(periodToYear(hover)) + 12,
              )}px`,
            }}
            data-testid="gold-holdings-tooltip"
          >
            <strong>{formatMonth(`${hover}-01`)}</strong>
            {sorted.map((s, index) => {
              const point = s.points.find((p) => p.period === hover);
              return (
                <span key={s.country.iso3} className={styles.tooltipRow}>
                  <span className={styles.lineSwatch} style={{ '--swatch': colour(index) }} />
                  {s.country.name}: {point?.value == null ? '—' : format(point.value)}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <details className={chartStyles.tableView}>
        <summary>{strings.dhahabu.charts.tableToggle}</summary>
        <div className={styles.tableScroll}>
          <table className={chartStyles.table} data-testid="gold-holdings-table">
            <caption className="visually-hidden">{text.title}</caption>
            <thead>
              <tr>
                <th scope="col">{text.columns.month}</th>
                {sorted.map((s) => (
                  <th key={s.country.iso3} scope="col" className={chartStyles.number}>
                    {s.country.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Each year's last month keeps the table readable; the chart has every month. */}
              {months
                .filter((month, i) => month.slice(0, 4) !== months[i + 1]?.slice(0, 4))
                .reverse()
                .map((month) => (
                  <tr key={month}>
                    <th scope="row">{formatMonth(`${month}-01`)}</th>
                    {sorted.map((s) => {
                      const value = s.points.find((p) => p.period === month)?.value;
                      return (
                        <td key={s.country.iso3} className={chartStyles.number}>
                          {value == null ? '—' : format(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function PriceVolumeSplit({
  holders,
  from,
  to,
  unit,
}: {
  holders: readonly GoldCountry[];
  from: number;
  to: number;
  unit: GoldUnit;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const iso3 =
    chosen !== null && holders.some((h) => h.country.iso3 === chosen)
      ? chosen
      : (holders[0]?.country.iso3 ?? '');
  const titleId = useId();
  const change = useResource(`gold-holdings-change:${iso3}:${String(from)}:${String(to)}`, () =>
    api.goldHoldingsChange({ countries: [iso3], from, to }),
  );
  const result = change.status === 'success' ? change.data.changes[0] : undefined;

  return (
    <div
      className={cx('glass', styles.split)}
      aria-labelledby={titleId}
      role="group"
      data-testid="gold-split"
    >
      <div className={styles.splitHead}>
        <h4 id={titleId} className={styles.splitTitle}>
          <Icon name="trending_up" size={20} />
          {text.split.title}
        </h4>
        <label className={styles.splitSelect}>
          <span>{text.split.countryLabel}</span>
          <select
            value={iso3}
            data-testid="gold-split-country"
            onChange={(event) => {
              setChosen(event.currentTarget.value);
            }}
          >
            {holders.map((h) => (
              <option key={h.country.iso3} value={h.country.iso3}>
                {h.country.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {change.status === 'loading' && (
        <div className={cx('skeleton', styles.splitSkeleton)} aria-hidden="true" />
      )}
      {change.status === 'error' && (
        <div className={styles.error} role="alert">
          <p>{strings.dhahabu.charts.loadError}</p>
          <button type="button" className={styles.retry} onClick={change.retry}>
            {strings.dhahabu.charts.retry}
          </button>
        </div>
      )}
      {change.status === 'success' && !result && <p className={styles.empty}>{text.split.none}</p>}
      {result && <Bridge change={result} unit={unit} />}
    </div>
  );
}

function Bridge({ change, unit }: { change: GoldHoldingsChange; unit: GoldUnit }) {
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const from = formatMonth(change.fromMonth);
  const to = formatMonth(change.toMonth);
  const price = change.priceEffectUsd;
  const volume = change.volumeEffectUsd;
  const summary = (
    <>
      <p data-testid="gold-split-summary">
        {text.split.summary(
          change.country.name,
          from,
          to,
          formatUsd(change.changeUsd, { sign: true }),
        )}
      </p>
      <p className={styles.splitMeta}>
        {text.split.tonnes(formatMass(change.tonnesFrom, unit), formatMass(change.tonnesTo, unit))}
      </p>
    </>
  );
  if (price === null || volume === null) {
    return (
      <>
        {summary}
        <p className={styles.splitMeta}>{text.split.noPrice}</p>
      </>
    );
  }

  const steps = [
    {
      key: 'start',
      label: text.split.start(from),
      start: 0,
      end: change.valueFromUsd,
      kind: 'total',
    },
    {
      key: 'price',
      label: text.split.price,
      start: change.valueFromUsd,
      end: change.valueFromUsd + price,
      kind: 'price',
    },
    {
      key: 'volume',
      label: width < 520 ? text.split.volumeShort : text.split.volume,
      start: change.valueFromUsd + price,
      end: change.valueFromUsd + price + volume,
      kind: 'volume',
    },
    { key: 'end', label: text.split.end(to), start: 0, end: change.valueToUsd, kind: 'total' },
  ] as const;
  const max = Math.max(...steps.map((s) => Math.max(s.start, s.end)), 1);
  const ROW = 30;
  const labelWidth = width < 520 ? 120 : 190;
  const valueRoom = 96;
  const plotWidth = Math.max(40, width - labelWidth - valueRoom - 16);
  const x = linear([0, max], [labelWidth + 8, labelWidth + 8 + plotWidth]);

  return (
    <>
      {summary}
      <div ref={frameRef} className={styles.bridge}>
        {width > 0 && (
          <svg
            width={width}
            height={steps.length * ROW}
            role="img"
            aria-label={`${text.split.title} ${change.country.name}`}
            data-testid="gold-split-chart"
          >
            {steps.map((step, index) => {
              const left = x(Math.min(step.start, step.end));
              const right = x(Math.max(step.start, step.end));
              const y = index * ROW + 7;
              const delta = step.end - step.start;
              return (
                <g key={step.key} data-step={step.key}>
                  <text x={labelWidth} y={y + 8} className={chartStyles.label}>
                    {step.label}
                  </text>
                  <path
                    d={barPath(left, y, Math.max(1.5, right - left), 16, 3)}
                    className={BRIDGE_CLASS[step.kind]}
                  />
                  <text x={right + 6} y={y + 8} className={styles.barValue}>
                    {step.kind === 'total' ? formatUsd(step.end) : formatUsd(delta, { sign: true })}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className={styles.splitMeta}>{text.split.note}</p>
    </>
  );
}
