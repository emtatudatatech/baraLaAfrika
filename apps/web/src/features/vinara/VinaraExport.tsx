import { useEffect, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import styles from '../harim/ExportMenu.module.css';

const text = strings.vinara.export;

function filenameOf(response: Response): string {
  const header = response.headers.get('Content-Disposition') ?? '';
  return /filename="([^"]+)"/.exec(header)?.[1] ?? 'vinara.csv';
}

/**
 * "Export CSV": every measure's ranking for the page's scope and years from /api/vinara/export,
 * with the definitions, notes and the sources' required attributions in its header block. A
 * toast confirms the download or reports the failure.
 */
export function VinaraExport({ params }: { params: Record<string, string | undefined> }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch(api.vinaraExportUrl(params));
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
    <div className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-busy={busy}
        aria-describedby="vinara-export-note"
        disabled={busy}
        data-testid="vinara-export"
        onClick={() => {
          void download();
        }}
      >
        <Icon name="download" size={20} />
        {busy ? text.busy : text.button}
      </button>
      <span id="vinara-export-note" className="visually-hidden">
        {text.note}
      </span>
      {toast && (
        <div
          className={cx(
            'glass glass--strong',
            styles.toast,
            toast.kind === 'error' && styles.error,
          )}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          data-testid="vinara-export-toast"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
