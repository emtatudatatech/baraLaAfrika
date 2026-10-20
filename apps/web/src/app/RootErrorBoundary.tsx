import { strings } from '../lib/strings';
import styles from './StatusPage.module.css';

/**
 * Last-resort boundary for failures in the layout itself (no nav or ribbon available), so it
 * avoids router components and uses a plain link.
 */
export function RootErrorBoundary() {
  return (
    <main className={styles.root}>
      <section className={`glass ${styles.page}`} role="alert">
        <h1>{strings.pages.error.title}</h1>
        <p>{strings.pages.error.body}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              window.location.reload();
            }}
          >
            {strings.pages.error.retry}
          </button>
          <a href="/" className={styles.secondary}>
            {strings.pages.error.home}
          </a>
        </div>
      </section>
    </main>
  );
}
