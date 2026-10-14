import { useEffect, useId, useState } from 'react';
import { Link, NavLink } from 'react-router';

import { Icon } from '../../components/Icon/Icon';
import { IconButton } from '../../components/IconButton/IconButton';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import { cx } from '../../lib/cx';
import { strings } from '../../lib/strings';
import { NAV_ITEMS } from '../navigation';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link to="/" className={styles.brand} onClick={closeMenu}>
          <span className={styles.mark} aria-hidden="true">
            B
          </span>
          <span className={styles.brandName}>{strings.site.name}</span>
        </Link>

        <nav
          id={navId}
          aria-label={strings.a11y.primaryNav}
          className={cx(styles.nav, menuOpen && styles.navOpen)}
        >
          <ul className={cx('glass', styles.list)}>
            {NAV_ITEMS.map((item) =>
              item.kind === 'link' ? (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) => cx(styles.link, isActive && styles.active)}
                    onClick={closeMenu}
                  >
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ) : (
                <li key={item.label}>
                  <span className={cx(styles.link, styles.soon)} aria-disabled="true">
                    <Icon name={item.icon} size={20} />
                    <span>{item.label}</span>
                    <span className={styles.soonBadge}>
                      <Icon name="schedule" size={18} />
                      <span className={styles.soonText}>{strings.nav.comingSoon}</span>
                    </span>
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className={styles.tools}>
          <ThemeToggle />
          <IconButton
            className={styles.menuButton}
            icon={menuOpen ? 'close' : 'menu'}
            label={menuOpen ? strings.a11y.closeMenu : strings.a11y.openMenu}
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => {
              setMenuOpen((value) => !value);
            }}
          />
        </div>
      </div>
    </header>
  );
}
