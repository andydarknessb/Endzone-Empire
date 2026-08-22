import React, { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  AppBar,
  Toolbar,
  Box,
  Stack,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
  Typography,
  Avatar,
  Link,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import NotificationBell from '../NotificationBell/NotificationBell';
import GlobalPlayerSearch from '../GlobalPlayerSearch/GlobalPlayerSearch';
import ProfileSettingsModal from './ProfileSettingsModal';
import { useThemeMode } from '../../theme/AppThemeProvider';
import { touchTargetSx } from '../../lib/a11y';

// Primary destinations shown inline on desktop and in the drawer on mobile.
// "Notification Settings" and "Log Out" intentionally live in the profile
// menu / drawer footer, not this top-level row.
const MAIN_LINKS = [
  { label: 'Home', to: '/user' },
  { label: 'League', to: '/league' },
  { label: 'Discover', to: '/discover' },
  { label: 'Players', to: '/player' },
  { label: 'Roster', to: '/team' },
  { label: 'Mock Draft', to: '/draft-sim' },
];

function Nav() {
  const user = useSelector((store) => store.user);
  const dispatch = useDispatch();
  const { mode, toggleMode } = useThemeMode();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileAnchor, setProfileAnchor] = useState(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);

  const loggedIn = !!user.id;
  const links = MAIN_LINKS;
  const isAdmin = user.isPlatformAdmin === true;

  const isActive = (to) => location.pathname === to || location.pathname.startsWith(`${to}/`);

  const closeAll = () => {
    setProfileAnchor(null);
    setDrawerOpen(false);
  };

  const handleLogout = () => {
    closeAll();
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
      <IconButton aria-label="Toggle theme" onClick={toggleMode} size="small" sx={touchTargetSx}>
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
      <Toolbar sx={{ gap: 1 }}>
        {loggedIn && (
          <IconButton
            aria-label="open navigation menu"
            edge="start"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, color: 'var(--text-muted)', ...touchTargetSx }}
          >
            <MenuIcon />
          </IconButton>
        )}

        <Link
          component={RouterLink}
          to="/home"
          underline="none"
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
              }}
            >
              Endzone Empire
            </Typography>
          </Stack>
        </Link>

        {/* Desktop inline links */}
        <Box
          component="nav"
          aria-label="Primary navigation"
          sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'stretch', flexGrow: 1 }}
        >
          {loggedIn &&
            links.map((l) => (
              <Link key={l.to} component={RouterLink} to={l.to} underline="none" sx={linkSx(l.to)}>
                {l.label}
              </Link>
            ))}
        </Box>

        {/* Pushes the right cluster to the edge on mobile (no desktop links to grow) */}
        <Box sx={{ flexGrow: 1, display: { xs: 'block', md: 'none' } }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {!loggedIn && (
            <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} sx={{ mr: { xs: 0, sm: 1 } }}>
              <Button
                component={RouterLink}
                to="/login"
                size="small"
                sx={{
                  minWidth: 0,
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
                sx={{ minWidth: 0, px: { xs: 1.25, sm: 2 } }}
              >
                Register
              </Button>
            </Stack>
          )}

          {loggedIn && (
            <Box sx={{ display: { xs: 'none', md: 'block' }, mr: 1 }}>
              <GlobalPlayerSearch enableShortcut />
            </Box>
          )}
          {loggedIn && <NotificationBell />}
          {themeToggle}

          {loggedIn && (
            <>
              <Tooltip title="Account">
                <IconButton
                  aria-label="account menu"
                  onClick={(e) => setProfileAnchor(e.currentTarget)}
                  size="small"
                  sx={touchTargetSx}
                >
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 16 }}>
                    {(user.username || '?').charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={profileAnchor}
                open={Boolean(profileAnchor)}
                onClose={() => setProfileAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem disabled sx={{ opacity: '1 !important', fontWeight: 600 }}>
                  {user.username || 'Signed in'}
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setProfileAnchor(null);
                    setProfileSettingsOpen(true);
                  }}
                >
                  Profile Settings
                </MenuItem>
                <MenuItem component={RouterLink} to="/settings/notifications" onClick={() => setProfileAnchor(null)}>
                  Notification Settings
                </MenuItem>
                {isAdmin && (
                  <MenuItem component={RouterLink} to="/admin" onClick={() => setProfileAnchor(null)}>
                    <ListItemIcon>
                      <AdminPanelSettingsIcon fontSize="small" />
                    </ListItemIcon>
                    Admin
                  </MenuItem>
                )}
                <MenuItem onClick={handleLogout}>Log Out</MenuItem>
              </Menu>
              <ProfileSettingsModal
                open={profileSettingsOpen}
                onClose={() => setProfileSettingsOpen(false)}
              />
            </>
          )}
        </Box>
      </Toolbar>

      {/* Mobile navigation drawer */}
      <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 260 }} role="presentation">
          <Typography variant="h6" component="div" sx={{ p: 2, color: 'var(--accent)', fontWeight: 700 }}>
            Endzone Empire
          </Typography>
          <Divider />
          {loggedIn && (
            <Box sx={{ p: 2 }} onClick={(e) => e.stopPropagation()}>
              <GlobalPlayerSearch inDrawer />
            </Box>
          )}
          {loggedIn ? (
            <>
              <Box component="nav" aria-label="Primary navigation">
                <List>
                  {links.map((l) => (
                    <ListItemButton
                      key={l.to}
                      component={RouterLink}
                      to={l.to}
                      selected={isActive(l.to)}
                      onClick={() => setDrawerOpen(false)}
                      sx={{ minHeight: 44 }}
                    >
                      <ListItemText primary={l.label} />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
              <Divider />
              <List>
                <ListItemButton
                  component={RouterLink}
                  to="/settings/notifications"
                  onClick={() => setDrawerOpen(false)}
                  sx={{ minHeight: 44 }}
                >
                  <ListItemText primary="Notification Settings" />
                </ListItemButton>
                {isAdmin && (
                  <ListItemButton
                    component={RouterLink}
                    to="/admin"
                    onClick={() => setDrawerOpen(false)}
                    sx={{ minHeight: 44 }}
                  >
                    <ListItemIcon>
                      <AdminPanelSettingsIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary="Admin" />
                  </ListItemButton>
                )}
                <ListItemButton onClick={handleLogout} sx={{ minHeight: 44 }}>
                  <ListItemText primary="Log Out" />
                </ListItemButton>
              </List>
            </>
          ) : (
            <List>
              <ListItemButton component={RouterLink} to="/login" onClick={() => setDrawerOpen(false)}>
                <ListItemText primary="Log In" />
              </ListItemButton>
              <ListItemButton component={RouterLink} to="/registration" onClick={() => setDrawerOpen(false)}>
                <ListItemText primary="Register" />
              </ListItemButton>
            </List>
          )}
        </Box>
      </Drawer>
    </AppBar>
  );
}

export default Nav;
