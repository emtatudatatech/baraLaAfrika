import type { IconName } from '../components/Icon/iconNames';
import { strings } from '../lib/strings';

export type NavItem =
  | { kind: 'link'; to: string; label: string; icon: IconName; end?: boolean }
  | { kind: 'soon'; label: string; icon: IconName };

/** Nav order: Home · Countries · Harim · Dhahabu · Vinara · (disabled: History). */
export const NAV_ITEMS: readonly NavItem[] = [
  { kind: 'link', to: '/', label: strings.nav.home, icon: 'home', end: true },
  { kind: 'link', to: '/countries', label: strings.nav.countries, icon: 'public' },
  { kind: 'link', to: '/harim', label: strings.nav.harim, icon: 'landscape' },
  { kind: 'link', to: '/dhahabu', label: strings.nav.dhahabu, icon: 'diamond' },
  { kind: 'link', to: '/vinara', label: strings.nav.vinara, icon: 'military_tech' },
  { kind: 'soon', label: strings.nav.history, icon: 'history_edu' },
];
