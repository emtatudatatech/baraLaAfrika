import { type ReactNode, useEffect, useId, useRef } from 'react';

import { cx } from '../../lib/cx';
import { parseReviewNotes } from '../../lib/reviewNotes';
import { strings } from '../../lib/strings';
import { DevApiHint } from '../DevApiHint/DevApiHint';
import { Icon } from '../Icon/Icon';
import { IconButton } from '../IconButton/IconButton';
import type { IconName } from '../Icon/iconNames';
import styles from './Drawer.module.css';

export interface DrawerProps {
  title: ReactNode;
  /** Shown under the title (e.g. an official name and a region chip). */
  subtitle?: ReactNode;
  /** Shown before the title (e.g. a flag). */
  media?: ReactNode;
  /** CSS colour for the accent edge, e.g. `var(--region-east)`. */
  accent: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal <dialog>: a side panel on wide screens, a bottom sheet on phones. The native dialog
 * makes the rest of the page inert, traps focus, closes on Escape (and on a backdrop click) and
 * returns focus to the control that opened it. `onClose` runs once the dialog has closed.
 */
export function Drawer({ title, subtitle, media, accent, testId, onClose, children }: DrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const handleClose = () => {
      onCloseRef.current();
    };
    // A click on the backdrop targets the dialog element itself (Escape is the keyboard way).
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleBackdropClick);
    // No close() on cleanup: its 'close' event is queued, so under StrictMode's re-run it would
    // shut the dialog that was just reopened. Removing an open dialog from the DOM (unmount)
    // already takes it out of the top layer.
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.drawer}
      aria-labelledby={titleId}
      style={{ '--accent': accent }}
      data-testid={testId}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          {media ?? <span />}
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle}
          </div>
          <IconButton
            icon="close"
            label={strings.drawer.close}
            variant="plain"
            className={styles.close}
            onClick={() => dialogRef.current?.close()}
          />
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function DrawerSection({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h3 id={id} className={styles.sectionTitle}>
        <Icon name={icon} size={20} />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function DrawerSkeleton({ count }: { count: number }) {
  return (
    <span className={styles.skeletonLines} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cx('skeleton', styles.skeletonLine)} />
      ))}
    </span>
  );
}

/** The long text once loaded; placeholder lines while it loads; nothing if there is none. */
export function DrawerDetail({
  loading,
  text,
}: {
  loading: boolean;
  text: string | null | undefined;
}) {
  if (loading) return <DrawerSkeleton count={2} />;
  return text ? <p>{text}</p> : null;
}

export function DrawerError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <Icon name="error" size={20} />
      <span>{strings.drawer.loadError}</span>
      <button type="button" className={styles.retry} onClick={onRetry}>
        {strings.drawer.retry}
      </button>
      <DevApiHint error={error} className={styles.hintRow} />
    </div>
  );
}

/** "Needs verification", expanding to the reasons. */
export function DrawerReview({ notes }: { notes: string | null }) {
  const parsed = parseReviewNotes(notes);
  return (
    <details className={styles.review} data-testid="needs-review">
      <summary>
        <Icon name="info" size={20} />
        <span>
          <strong>{strings.drawer.needsReview}</strong>{' '}
          <span className={styles.reviewHint}>{strings.drawer.needsReviewHint}</span>
        </span>
      </summary>
      {parsed.length > 0 && (
        <ul className={styles.reviewNotes}>
          {parsed.map((note, index) => (
            <li key={index}>
              <span
                className={cx(styles.noteKind, note.kind === 'correction' && styles.noteCorrection)}
              >
                {strings.drawer.noteKinds[note.kind]}
              </span>{' '}
              {note.text}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export interface DrawerSource {
  key: string;
  title: string;
  url: string;
  reliabilityTier: 'primary' | 'reference' | 'secondary' | 'low';
  refNo?: number | null;
  /** What the source supports, already labelled. */
  usedFor: string[];
}

export function DrawerSources({
  sources,
  note,
}: {
  sources: readonly DrawerSource[];
  note: string;
}) {
  if (sources.length === 0) return <p className={styles.meta}>{strings.drawer.noSources}</p>;
  return (
    <>
      <p className={styles.meta}>{note}</p>
      <ol className={styles.sources}>
        {sources.map((source) => (
          <li key={source.key} className={styles.source}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.refNo != null && <span className={styles.refNo}>[{source.refNo}]</span>}{' '}
              {source.title}
              <Icon name="open_in_new" size={18} className={styles.external} />
              <span className="visually-hidden"> {strings.drawer.newTab}</span>
            </a>
            <span className={styles.sourceMeta}>
              <span className={cx(styles.tier, source.reliabilityTier === 'low' && styles.tierLow)}>
                {strings.reliabilityTier[source.reliabilityTier]}
              </span>
              {source.usedFor.length > 0 && (
                <span>
                  {strings.drawer.usedFor}: {source.usedFor.join(', ')}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
