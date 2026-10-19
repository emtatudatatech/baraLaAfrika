import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../../components/Icon/Icon';
import { strings } from '../../lib/strings';
import styles from './HowToRead.module.css';

const text = strings.dhahabu;

/**
 * "How to read this page" (spec 7.6): the honesty rules behind every label, in a small dialog
 * that opens from the header. Escape or a click outside closes it and returns focus.
 */
export function HowToRead() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        {...(open ? { 'aria-controls': panelId } : {})}
        data-testid="gold-how-to-read"
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        <Icon name="info" size={20} />
        {text.howToRead}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          role="dialog"
          tabIndex={-1}
          aria-labelledby={`${panelId}-title`}
          data-testid="gold-how-to-read-panel"
        >
          <p id={`${panelId}-title`} className={styles.title}>
            {text.howToReadTitle}
          </p>
          <ul className={styles.list}>
            {text.howToReadItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.close}
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            {text.close}
          </button>
        </div>
      )}
    </div>
  );
}
