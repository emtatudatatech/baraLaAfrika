import { Outlet, ScrollRestoration } from 'react-router';

import { DataRibbon } from '../../features/coverage/DataRibbon';
import { TimeRangeProvider } from '../../features/coverage/TimeRangeProvider';
import { strings } from '../../lib/strings';
import styles from './Layout.module.css';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/** Shell: skip link → data ribbon → header/nav → main content → footer. */
export function Layout() {
  return (
    <TimeRangeProvider>
      <a className={styles.skipLink} href="#main">
        {strings.a11y.skipToContent}
      </a>
      <DataRibbon />
      <SiteHeader />
      <main id="main" tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <SiteFooter />
      <ScrollRestoration />
    </TimeRangeProvider>
  );
}
