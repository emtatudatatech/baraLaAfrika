import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { placeTooltip } from './placeTooltip';
import styles from './Tooltip.module.css';

export interface TooltipTriggerProps {
  ref: (element: HTMLElement | null) => void;
  'aria-describedby': string;
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: (event: PointerEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onClick: () => void;
  onFocus: (event: FocusEvent) => void;
  onBlur: (event: FocusEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

export interface UseTooltipOptions {
  content: ReactNode;
  placement?: 'top' | 'bottom';
}

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 150;

/**
 * Accessible tooltip (WCAG 1.4.13): shows on hover and keyboard focus, stays open while the
 * pointer moves onto it, dismisses with Escape, and toggles on tap for touch input (no
 * hover-only affordance). The tooltip is always in the DOM (hidden when closed) so
 * aria-describedby gives screen-reader users the same text. Its position is clamped to the
 * viewport so it is never clipped.
 *
 * Usage: `const tip = useTooltip({ content })`, spread `tip.triggerProps` on a focusable
 * element and render `tip.tooltip` anywhere (it portals to <body>).
 */
export function useTooltip({ content, placement = 'top' }: UseTooltipOptions): {
  triggerProps: TooltipTriggerProps;
  tooltip: ReactNode;
  open: boolean;
} {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastPointerType = useRef<string>('mouse');
  // A tap focuses the trigger before its click; the click alone decides (or it would toggle shut).
  const touchPending = useRef(false);

  const schedule = useCallback((next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(next);
    }, delay);
  }, []);

  const cancelScheduled = useCallback(() => {
    window.clearTimeout(timer.current);
  }, []);

  useEffect(() => cancelScheduled, [cancelScheduled]);

  // Escape anywhere and taps outside close an open tooltip.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (trigger?.contains(target) || tooltipRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, trigger]);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!open || !trigger || !node) return;
    const update = () => {
      const { left, top, side } = placeTooltip(
        trigger.getBoundingClientRect(),
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
        placement,
      );
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.dataset.side = side;
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, trigger, placement]);

  const triggerProps: TooltipTriggerProps = {
    ref: setTrigger,
    'aria-describedby': id,
    onPointerEnter: (event) => {
      lastPointerType.current = event.pointerType;
      if (event.pointerType !== 'touch') schedule(true, OPEN_DELAY_MS);
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'touch') schedule(false, CLOSE_DELAY_MS);
    },
    onPointerDown: (event) => {
      lastPointerType.current = event.pointerType;
      touchPending.current = event.pointerType === 'touch';
    },
    onClick: () => {
      touchPending.current = false;
      if (lastPointerType.current === 'touch') setOpen((value) => !value);
    },
    onFocus: () => {
      cancelScheduled();
      if (!touchPending.current) setOpen(true);
    },
    onBlur: () => {
      schedule(false, 0);
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
      }
    },
  };

  const tooltip = createPortal(
    <div
      ref={tooltipRef}
      id={id}
      role="tooltip"
      hidden={!open}
      className={`glass glass--strong ${styles.tooltip}`}
      onPointerEnter={cancelScheduled}
      onPointerLeave={() => {
        schedule(false, CLOSE_DELAY_MS);
      }}
    >
      {content}
    </div>,
    document.body,
  );

  return { triggerProps, tooltip, open };
}
