import 'react';

declare module 'react' {
  // Interface augmentation needs an index signature (a Record type alias cannot merge).
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  interface CSSProperties {
    /** Allow CSS custom properties (e.g. region colours, icon size) in style props. */
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
