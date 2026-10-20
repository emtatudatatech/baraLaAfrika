import type { CountryRef } from '@bla/shared';
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { FlagImage } from '../../../components/FlagImage/FlagImage';
import { Icon } from '../../../components/Icon/Icon';
import { IconButton } from '../../../components/IconButton/IconButton';
import { placeTooltip } from '../../../components/Tooltip/placeTooltip';
import { cx } from '../../../lib/cx';
import { strings } from '../../../lib/strings';
import { type Unit, formatElevation, otherUnit } from '../../../lib/units';
import type { MapContext } from '../../map/MapBase';
import { peakTypeLabel } from '../peakFormat';
import styles from './HarimMap.module.css';
import { type MapPeak, bandFill, peakAriaLabel, whereLabel } from './mapModel';
import {
  type Box,
  type Cluster,
  type LayoutPeak,
  byPriority,
  clusterPeaks,
  declutter,
  glyphHalfWidth,
  glyphPath,
  haloRadius,
  mapScale,
  placeLabels,
} from './peakLayout';

const text = strings.harim.map;
const LABEL_FONT = 11;
/** The area the map's zoom controls cover (top right), with room for a glyph's tap area. */
const CONTROLS_WIDTH = 84;
const CONTROLS_HEIGHT = 244;
/** The count bubble on a group's glyph. */
const BUBBLE_R = 8;

type Positioned = MapPeak & LayoutPeak;

type Item =
  | { kind: 'peak'; id: string; peak: Positioned; r: number }
  | { kind: 'group'; id: string; cluster: Cluster<Positioned>; r: number };

/** Text width at the label font, measured once per text (estimated where canvas is missing). */
const measureCache = new Map<string, number>();
let canvasContext: CanvasRenderingContext2D | null | undefined;
function measure(label: string, weight = 600): number {
  const key = `${String(weight)}:${label}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  if (canvasContext === undefined) {
    try {
      canvasContext = document.createElement('canvas').getContext('2d');
    } catch {
      canvasContext = null;
    }
  }
  let width = label.length * LABEL_FONT * 0.56;
  if (canvasContext) {
    canvasContext.font = `${String(weight)} ${String(LABEL_FONT)}px "Instrument Sans Variable", system-ui, sans-serif`;
    width = canvasContext.measureText(label).width;
  }
  measureCache.set(key, width);
  return width;
}

export interface PeaksLayerProps {
  context: MapContext;
  peaks: readonly MapPeak[];
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  halo: boolean;
  /** Highlighted from the table (hover). */
  highlighted: string | null;
  /** The selected peak: its card is open. */
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onOpenPeak: (slug: string) => void;
  onShowInTable: (slug: string) => void;
  /** Where HTML overlays (tooltip, cards) are drawn: a positioned element over the map. */
  overlay: HTMLElement | null;
  onCounts: (shown: number) => void;
}

/**
 * The peaks, drawn in screen pixels over the zoomed map: one triangle per mountain (sized by
 * height, coloured by height band; a ring for shared border peaks, grey for territory peaks),
 * groups for tight clusters, labels that never collide, and the optional halos. Peaks are a
 * single tab stop; arrow keys move between them, tallest first.
 */
export function PeaksLayer({
  context,
  peaks,
  countries,
  unit,
  halo,
  highlighted,
  selected,
  onSelect,
  onOpenPeak,
  onShowInTable,
  overlay,
  onCounts,
}: PeaksLayerProps) {
  const { projection, transform, size } = context;
  const k = transform.k;
  const elements = useRef(new Map<string, SVGGElement>());
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);

  const layout = useMemo(() => {
    const positioned: Positioned[] = peaks.flatMap((peak) => {
      const point = projection([peak.lon, peak.lat]);
      if (!point) return [];
      const [x, y] = transform.apply(point);
      return [{ ...peak, x, y }];
    });
    const pinned = new Set([highlighted, selected].filter((slug) => slug !== null));
    const scale = mapScale(size.width);
    const radiusOf = (peak: { elevationM: number }) => glyphHalfWidth(peak.elevationM, scale);
    const shown = declutter(positioned, k, scale);
    for (const peak of positioned) {
      if (pinned.has(peak.slug) && !shown.includes(peak)) shown.push(peak);
    }
    const margin = 24;
    // The zoom controls (top right) cover the map: peaks under them are left out, so no tap
    // target hides beneath a button (labels avoid the same area below).
    const controls: Box = {
      x0: size.width - CONTROLS_WIDTH,
      y0: 0,
      x1: size.width,
      y1: CONTROLS_HEIGHT,
    };
    const onScreen = shown.filter(
      (p) =>
        p.x > -margin &&
        p.y > -margin &&
        p.x < size.width + margin &&
        p.y < size.height + margin &&
        !(p.x > controls.x0 && p.y < controls.y1),
    );
    // Pinned peaks are never swallowed into a group.
    const groups = clusterPeaks(
      onScreen.filter((p) => !pinned.has(p.slug)),
      undefined,
      radiusOf,
    );
    const items: Item[] = [
      ...groups.map((cluster): Item =>
        cluster.members.length === 1
          ? {
              kind: 'peak',
              id: cluster.lead.slug,
              peak: cluster.lead,
              r: radiusOf(cluster.lead),
            }
          : {
              kind: 'group',
              id: `group:${cluster.lead.slug}`,
              cluster,
              r: radiusOf(cluster.lead),
            },
      ),
      ...onScreen
        .filter((p) => pinned.has(p.slug))
        .map((p): Item => ({ kind: 'peak', id: p.slug, peak: p, r: radiusOf(p) })),
    ].sort((a, b) => byPriority(lead(a), lead(b)));
    // Labels keep clear of the zoom controls (top right) and of the groups' count bubbles.
    const bubbles = items.flatMap((item) =>
      item.kind === 'group' ? [bubbleBox(item.cluster.lead, item.r)] : [],
    );
    const labels = placeLabels(
      items.map((item) => ({
        slug: item.id,
        text: item.kind === 'peak' ? item.peak.name : item.cluster.label,
        x: lead(item).x,
        y: lead(item).y,
        r: item.r,
      })),
      {
        width: size.width,
        height: size.height,
        measure,
        fontSize: LABEL_FONT,
        obstacles: [controls, ...bubbles],
      },
    );
    return { items, labels, positioned, shownCount: onScreenCount(items) };
  }, [peaks, projection, transform, k, size, highlighted, selected]);

  useEffect(() => {
    onCounts(layout.shownCount);
  }, [layout.shownCount, onCounts]);

  const ids = layout.items.map((item) => item.id);
  const current = active !== null && ids.includes(active) ? active : (ids[0] ?? null);

  const focusItem = (id: string) => {
    setActive(id);
    elements.current.get(id)?.focus();
  };

  const activate = (item: Item) => {
    setActive(item.id);
    if (item.kind === 'peak') {
      setGroup(null);
      onSelect(item.peak.slug);
    } else {
      onSelect(null);
      setGroup(item.id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, item: Item) => {
    const index = ids.indexOf(item.id);
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = ids[Math.min(ids.length - 1, index + 1)];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = ids[Math.max(0, index - 1)];
        break;
      case 'Home':
        next = ids[0];
        break;
      case 'End':
        next = ids.at(-1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate(item);
        return;
      case 'Escape':
        onSelect(null);
        setGroup(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next) focusItem(next);
  };

  const selectedItem = layout.items.find((item) => item.kind === 'peak' && item.id === selected);
  const groupItem = layout.items.find((item) => item.id === group);
  const tooltipId = focused ?? hover;
  const tooltipItem =
    tooltipId !== null && tooltipId !== selected && tooltipId !== group
      ? layout.items.find((item) => item.id === tooltipId)
      : undefined;

  const closeCard = () => {
    const id = selected ?? group;
    onSelect(null);
    setGroup(null);
    if (id) elements.current.get(id)?.focus();
  };

  return (
    <g className={styles.peaks} data-testid="harim-map-peaks">
      {halo && (
        <g className={styles.halos} aria-hidden="true">
          {layout.items.map((item) => {
            const p = lead(item);
            return (
              <circle
                key={item.id}
                cx={p.x}
                cy={p.y}
                r={haloRadius(p.elevationM) * Math.min(2, Math.sqrt(k))}
              />
            );
          })}
        </g>
      )}
      {layout.items.map((item) => {
        const props = {
          role: 'button' as const,
          tabIndex: item.id === current ? 0 : -1,
          'data-id': item.id,
          ref: (element: SVGGElement | null) => {
            if (element) elements.current.set(item.id, element);
            else elements.current.delete(item.id);
          },
          onClick: () => {
            activate(item);
          },
          onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
            onKeyDown(event, item);
          },
          onFocus: () => {
            setActive(item.id);
            setFocused(item.id);
          },
          onBlur: () => {
            setFocused((now) => (now === item.id ? null : now));
          },
          onPointerEnter: (event: { pointerType: string }) => {
            if (event.pointerType !== 'touch') setHover(item.id);
          },
          onPointerLeave: () => {
            setHover((now) => (now === item.id ? null : now));
          },
        };
        if (item.kind === 'group') {
          const { lead: first, members, label } = item.cluster;
          const { r } = item;
          const bubble = bubbleCentre(first, r);
          return (
            <g
              key={item.id}
              {...props}
              className={styles.group}
              aria-label={text.groupLabel(label, members.length)}
              aria-haspopup="dialog"
              data-testid="harim-map-group"
              data-count={members.length}
              data-min-metres={Math.min(...members.map((member) => member.elevationM))}
            >
              <circle cx={first.x} cy={first.y} r={Math.max(r + 8, 14)} className={styles.hit} />
              <path
                d={glyphPath(first.x, first.y, r)}
                className={styles.glyph}
                style={{ '--band': bandFill(first) }}
              />
              <circle cx={bubble.x} cy={bubble.y} r={BUBBLE_R} className={styles.bubble} />
              <text x={bubble.x} y={bubble.y} className={styles.bubbleText}>
                {members.length}
              </text>
              {(focused === item.id || group === item.id) && (
                <circle
                  cx={first.x}
                  cy={first.y - r * 0.2}
                  r={r + 9}
                  className={styles.focusRing}
                />
              )}
            </g>
          );
        }
        const { peak, r } = item;
        const emphasised =
          peak.slug === highlighted || peak.slug === selected || focused === item.id;
        return (
          <g
            key={item.id}
            {...props}
            className={cx(styles.peak, emphasised && styles.emphasised)}
            aria-label={peakAriaLabel(peak, countries, unit)}
            aria-haspopup="dialog"
            data-slug={peak.slug}
            data-metres={peak.elevationM}
            data-emphasised={emphasised || undefined}
            data-band={peak.territory ? 'territory' : undefined}
            data-testid="harim-map-peak"
          >
            <circle cx={peak.x} cy={peak.y} r={Math.max(r + 6, 12)} className={styles.hit} />
            {peak.isShared && (
              <circle cx={peak.x} cy={peak.y} r={r + 3.5} className={styles.sharedRing} />
            )}
            <path
              d={glyphPath(peak.x, peak.y, r)}
              className={styles.glyph}
              style={{ '--band': bandFill(peak) }}
            />
            {emphasised && (
              <circle cx={peak.x} cy={peak.y - r * 0.2} r={r + 7} className={styles.focusRing} />
            )}
          </g>
        );
      })}
      <g className={styles.labels} aria-hidden="true">
        {layout.labels.map((label) => (
          <text
            key={label.slug}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            className={cx(
              styles.label,
              (label.slug === selected || label.slug === highlighted) && styles.labelStrong,
            )}
            data-label={label.slug}
          >
            {label.text}
          </text>
        ))}
      </g>

      {overlay &&
        tooltipItem &&
        createPortal(
          <Tooltip item={tooltipItem} countries={countries} unit={unit} size={size} />,
          overlay,
        )}
      {overlay &&
        selectedItem?.kind === 'peak' &&
        createPortal(
          <PeakCard
            key={selectedItem.id}
            peak={selectedItem.peak}
            countries={countries}
            unit={unit}
            size={size}
            onClose={closeCard}
            onOpenPeak={onOpenPeak}
            onShowInTable={onShowInTable}
          />,
          overlay,
        )}
      {overlay &&
        groupItem?.kind === 'group' &&
        createPortal(
          <GroupCard
            key={groupItem.id}
            cluster={groupItem.cluster}
            unit={unit}
            size={size}
            onClose={closeCard}
            onPick={(slug) => {
              setGroup(null);
              onSelect(slug);
            }}
          />,
          overlay,
        )}
    </g>
  );
}

function lead(item: Item): Positioned {
  return item.kind === 'peak' ? item.peak : item.cluster.lead;
}

function onScreenCount(items: readonly Item[]): number {
  return items.reduce(
    (sum, item) => sum + (item.kind === 'peak' ? 1 : item.cluster.members.length),
    0,
  );
}

function bubbleCentre(peak: { x: number; y: number }, r: number) {
  return { x: peak.x + r * 0.95, y: peak.y - r * 1.05 };
}

function bubbleBox(peak: { x: number; y: number }, r: number): Box {
  const { x, y } = bubbleCentre(peak, r);
  return { x0: x - BUBBLE_R, y0: y - BUBBLE_R, x1: x + BUBBLE_R, y1: y + BUBBLE_R };
}

/** Places an overlay above (or below) a point, kept inside the map. */
function usePlacement(
  ref: RefObject<HTMLDivElement | null>,
  anchor: { x: number; y: number; gap: number },
  size: { width: number; height: number },
) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Cards and tooltips stay clear of the zoom controls' column, so they never cover a button.
    const { left, top } = placeTooltip(
      { left: anchor.x, top: anchor.y - anchor.gap, width: 0, height: anchor.gap * 2 },
      { width: node.offsetWidth, height: node.offsetHeight },
      {
        width: Math.max(node.offsetWidth + 16, size.width - CONTROLS_WIDTH + 12),
        height: size.height,
      },
      'top',
    );
    node.style.left = `${String(left)}px`;
    node.style.top = `${String(top)}px`;
  });
}

function Flags({ peak, countries }: { peak: MapPeak; countries: ReadonlyMap<string, CountryRef> }) {
  if (peak.territory !== null) return <span>{whereLabel(peak, countries)}</span>;
  return (
    <span className={styles.flags}>
      {peak.countries.map((iso3) => {
        const country = countries.get(iso3);
        return (
          <span key={iso3} className={styles.flagName}>
            {country && (
              <FlagImage
                flag={country.flag}
                countryName={country.name}
                width={20}
                loading="eager"
                decorative
              />
            )}
            {country?.name ?? iso3}
          </span>
        );
      })}
    </span>
  );
}

function Tooltip({
  item,
  countries,
  unit,
  size,
}: {
  item: Item;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  size: { width: number; height: number };
}) {
  const p = lead(item);
  const ref = useRef<HTMLDivElement>(null);
  usePlacement(ref, { x: p.x, y: p.y, gap: 14 }, size);
  return (
    <div
      ref={ref}
      className={cx('glass glass--strong', styles.tooltip)}
      role="tooltip"
      data-testid="harim-map-tooltip"
    >
      {item.kind === 'peak' ? (
        <>
          <strong>{p.name}</strong>
          <span className={styles.figure}>
            {formatElevation(p.elevationM, unit)} · {formatElevation(p.elevationM, otherUnit(unit))}
          </span>
          <Flags peak={p} countries={countries} />
        </>
      ) : (
        <>
          <strong>{item.cluster.label}</strong>
          {item.cluster.members.slice(0, 4).map((member) => (
            <span key={member.slug} className={styles.figure}>
              {member.name} · {formatElevation(member.elevationM, unit)}
            </span>
          ))}
          {item.cluster.members.length > 4 && <span>…</span>}
        </>
      )}
    </div>
  );
}

function useCardFocus(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && ref.current?.contains(document.activeElement)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [ref]);
}

function PeakCard({
  peak,
  countries,
  unit,
  size,
  onClose,
  onOpenPeak,
  onShowInTable,
}: {
  peak: Positioned;
  countries: ReadonlyMap<string, CountryRef>;
  unit: Unit;
  size: { width: number; height: number };
  onClose: () => void;
  onOpenPeak: (slug: string) => void;
  onShowInTable: (slug: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePlacement(ref, { x: peak.x, y: peak.y, gap: 18 }, size);
  useCardFocus(ref, onClose);
  const titleId = `peak-card-${peak.slug}`;
  return (
    <div
      ref={ref}
      className={cx('glass glass--strong', styles.card)}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="harim-map-card"
    >
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          {peak.name}
        </h3>
        <IconButton
          icon="close"
          label={text.close}
          variant="plain"
          iconSize={20}
          onClick={onClose}
        />
      </div>
      <p className={styles.cardHeight}>
        <strong>{formatElevation(peak.elevationM, unit)}</strong>{' '}
        <span>{formatElevation(peak.elevationM, otherUnit(unit))}</span>
      </p>
      <Flags peak={peak} countries={countries} />
      <p className={styles.cardMeta}>
        {[peak.rangeName, peakTypeLabel(peak.mountain)].filter(Boolean).join(' · ')}
      </p>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.primary}
          aria-haspopup="dialog"
          onClick={() => {
            onOpenPeak(peak.slug);
          }}
        >
          {text.openDetails}
        </button>
        {peak.territory === null && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              onShowInTable(peak.slug);
            }}
          >
            <Icon name="table_view" size={18} />
            {text.showInTable}
          </button>
        )}
      </div>
    </div>
  );
}

function GroupCard({
  cluster,
  unit,
  size,
  onClose,
  onPick,
}: {
  cluster: Cluster<Positioned>;
  unit: Unit;
  size: { width: number; height: number };
  onClose: () => void;
  onPick: (slug: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePlacement(ref, { x: cluster.lead.x, y: cluster.lead.y, gap: 16 }, size);
  useCardFocus(ref, onClose);
  const titleId = `group-card-${cluster.lead.slug}`;
  return (
    <div
      ref={ref}
      className={cx('glass glass--strong', styles.card)}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="harim-map-group-card"
    >
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          {cluster.label}
        </h3>
        <IconButton
          icon="close"
          label={text.close}
          variant="plain"
          iconSize={20}
          onClick={onClose}
        />
      </div>
      <ul className={styles.memberList}>
        {cluster.members.map((member) => (
          <li key={member.slug}>
            <button
              type="button"
              className={styles.member}
              onClick={() => {
                onPick(member.slug);
              }}
            >
              <span>{member.name}</span>
              <span className={styles.figure}>{formatElevation(member.elevationM, unit)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
