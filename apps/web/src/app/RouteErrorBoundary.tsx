import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

import { GlassCard } from '../components/GlassCard/GlassCard';
import { Icon } from '../components/Icon/Icon';
import { strings } from '../lib/strings';
import styles from './StatusPage.module.css';

/** Rendered inside the layout when a route fails to load or render. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundContent />;
  }
  if (import.meta.env.DEV) console.error(error);
  return (
    <GlassCard as="section" padding="lg" className={styles.page} role="alert">
      <title>{`${strings.pages.error.title} · ${strings.site.name}`}</title>
      <Icon name="error" size={40} className={styles.icon} />
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
          <Icon name="refresh" size={20} />
          {strings.pages.error.retry}
        </button>
        <Link to="/" className={styles.secondary}>
          {strings.pages.error.home}
        </Link>
      </div>
    </GlassCard>
  );
}

export function NotFoundContent() {
  return (
    <GlassCard as="section" padding="lg" className={styles.page}>
      <title>{`${strings.pages.notFound.title} · ${strings.site.name}`}</title>
      <meta name="robots" content="noindex" />
      <Icon name="map" size={40} className={styles.icon} />
      <h1>{strings.pages.notFound.title}</h1>
      <p>{strings.pages.notFound.body}</p>
      <div className={styles.actions}>
        <Link to="/" className={styles.primary}>
          {strings.pages.notFound.home}
        </Link>
      </div>
    </GlassCard>
  );
}
