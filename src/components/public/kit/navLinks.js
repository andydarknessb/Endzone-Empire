/**
 * The public-layer primary navigation. Internal links use the public
 * BrowserRouter (plain paths); the auth CTAs cross into the hash app.
 */
// Players don't get their own index — they're browsed through Rankings — so the
// nav intentionally omits a redundant "Players" entry that would just duplicate it.
export const PUBLIC_NAV_LINKS = [
  { label: 'Rankings', to: '/rankings' },
  { label: 'Mock Draft', to: '/draft-simulator' },
  { label: 'Waiver Wire', to: '/waiver-wire' },
  { label: 'Strategy', to: '/strategy' },
  { label: 'Recaps', to: '/recaps' },
];

// Cross-boundary auth links (the authed app lives in the hash fragment).
export const LOGIN_HREF = '/#/login';
export const REGISTER_HREF = '/#/registration';
// Same crossing, for visitors who already have a session on this device.
export const DASHBOARD_HREF = '/#/user';
