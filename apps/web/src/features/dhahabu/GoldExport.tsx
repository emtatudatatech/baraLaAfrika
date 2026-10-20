import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { IconButton } from '../../components/IconButton/IconButton';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from '../harim/ExportMenu.module.css';

const text = strings.dhahabu.export;

type Scope = 'view' | 'all';

function filenameOf(response: Response): string {
  const header = response.headers.get('Content-Disposition') ?? '';
  return /filename="([^"]+)"/.exec(header)?.[1] ?? 'dhahabu-countries.csv';
}

/**
 * "Export" on the country table: the current view (filters and reference year) or all 54
 * countries as CSV from /api/gold/export, with the sources, licences, required attributions and
 * notes in its header block. A toast confirms the download or reports the failure.
 */
export function GoldExport({ viewParams }: { viewParams: Record<string, string | undefined> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const download = async (scope: Scope) => {
    setOpen(false);
    setBusy(true);
    try {
      const response = await fetch(api.goldExportUrl(scope === 'view' ? viewParams : {}));
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const filename = filenameOf(response);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      setToast({ kind: 'success', message: text.success(filename) });
    } catch {
      setToast({ kind: 'error', message: text.error });
    } finally {
      setBusy(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy}
        disabled={busy}
        data-testid="gold-export"
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        <Icon name="download" size={20} />
        {text.button}
      </button>
      {open && (
        <div
          id={menuId}
          className={cx('glass glass--strong', styles.menu)}
          data-testid="gold-export-menu"
        >
          <p className={styles.title}>{text.menuLabel}</p>
          <div role="group" aria-label={text.menuLabel} className={styles.group}>
            {(['view', 'all'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                className={styles.item}
                data-testid={`gold-export-${scope}`}
                onClick={() => {
                  void download(scope);
                }}
              >
                {text[scope]}
              </button>
            ))}
          </div>
          <p className={styles.note}>{text.note}</p>
        </div>
      )}
      {toast && (
        <div
          className={cx(
            'glass glass--strong',
            styles.toast,
            toast.kind === 'error' && styles.error,
          )}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          data-testid="gold-export-toast"
        >
          <Icon name={toast.kind === 'error' ? 'error' : 'download'} size={20} />
          <span>{toast.message}</span>
          <IconButton
            icon="close"
            label={text.dismiss}
            iconSize={20}
            onClick={() => {
              setToast(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
