import {
  GOLD_MAP_METRICS,
  type GoldCountry,
  type GoldMapMetric,
  type GoldUnit,
  PRESENCE_TIERS,
  type RegionSlug,
} from '@bla/shared';
import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { FlagImage } from '../../../components/FlagImage/FlagImage';
import { Icon } from '../../../components/Icon/Icon';
import { placeTooltip } from '../../../components/Tooltip/placeTooltip';
import { cx } from '../../../lib/cx';
import { formatUsd } from '../../../lib/goldUnits';
import { strings } from '../../../lib/strings';
import mapStyles from '../../map/AfricaMap.module.css';
import { nextCountry } from '../../map/keyboard';
import { type MapContext, type MapController, MapBase } from '../../map/MapBase';
import { disputedFill } from '../../map/mapPatterns';
import { territoryNote, territoryNoteId } from '../../map/territoryNotes';
import { tierColour } from '../goldStats';
import styles from './GoldMap.module.css';
import {
  type MetricMark,
  classBreaks,
  classLabels,
  classOf,
  formatMetric,
  metricMark,
  rampStep,
} from './goldMapModel';

const text = strings.dhahabu.map;
const MAP_ID = 'gold-map';
const MARKER_RADIUS = 6;
const MARKER_HIT_RADIUS = 16;
const NO_DATA = `url(#${MAP_ID}-no-data)`;
const INCLUDED = `url(#${MAP_ID}-included)`;
const UNKNOWN = `url(#${MAP_ID}-unknown)`;

/** Where to put a small state's marker (from /api/countries). */
export interface MapPlace {
  centroid: { lon: number; lat: number } | null;
  isMicrostateMarker: boolean;
}

export interface GoldMapProps {
  /** Every country at the reference year (the map always shows all 54). */
  rows: readonly GoldCountry[];
  places: ReadonlyMap<string, MapPlace>;
  metric: GoldMapMetric;
  onMetric: (metric: GoldMapMetric) => void;
  region: RegionSlug | null;
  unit: GoldUnit;
  /** A country highlighted from the table (hovered row). */
  highlighted: string | null;
  /** The country whose drawer is open. */
  selected: string | null;
  /** Wide layout: the metric switch is a button row (a menu on phones). */
  wide: boolean;
  onOpen: (iso3: string) => void;
  onHover: (iso3: string | null) => void;
}

interface Anchor {
  x: number;
  y: number;
}

/**
 * The Dhahabu map (spec 7.6 item 4): Equal Earth, countries coloured by the chosen metric with
 * the sequential gold ramp (or by presence tier), distinct patterns for no data and "included
 * in other", tooltips with each figure's year, and a click (or Enter) opening the country's
 * drawer. The country table is its accessible equivalent.
 */
export function GoldMap({
  rows,
  places,
  metric,
  onMetric,
  region,
  unit,
  highlighted,
  selected,
  wide,
  onOpen,
  onHover,
}: GoldMapProps) {
  const controllerRef = useRef<MapController | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const focusTargets = useRef(new Map<string, SVGElement>());
  const titleId = useId();
  const hintId = useId();
  const [hovered, setHovered] = useState<{ iso3: string; anchor: Anchor } | null>(null);
  const [focused, setFocused] = useState<{ iso3: string; anchor: Anchor | null } | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const byIso3 = useMemo(() => new Map(rows.map((row) => [row.country.iso3, row])), [rows]);
  const order = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.country.name.localeCompare(b.country.name, 'en'))
        .map((r) => r.country.iso3),
    [rows],
  );
  const currentActive = active ?? order[0] ?? null;

  // Classes from all 54 countries' values, so a region filter dims rather than recolours.
  const model = useMemo(() => {
    if (metric === 'presence') return null;
    const marks = new Map<string, MetricMark>(
      rows.map((row) => [row.country.iso3, metricMark(row, metric)]),
    );
    const values = [...marks.values()].flatMap((m) => (m.kind === 'value' ? [m.value] : []));
    const breaks = classBreaks(values);
    return { marks, breaks, classes: breaks.length + 1 };
  }, [rows, metric]);

  const fillOf = (row: GoldCountry): string => {
    if (metric === 'presence') {
      return row.presence.tier === 'unknown' ? UNKNOWN : tierColour(row.presence.tier);
    }
    const mark = model?.marks.get(row.country.iso3);
    if (!mark || mark.kind === 'none') return NO_DATA;
    if (mark.kind === 'included') return INCLUDED;
    const step = rampStep(classOf(mark.value, model?.breaks ?? []), model?.classes ?? 1);
    return `var(--gold-seq-${String(step)})`;
  };

  const anchorOf = (iso3: string): Anchor | null => {
    const centroid = places.get(iso3)?.centroid;
    return centroid
      ? (controllerRef.current?.toViewport(centroid.lon, centroid.lat) ?? null)
      : null;
  };

  const describe = (row: GoldCountry): string => {
    if (metric === 'presence') return strings.dhahabu.presence[row.presence.tier];
    const mark = model?.marks.get(row.country.iso3);
    if (!mark || mark.kind === 'none') return text.noData;
    if (mark.kind === 'included') return `${text.included} (${mark.period})`;
    return `${formatMetric(metric, mark.value, unit)} (${mark.period})`;
  };

  const onKeyDown = (event: KeyboardEvent<SVGElement>, iso3: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(iso3);
      return;
    }
    const next = nextCountry(order, iso3, event.key);
    if (next) {
      event.preventDefault();
      setActive(next);
      focusTargets.current.get(next)?.focus();
    }
  };

  const pointer = (iso3: string) => ({
    onPointerMove: (event: PointerEvent<SVGElement>) => {
      if (event.pointerType === 'touch') return;
      setHovered({ iso3, anchor: { x: event.clientX, y: event.clientY } });
      onHover(iso3);
    },
    onPointerLeave: () => {
      setHovered((current) => (current?.iso3 === iso3 ? null : current));
      onHover(null);
    },
  });

  const interactive = (row: GoldCountry) => {
    const iso3 = row.country.iso3;
    return {
      role: 'button' as const,
      tabIndex: iso3 === currentActive ? 0 : -1,
      'aria-label': `${row.country.name}, ${text.metrics[metric]}: ${describe(row)}`,
      'aria-describedby': territoryNote(iso3) === undefined ? undefined : territoryNoteId(iso3),
      'data-iso3': iso3,
      ref: (element: SVGElement | null) => {
        if (element) focusTargets.current.set(iso3, element);
        else focusTargets.current.delete(iso3);
      },
      onClick: () => {
        setActive(iso3);
        onOpen(iso3);
      },
      onKeyDown: (event: KeyboardEvent<SVGElement>) => {
        onKeyDown(event, iso3);
      },
      onFocus: () => {
        setActive(iso3);
        setFocused({ iso3, anchor: anchorOf(iso3) });
      },
      onBlur: () => {
        setFocused((current) => (current?.iso3 === iso3 ? null : current));
      },
      ...pointer(iso3),
    };
  };

  const tooltipIso3 = hovered?.iso3 ?? focused?.iso3 ?? null;
  const tooltipAnchor = hovered?.anchor ?? focused?.anchor ?? null;
  const showTooltip = tooltipIso3 !== null && tooltipAnchor !== null;
  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !showTooltip) return;
    const { left, top } = placeTooltip(
      { left: tooltipAnchor.x, top: tooltipAnchor.y - 6, width: 0, height: 12 },
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      'top',
    );
    node.style.left = `${String(left)}px`;
    node.style.top = `${String(top)}px`;
  });

  const outlined = focused?.iso3 ?? hovered?.iso3 ?? highlighted ?? selected;

  const renderCountries = ({ shapes }: MapContext) => (
    <g>
      <defs>
        <pattern
          id={`${MAP_ID}-no-data`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          data-testid="gold-map-pattern-no-data"
        >
          <rect width="6" height="6" className={styles.noDataFill} />
          <circle cx="3" cy="3" r="0.9" className={styles.noDataDot} />
        </pattern>
        <pattern
          id={`${MAP_ID}-included`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="6" height="6" className={styles.includedFill} />
          <line x1="0" y1="0" x2="0" y2="6" className={styles.includedLine} />
        </pattern>
        <pattern
          id={`${MAP_ID}-unknown`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" style={{ fill: tierColour('unknown') }} />
          <line x1="0" y1="0" x2="0" y2="6" className={styles.includedLine} />
        </pattern>
      </defs>
      {shapes.map((shape) => {
        if (shape.disputed) {
          return (
            <path
              key={shape.iso3}
              d={shape.d}
              className={mapStyles.disputed}
              style={{ fill: disputedFill(MAP_ID) }}
              role="img"
              aria-label={`${strings.map.disputed}: ${strings.map.disputedNote}`}
              data-iso3={shape.iso3}
              {...pointer(shape.iso3)}
            />
          );
        }
        const row = byIso3.get(shape.iso3);
        if (!row) return <path key={shape.iso3} d={shape.d} className={mapStyles.unknown} />;
        const dimmed = region !== null && row.country.region.slug !== region;
        const className = cx(styles.country, dimmed && styles.dimmed);
        const style = { '--fill': fillOf(row) };
        // Small states are focused and clicked through their marker.
        if (places.get(shape.iso3)?.isMicrostateMarker) {
          return (
            <path
              key={shape.iso3}
              d={shape.d}
              className={className}
              style={style}
              aria-hidden="true"
              data-iso3={shape.iso3}
            />
          );
        }
        return (
          <path
            key={shape.iso3}
            d={shape.d}
            className={className}
            style={style}
            data-testid="gold-map-country"
            {...interactive(row)}
          />
        );
      })}
    </g>
  );

  const renderOverlay = ({ projection, transform, shapes }: MapContext) => {
    const k = transform.k;
    const outline = shapes.find((s) => s.iso3 === outlined && !s.disputed);
    return (
      <>
        <g>
          {rows.flatMap((row) => {
            const place = places.get(row.country.iso3);
            if (!place?.isMicrostateMarker || !place.centroid) return [];
            const point = projection([place.centroid.lon, place.centroid.lat]);
            if (!point) return [];
            const [x, y] = point;
            const dimmed = region !== null && row.country.region.slug !== region;
            return [
              <g
                key={row.country.iso3}
                className={cx(styles.marker, dimmed && styles.dimmed)}
                style={{ '--fill': fillOf(row) }}
                data-testid="gold-map-country"
                {...interactive(row)}
              >
                <circle className={mapStyles.markerHit} cx={x} cy={y} r={MARKER_HIT_RADIUS / k} />
                <circle className={styles.markerDot} cx={x} cy={y} r={MARKER_RADIUS / k} />
                {outlined === row.country.iso3 && (
                  <circle
                    className={mapStyles.markerRing}
                    cx={x}
                    cy={y}
                    r={(MARKER_RADIUS + 4) / k}
                  />
                )}
              </g>,
            ];
          })}
        </g>
        {outline && <path className={mapStyles.highlight} d={outline.d} />}
      </>
    );
  };

  const tooltipRow = tooltipIso3 === null ? undefined : byIso3.get(tooltipIso3);

  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid="gold-map-section">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          <Icon name="map" size={24} />
          {text.title}
        </h2>
        {wide ? (
          <div role="group" aria-label={text.metricLabel} className={styles.metrics}>
            {GOLD_MAP_METRICS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={metric === option}
                data-testid={`gold-map-metric-${option}`}
                onClick={() => {
                  onMetric(option);
                }}
              >
                {text.metrics[option]}
              </button>
            ))}
          </div>
        ) : (
          <label className={styles.metricSelect}>
            <span>{text.metricLabel}</span>
            <select
              value={metric}
              data-testid="gold-map-metric"
              onChange={(event) => {
                const value = event.currentTarget.value;
                onMetric(GOLD_MAP_METRICS.find((m) => m === value) ?? 'production');
              }}
            >
              {GOLD_MAP_METRICS.map((option) => (
                <option key={option} value={option}>
                  {text.metrics[option]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className={styles.stage}>
        <MapBase
          label={`${text.label} (${text.metrics[metric]})`}
          describedBy={hintId}
          testId={MAP_ID}
          className={styles.frame}
          controllerRef={controllerRef}
          renderCountries={renderCountries}
          renderOverlay={renderOverlay}
        />
        <Legend metric={metric} rows={rows} model={model} unit={unit} />
      </div>

      {showTooltip && (
        <div
          ref={tooltipRef}
          className={cx('glass glass--strong', mapStyles.tooltip)}
          role="tooltip"
          data-testid="gold-map-tooltip"
        >
          {tooltipIso3 === 'ESH' ? (
            <>
              <strong>{strings.map.disputed}</strong>
              <span>{strings.map.disputedNote}</span>
            </>
          ) : (
            tooltipRow && (
              <TooltipBody
                row={tooltipRow}
                metric={metric}
                mark={model?.marks.get(tooltipIso3)}
                unit={unit}
              />
            )
          )}
        </div>
      )}

      {rows.flatMap((row) => {
        const note = territoryNote(row.country.iso3);
        return note === undefined
          ? []
          : [
              <span
                key={row.country.iso3}
                id={territoryNoteId(row.country.iso3)}
                className="visually-hidden"
              >
                {note}
              </span>,
            ];
      })}

      <div className={mapStyles.notes}>
        {metric !== 'presence' && <p>{text.latestNote}</p>}
        <p id={hintId}>
          {text.keyboardHint} {strings.map.zoomHint}
        </p>
        <p>{strings.map.boundariesNote}</p>
        <p>
          <a href="#gold-results">{text.tableLink}</a>
        </p>
      </div>
    </section>
  );
}

function TooltipBody({
  row,
  metric,
  mark,
  unit,
}: {
  row: GoldCountry;
  metric: GoldMapMetric;
  mark: MetricMark | undefined;
  unit: GoldUnit;
}) {
  const note = territoryNote(row.country.iso3);
  let figure: string;
  let extra: string | null = null;
  if (metric === 'presence') {
    figure = strings.dhahabu.presence[row.presence.tier];
    if (row.presence.asOfYear !== null) extra = text.evidence(row.presence.asOfYear);
  } else if (!mark || mark.kind === 'none') {
    figure = text.noData;
    const mirror = row.exports.mirror;
    if (metric === 'exports' && mirror)
      extra = text.partners(formatUsd(mirror.valueUsd), mirror.year);
    if (metric === 'holdings' && row.reporting)
      extra = strings.dhahabu.reporting[row.reporting.status];
    if (metric === 'share' && row.exportShare?.exceedsTotal) extra = text.inconsistent;
  } else if (mark.kind === 'included') {
    figure = text.included;
    extra = mark.period;
  } else {
    figure = formatMetric(metric, mark.value, unit);
    extra = mark.period;
  }
  return (
    <>
      <span className={mapStyles.tooltipTitle}>
        <FlagImage
          flag={row.country.flag}
          countryName={row.country.name}
          width={24}
          loading="eager"
        />
        <strong>{row.country.name}</strong>
      </span>
      <span>
        {text.metrics[metric]}: <strong className={styles.figure}>{figure}</strong>
        {extra !== null && <span className={styles.period}> · {extra}</span>}
      </span>
      {note !== undefined && <span className={mapStyles.tooltipNote}>{note}</span>}
    </>
  );
}

function Legend({
  metric,
  rows,
  model,
  unit,
}: {
  metric: GoldMapMetric;
  rows: readonly GoldCountry[];
  model: { marks: ReadonlyMap<string, MetricMark>; breaks: number[]; classes: number } | null;
  unit: GoldUnit;
}) {
  const swatch = (fill: string) => (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
      <rect width="18" height="12" rx="2" className={styles.swatch} style={{ fill }} />
    </svg>
  );

  if (metric === 'presence' || model === null) {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.presence.tier, (counts.get(row.presence.tier) ?? 0) + 1);
    return (
      <div className={cx('glass glass--strong', styles.legend)} data-testid="gold-map-legend">
        <p className={styles.legendTitle}>{text.legendTitles.presence}</p>
        <ul>
          {PRESENCE_TIERS.map((tier) => (
            <li key={tier}>
              {swatch(tier === 'unknown' ? UNKNOWN : tierColour(tier))}
              <span>{strings.dhahabu.presence[tier]}</span>
              <span className={styles.legendCount}>{counts.get(tier) ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const labels = classLabels(metric, model.breaks, unit, text);
  const counts = new Array<number>(model.classes).fill(0);
  let none = 0;
  let included = 0;
  for (const mark of model.marks.values()) {
    if (mark.kind === 'none') none += 1;
    else if (mark.kind === 'included') included += 1;
    else
      counts[classOf(mark.value, model.breaks)] =
        (counts[classOf(mark.value, model.breaks)] ?? 0) + 1;
  }
  return (
    <div className={cx('glass glass--strong', styles.legend)} data-testid="gold-map-legend">
      <p className={styles.legendTitle}>{text.legendTitles[metric]}</p>
      <ul>
        {labels.map((label, index) => (
          <li key={label}>
            {swatch(`var(--gold-seq-${String(rampStep(index, model.classes))})`)}
            <span>{label}</span>
            <span className={styles.legendCount}>{counts[index] ?? 0}</span>
          </li>
        ))}
        {included > 0 && (
          <li>
            {swatch(INCLUDED)}
            <span>{text.included}</span>
            <span className={styles.legendCount}>{included}</span>
          </li>
        )}
        <li>
          {swatch(NO_DATA)}
          <span>{text.noData}</span>
          <span className={styles.legendCount}>{none}</span>
        </li>
      </ul>
    </div>
  );
}
