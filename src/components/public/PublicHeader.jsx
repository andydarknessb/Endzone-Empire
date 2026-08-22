import React, { useState } from 'react';
import { Link as RouterLink, NavLink } from 'react-router-dom';
import {
  AppBar, Toolbar, Container, Box, Button, IconButton, Drawer, List, ListItem,
  ListItemButton, ListItemText, Stack, Divider, Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useThemeMode } from '../../theme/AppThemeProvider';
import { hasSessionHint } from '../../lib/sessionHint';
import { PUBLIC_NAV_LINKS, LOGIN_HREF, REGISTER_HREF, DASHBOARD_HREF } from './kit/navLinks';

function Wordmark() {
  return (
    <Box
      component={RouterLink}
      to="/rankings"
      aria-label="Endzone Empire home"
      sx={{
        fontWeight: 800,
        fontSize: '1.25rem',
        textDecoration: 'none',
        backgroundImage: 'var(--gradient-brand)',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        whiteSpace: 'nowrap',
      }}
    >
      Endzone Empire
    </Box>
  );
}

function ThemeToggle() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      <IconButton onClick={toggleMode} aria-label="Toggle color theme" color="inherit">
        {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Tooltip>
  );
}

const navLinkSx = ({ isActive }) => ({
  textDecoration: 'none',
  fontWeight: 600,
  padding: '6px 4px',
  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
});

/**
 * The public header: gradient wordmark, slim primary nav, theme toggle, and the
 * ghost "Log In" / filled "Register" auth CTAs (plain <a> — they cross into the
 * hash app). Collapses to a hamburger Drawer under md.
 *
 * A visitor with a session on this device gets "My Dashboard" instead. The
 * public tree can't read auth state, so this is the localStorage hint, not a
 * real check — a stale hint just lands them on the login screen.
 */
function PublicHeader() {
  const [open, setOpen] = useState(false);
  const loggedIn = hasSessionHint();

  return (
    <AppBar
      position="sticky"
      color="default"
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        borderBottom: '1px solid var(--border-subtle)',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ gap: 2 }}>
          <Wordmark />

          {/* Desktop nav */}
          <Stack direction="row" spacing={2.5} component="nav" aria-label="Primary" sx={{ ml: 3, display: { xs: 'none', md: 'flex' } }}>
            {PUBLIC_NAV_LINKS.map((link) => (
              <NavLink key={link.to + link.label} to={link.to} style={navLinkSx}>
                {link.label}
              </NavLink>
            ))}
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center" sx={{ display: { xs: 'none', md: 'flex' } }}>
            <ThemeToggle />
            {loggedIn ? (
              <Button component="a" href={DASHBOARD_HREF} variant="contained">My Dashboard</Button>
            ) : (
              <>
                <Button component="a" href={LOGIN_HREF} variant="text" color="inherit">Log In</Button>
                <Button component="a" href={REGISTER_HREF} variant="contained">Register</Button>
              </>
            )}
          </Stack>

          {/* Mobile controls */}
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center' }}>
            <ThemeToggle />
            <IconButton edge="end" aria-label="Open navigation menu" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </Container>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: 260 }} role="presentation">
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2 }}>
            <Wordmark />
            <IconButton aria-label="Close navigation menu" onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <Divider />
          <List>
            {PUBLIC_NAV_LINKS.map((link) => (
              <ListItem key={link.to + link.label} disablePadding>
                <ListItemButton component={NavLink} to={link.to} onClick={() => setOpen(false)}>
                  <ListItemText primary={link.label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          <Divider />
          <Stack spacing={1} sx={{ p: 2 }}>
            {loggedIn ? (
              <Button component="a" href={DASHBOARD_HREF} variant="contained" fullWidth>My Dashboard</Button>
            ) : (
              <>
                <Button component="a" href={LOGIN_HREF} variant="outlined" fullWidth>Log In</Button>
                <Button component="a" href={REGISTER_HREF} variant="contained" fullWidth>Register</Button>
              </>
            )}
          </Stack>
        </Box>
      </Drawer>
    </AppBar>
  );
}

export default PublicHeader;
