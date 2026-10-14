/** Mirror of the @custom-media tokens in src/styles/media.css (a unit test keeps them in sync). */
export const BREAKPOINTS = {
  sm: 480,
  md: 720,
  lg: 1024,
  xl: 1280,
  '2xl': 1440,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function minWidthQuery(breakpoint: Breakpoint): string {
  return `(width >= ${BREAKPOINTS[breakpoint]}px)`;
}
