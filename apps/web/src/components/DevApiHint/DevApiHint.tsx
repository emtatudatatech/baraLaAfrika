import { devApiHint } from '../../lib/apiHint';
import { cx } from '../../lib/cx';
import styles from './DevApiHint.module.css';

/** In development, explains why an API call failed and what to run. Renders nothing otherwise. */
export function DevApiHint({
  error,
  className,
}: {
  error: unknown;
  className?: string | undefined;
}) {
  const hint = devApiHint(error);
  if (hint === null) return null;
  return (
    <p className={cx(styles.hint, className)} data-testid="dev-api-hint">
      {hint
        .split('`')
        .map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}
    </p>
  );
}
