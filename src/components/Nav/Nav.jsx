import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  AppBar,
  Toolbar,
  Box,
  Stack,
  Button,
  IconButton,
  Tooltip,
  Typography,
  Link,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import { useThemeMode } from '../../theme/AppThemeProvider';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';
import { isTypingTarget } from '../../shared/lib/isTypingTarget';
import { hasSessionHint } from '../../lib/sessionHint';

// Signed-in-only pieces: an anonymous visit never renders them, so they stay
// out of the boot bundle.
const loadNotificationBell = () => import('../NotificationBell/NotificationBell');
const loadGlobalPlayerSearch = () => import('../GlobalPlayerSearch/GlobalPlayerSearch');
const loadNavAccountMenu = () => import('./NavAccountMenu');
const loadNavDrawer = () => import('./NavDrawer');
const NotificationBell = lazyWithReload(loadNotificationBell);
const GlobalPlayerSearch = lazyWithReload(loadGlobalPlayerSearch);
const NavAccountMenu = lazyWithReload(loadNavAccountMenu);
const NavDrawer = lazyWithReload(loadNavDrawer);

// A returning user's session hint says these are about to render, so start their
// chunks now rather than when the session resolves (no pop-in in the app bar).
if (hasSessionHint()) {
  [loadNotificationBell, loadGlobalPlayerSearch, loadNavAccountMenu, loadNavDrawer].forEach((load) => load().catch(() => {}));
}

// Primary destinations shown inline on desktop and in the drawer on mobile.
// "Notification Settings" and "Log Out" intentionally live in the profile
// menu / drawer footer, not this top-level row.
const MAIN_LINKS = [
  { label: 'Home', to: '/user' },
  { label: 'League', to: '/league' },
  { label: 'Discover', to: '/discover' },
  { label: 'Players', to: '/player' },
  { label: 'Lineup', to: '/team' },
  { label: 'Mock Draft', to: '/draft-sim' },
];

function Nav() {
  const user = useSelector((store) => store.user);
  const dispatch = useDispatch();
  const { mode, toggleMode } = useThemeMode();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Why the drawer opened. The "/" shortcut opens it to reach the search inside
  // it on windows too narrow for the inline app-bar search (#934); a hamburger
  // tap opens it to navigate and must NOT steal focus into the search. This
  // records that intent so only the shortcut autofocuses the drawer's search.
  // Reset on every close so a later hamburger open starts clean.
  const [focusDrawerSearch, setFocusDrawerSearch] = useState(false);

  const loggedIn = !!user.id;
  // Once the drawer has mounted it stays, so logging out from it still plays the slide-out.
  const drawerMountedRef = useRef(false);
  if (loggedIn || drawerOpen) drawerMountedRef.current = true;
  const links = MAIN_LINKS;
  const isAdmin = user.isPlatformAdmin === true;

  const isActive = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setFocusDrawerSearch(false);
  };

  // "/" on a window with no inline search: open the drawer and mark it as
  // opened-for-search so the drawer's field autofocuses on mount (#934).
  const openDrawerForSearch = () => {
    setFocusDrawerSearch(true);
    setDrawerOpen(true);
  };

  // The "/" shortcut lives here, in the eagerly loaded nav, not in the lazy
  // search chunk: it is registered at nav mount (before any other window
  // keydown listener a page adds later), consumes the key from the first
  // keypress, and works whether or not the search chunk has arrived (#934).
  // It focuses the inline app-bar search when that can take focus. When it
  // cannot (CSS-hidden below `lg`), it opens the drawer and focuses the search
  // inside it. Focus is read as the real outcome rather than a layout property,
  // so it is right in a browser and in jsdom (which ignores media queries).
  // A ref keeps the listener registered exactly once.
  const inlineSearchRef = useRef(null);
  const shortcutRef = useRef(null);
  shortcutRef.current = { loggedIn, openDrawerForSearch };
  useEffect(() => {
    const onKey = (e) => {
      const { loggedIn: signedIn, openDrawerForSearch: openForSearch } = shortcutRef.current;
      if (e.key !== '/' || !signedIn || isTypingTarget(e.target)) return;
      const box = inlineSearchRef.current;
      if (!box) return;
      const el = box.querySelector('input');
      if (el) {
        el.focus();
        if (document.activeElement === el) {
          e.preventDefault();
          return;
        }
      } else if (box.getClientRects().length > 0) {
        // The inline search is laid out but its chunk has not mounted yet:
        // leave the key alone rather than open a drawer on a wide window.
        return;
      }
      e.preventDefault();
      openForSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = () => {
    closeDrawer();
    dispatch({ type: 'LOGOUT' });
  };

  const linkSx = (to) => ({
    px: 1.25,
    py: 3,
    fontSize: 15,
    whiteSpace: 'nowrap',
    color: isActive(to) ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: isActive(to) ? 700 : 400,
    borderBottom: isActive(to) ? '2px solid var(--accent)' : '2px solid transparent',
    borderRadius: 0,
    transition: 'color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
    '&:hover': { color: 'var(--accent)', bgcolor: 'var(--accent-soft)' },
  });

  const themeToggle = (
    <Tooltip title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
      <IconButton aria-label="Toggle theme" onClick={toggleMode} size="small" sx={MIN_TOUCH_TARGET_SX}>
        {mode === 'light' ? <Brightness4Icon fontSize="small" /> : <Brightness7Icon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        mb: '30px',
        bgcolor: 'var(--surface-raised)',
        color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* data-testid: the geometry spec (tests/e2e/nav-fits-viewport.spec.ts)
          measures overflow on the Toolbar element itself. getByRole('banner')
          is not safe here - the player quick-view also renders a header
          element - so the toolbar carries a stable id instead (#927). */}
      <Toolbar sx={{ gap: 1 }} data-testid="app-nav-toolbar">
        {loggedIn && (
          <IconButton
            aria-label="open navigation menu"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { xs: 'inline-flex', lg: 'none' }, color: 'var(--text-muted)', ...MIN_TOUCH_TARGET_SX }}
          >
            <MenuIcon />
          </IconButton>
        )}

        {/* aria-label pins the link's accessible name to the brand at every
            width. Below `sm` the wordmark text is not rendered (icon-only on the
            narrowest phones, #927), which frees the room the 320-385 band needs;
            without an explicit label the link's only name is that text and it
            would be lost when hidden. */}
        <Link
          component={RouterLink}
          to="/home"
          underline="none"
          aria-label="Endzone Empire"
          sx={{ mr: { xs: 1, sm: 2 } }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <SportsFootballIcon sx={{ color: 'var(--accent)', fontSize: { xs: 22, sm: 26 } }} />
            <Typography
              component="span"
              sx={{
                color: 'var(--accent)',
                fontWeight: 700,
                fontSize: { xs: 18, sm: 22 },
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                display: { xs: 'none', sm: 'inline' },
              }}
            >
              Endzone Empire
            </Typography>
          </Stack>
        </Link>

        {/* Desktop inline links. The flexGrow:1 spacer stays even when logged
            out (it's what pushes Log In/Register to the edge), but the <nav>
            landmark itself only exists when it actually has links in it -
            an always-present, always-empty landmark is its own confusion for
            a screen reader user on the logged-out pages. */}
        <Box sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'stretch', flexGrow: 1 }}>
          {loggedIn && (
            <Box component="nav" aria-label="Primary navigation" sx={{ display: 'flex', alignItems: 'stretch' }}>
              {links.map((l) => (
                <Link key={l.to} component={RouterLink} to={l.to} underline="none" sx={linkSx(l.to)}>
                  {l.label}
                </Link>
              ))}
            </Box>
          )}
        </Box>

        {/* Pushes the right cluster to the edge below the desktop breakpoint
            (no desktop links to grow) */}
        <Box sx={{ flexGrow: 1, display: { xs: 'block', lg: 'none' } }} />

        {/* data-testid: the geometry spec asserts that no two adjacent children
            of this cluster overlap (the zero-minimum trap in #927 lets the
            search field slide under the icon buttons while the document reports
            no overflow at all). */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} data-testid="nav-right-cluster">
          {!loggedIn && (
            <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} sx={{ mr: { xs: 0, sm: 1 } }}>
              <Button
                component={RouterLink}
                to="/login"
                size="small"
                sx={{
                  minWidth: 0,
                  minHeight: MIN_TOUCH_TARGET_SX.minHeight,
                  px: { xs: 1, sm: 2 },
                  color: 'var(--text-muted)',
                  '&:hover': { color: 'var(--accent)' },
                }}
              >
                Log In
              </Button>
              <Button
                component={RouterLink}
                to="/registration"
                variant="outlined"
                size="small"
                sx={{ minWidth: 0, minHeight: MIN_TOUCH_TARGET_SX.minHeight, px: { xs: 1.25, sm: 2 } }}
              >
                Register
              </Button>
            </Stack>
          )}

          {loggedIn && (
            <Box ref={inlineSearchRef} sx={{ display: { xs: 'none', lg: 'block' }, mr: 1 }}>
              {/* Below `lg` this instance is CSS-hidden, so "/" cannot focus it;
                  the shortcut handler above then opens the drawer and focuses
                  its search instead, so it works at every width (#934). */}
              <Suspense fallback={null}>
                <GlobalPlayerSearch />
              </Suspense>
            </Box>
          )}
          {loggedIn && (
            <Suspense fallback={null}>
              <NotificationBell />
            </Suspense>
          )}
          {themeToggle}

          {loggedIn && (
            <Suspense fallback={null}>
              <NavAccountMenu user={user} isAdmin={isAdmin} onLogout={handleLogout} />
            </Suspense>
          )}
        </Box>
      </Toolbar>

      {/* Mobile navigation drawer. It stays mounted once mounted so its close
          transition runs (also on logout); an anonymous visit never mounts it. */}
      {drawerMountedRef.current && (
        <Suspense fallback={null}>
          <NavDrawer
            open={drawerOpen}
            onClose={closeDrawer}
            loggedIn={loggedIn}
            isAdmin={isAdmin}
            links={links}
            isActive={isActive}
            onLogout={handleLogout}
            focusSearch={focusDrawerSearch}
          />
        </Suspense>
      )}
    </AppBar>
  );
}

export default Nav;
