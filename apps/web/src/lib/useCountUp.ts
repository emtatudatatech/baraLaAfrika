import { useEffect, useState } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/**
 * Counts up from 0 to `target` once, when the component first mounts with `animate` set
 * (ease-out, `durationMs` at most). Later changes of `target` show at once. Off for reduced
 * motion. Returns the number to show and whether it is still counting.
 */
export function useCountUp(
  target: number | null,
  animate: boolean,
  durationMs = 800,
): { value: number | null; counting: boolean } {
  // What the component mounted with: only that target is ever animated.
  const [initialTarget] = useState(target);
  const [enabled] = useState(animate);
  const [frame, setFrame] = useState<number | null>(() =>
    animate && target !== null && target !== 0 && !prefersReducedMotion() ? 0 : null,
  );

  useEffect(() => {
    const start = initialTarget;
    if (!enabled || start === null || start === 0 || prefersReducedMotion()) return;
    let request = 0;
    let began: number | null = null;
    const tick = (now: number) => {
      began ??= now;
      const progress = Math.min(1, (now - began) / durationMs);
      if (progress < 1) {
        setFrame(start * (1 - (1 - progress) ** 3));
        request = requestAnimationFrame(tick);
      } else {
        setFrame(null);
      }
    };
    request = requestAnimationFrame(tick);
    // StrictMode re-runs the effect: cancelling (without resetting) lets the re-run start over.
    return () => {
      cancelAnimationFrame(request);
    };
  }, [initialTarget, enabled, durationMs]);

  // A new target (e.g. another region) replaces the animation.
  const animating = frame !== null && target === initialTarget;
  return { value: animating ? frame : target, counting: animating };
}
