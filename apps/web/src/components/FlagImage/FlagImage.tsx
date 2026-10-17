import type { Flag } from '@bla/shared';
import { useState } from 'react';

import { cx } from '../../lib/cx';
import styles from './FlagImage.module.css';

/** Flagcdn widths available for PNG flags. */
const CDN_WIDTHS = [20, 40, 80, 160, 320, 640] as const;

function cdnWidth(cssWidth: number, density: number): number {
  return CDN_WIDTHS.find((w) => w >= cssWidth * density) ?? 640;
}

export interface FlagImageProps {
  flag: Flag;
  countryName: string;
  /** Box size in CSS px (3:2); the flag is fitted inside without distortion. */
  width: number;
  className?: string | undefined;
  loading?: 'lazy' | 'eager';
  /** Decorative when the country is named right beside the flag (alt="", not read twice). */
  decorative?: boolean;
}

/**
 * A Flagpedia flag (flagcdn.com PNG with 1x/2x sources and explicit dimensions to avoid layout
 * shift). Falls back to the self-hosted SVG if the CDN fails.
 */
export function FlagImage({
  flag,
  countryName,
  width,
  className,
  loading = 'lazy',
  decorative = false,
}: FlagImageProps) {
  const [failed, setFailed] = useState(false);
  const height = Math.round((width * 2) / 3);
  const src = (w: number) => flag.pngUrlTemplate.replace('{width}', String(w));
  return (
    <img
      className={cx(styles.flag, className)}
      src={failed ? flag.fallbackUrl : src(cdnWidth(width, 1))}
      {...(failed
        ? {}
        : { srcSet: `${src(cdnWidth(width, 1))} 1x, ${src(cdnWidth(width, 2))} 2x` })}
      width={width}
      height={height}
      alt={decorative ? '' : `Flag of ${countryName}`}
      loading={loading}
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
