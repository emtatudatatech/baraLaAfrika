import type { CountryDetail, CountrySummary, Source } from '@bla/shared';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { AnimalStatusBadge } from '../../components/AnimalStatusBadge/AnimalStatusBadge';
import { DevApiHint } from '../../components/DevApiHint/DevApiHint';
import { FlagImage } from '../../components/FlagImage/FlagImage';
import { Icon } from '../../components/Icon/Icon';
import { IconButton } from '../../components/IconButton/IconButton';
import { RegionChip } from '../../components/RegionChip/RegionChip';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { useResource } from '../../lib/useResource';
import { territoryNote } from '../map/territoryNotes';
import styles from './CountryDrawer.module.css';
import { parseReviewNotes } from './reviewNotes';

export interface CountryDrawerProps {
  /** The summary already on screen; the full profile is fetched on open. */
  country: CountrySummary;
  onClose: () => void;
}

/**
 * Full country profile in a modal <dialog>: a side panel on wide screens, a bottom sheet on
 * phones. The native dialog makes the rest of the page inert, traps focus, closes on Escape and
 * returns focus to the control that opened it.
 */
export function CountryDrawer({ country, onClose }: CountryDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const detail = useResource(`country:${country.iso3}`, () => api.country(country.iso3));
  const full = detail.status === 'success' ? detail.data.country : undefined;
  const note = territoryNote(country.iso3);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Escape and close() both end in 'close'; the parent then drops ?country= from the URL.
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

  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className={styles.drawer}
      aria-labelledby={titleId}
      style={{ '--accent': `var(--region-${country.region.slug})` }}
      data-testid="country-drawer"
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <FlagImage flag={country.flag} countryName={country.name} width={72} loading="eager" />
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {country.name}
            </h2>
            {country.officialName !== null && (
              <p className={styles.official}>
                <span className="visually-hidden">{strings.drawer.officialName}: </span>
                {country.officialName}
              </p>
            )}
            <RegionChip slug={country.region.slug} name={country.region.name} />
          </div>
          <IconButton
            icon="close"
            label={strings.drawer.close}
            variant="plain"
            className={styles.close}
            onClick={close}
          />
        </header>

        {note !== undefined && <p className={styles.territory}>{note}</p>}

        {country.needsReview && <ReviewMarker notes={full?.reviewNotes ?? null} />}

        {detail.status === 'error' && (
          <div className={styles.error} role="alert">
            <Icon name="error" size={20} />
            <span>{strings.drawer.loadError}</span>
            <button type="button" className={styles.retry} onClick={detail.retry}>
              {strings.drawer.retry}
            </button>
            <DevApiHint error={detail.error} className={styles.hintRow} />
          </div>
        )}

        <Section icon="history_edu" title={strings.drawer.meaning}>
          <p className={styles.lead}>{country.etymologySummary}</p>
          <Detail loading={detail.status === 'loading'} text={full?.etymologyDetail} />
          {country.etymologyCategory !== null && (
            <p className={styles.meta}>
              {strings.drawer.category}: {strings.etymologyCategory[country.etymologyCategory]}
            </p>
          )}
        </Section>

        <Section icon="flag" title={strings.drawer.flag}>
          <p className={styles.lead}>{country.flagDesignSummary}</p>
          {country.flagDesignDetail !== null && <p>{country.flagDesignDetail}</p>}
        </Section>

        <Section icon="workspace_premium" title={strings.drawer.symbol}>
          <p className={styles.lead}>{country.nationalSymbolSummary}</p>
          <Detail loading={detail.status === 'loading'} text={full?.nationalSymbolDetail} />
        </Section>

        <Section icon="pets" title={strings.drawer.animal}>
          <p className={styles.lead}>
            {country.nationalAnimalName}
            {full?.nationalAnimalScientific != null && (
              <>
                {' '}
                <i className={styles.scientific}>({full.nationalAnimalScientific})</i>
              </>
            )}{' '}
            <AnimalStatusBadge status={country.animalStatus} />
          </p>
          <p className={styles.meta}>{strings.animalStatusHint[country.animalStatus]}</p>
          <Detail loading={detail.status === 'loading'} text={full?.nationalAnimalDetail} />
        </Section>

        <Section icon="info" title={strings.drawer.sources}>
          {full ? (
            <SourceList sources={full.sources} />
          ) : (
            detail.status === 'loading' && <SkeletonLines count={3} />
          )}
        </Section>
      </div>
    </dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: 'history_edu' | 'flag' | 'workspace_premium' | 'pets' | 'info';
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

/** The long text once loaded; placeholder lines while it loads; nothing if there is none. */
function Detail({ loading, text }: { loading: boolean; text: string | null | undefined }) {
  if (loading) return <SkeletonLines count={2} />;
  return text ? <p>{text}</p> : null;
}

function SkeletonLines({ count }: { count: number }) {
  return (
    <span className={styles.skeletonLines} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cx('skeleton', styles.skeletonLine)} />
      ))}
    </span>
  );
}

function ReviewMarker({ notes }: { notes: CountryDetail['reviewNotes'] }) {
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

function SourceList({ sources }: { sources: readonly Source[] }) {
  if (sources.length === 0) return <p className={styles.meta}>{strings.drawer.noSources}</p>;
  return (
    <>
      <p className={styles.meta}>{strings.drawer.sourcesNote}</p>
      <ol className={styles.sources}>
        {sources.map((source) => (
          <li key={source.key} className={styles.source}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.refNo !== null && <span className={styles.refNo}>[{source.refNo}]</span>}{' '}
              {source.title}
              <Icon name="open_in_new" size={18} className={styles.external} />
              <span className="visually-hidden"> {strings.drawer.newTab}</span>
            </a>
            <span className={styles.sourceMeta}>
              <span className={cx(styles.tier, source.reliabilityTier === 'low' && styles.tierLow)}>
                {strings.reliabilityTier[source.reliabilityTier]}
              </span>
              <span>
                {strings.drawer.usedFor}:{' '}
                {source.fields.map((field) => strings.profileField[field]).join(', ')}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
