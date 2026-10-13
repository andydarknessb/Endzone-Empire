import React, { Suspense } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';

const GlobalPlayerSearch = lazyWithReload(() => import('../GlobalPlayerSearch/GlobalPlayerSearch'));

// The mobile navigation drawer. Only a signed-in user can open it, so Nav loads
// it as its own chunk instead of shipping it in the landing page's bundle.
function NavDrawer({
  open,
  onClose,
  loggedIn,
  isAdmin,
  links,
  isActive,
  onLogout,
  focusSearch,
}) {
  return (
    <Drawer anchor="left" open={open} onClose={onClose}>
      {/* role="presentation": this Box is layout only. Its "Navigation
          menu" nav landmark below (#322) is distinctly named from the top
          bar's, so tests reach it by that role+name now instead of a
          testid seam. */}
      <Box sx={{ width: 260 }} role="presentation">
        <Typography variant="h6" component="div" sx={{ p: 2, color: 'var(--accent)', fontWeight: 700 }}>
          Endzone Empire
        </Typography>
        <Divider />
        {loggedIn && (
          <Box sx={{ p: 2 }} onClick={(e) => e.stopPropagation()}>
            {/* autoFocus only when the drawer was opened by "/" (#934); a
                hamburger open leaves focusSearch false so it does not
                steal focus. The drawer is a temporary MUI Drawer with no
                keepMounted, so this instance mounts fresh on each open and
                autoFocus fires against the current intent. onSelect closes
                the drawer (#1362): nothing else does once a search hit
                navigates - not even to the page already open, since the
                pathname staying put means a location effect would not fire. */}
            <Suspense fallback={null}>
              <GlobalPlayerSearch inDrawer autoFocus={focusSearch} onSelect={onClose} />
            </Suspense>
          </Box>
        )}
        {loggedIn ? (
          <>
            {/* Named "Navigation menu" (not "Primary navigation") so the
                drawer's landmark agrees with the opener button above,
                labelled "open navigation menu" - the button a user
                activates and the landmark they land in speak the same
                words. Distinct from the top bar's "Primary navigation"
                landmark so a landmark listing shows two entries, not one
                name twice (#322). */}
            <Box component="nav" aria-label="Navigation menu">
              <List>
                {links.map((l) => (
                  <ListItemButton
                    key={l.to}
                    component={RouterLink}
                    to={l.to}
                    selected={isActive(l.to)}
                    onClick={onClose}
                    sx={MIN_TOUCH_TARGET_SX}
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
                onClick={onClose}
                sx={MIN_TOUCH_TARGET_SX}
              >
                <ListItemText primary="Notification Settings" />
              </ListItemButton>
              {isAdmin && (
                <ListItemButton
                  component={RouterLink}
                  to="/admin"
                  onClick={onClose}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <ListItemIcon>
                    <AdminPanelSettingsIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Admin" />
                </ListItemButton>
              )}
              <ListItemButton onClick={onLogout} sx={MIN_TOUCH_TARGET_SX}>
                <ListItemText primary="Log Out" />
              </ListItemButton>
            </List>
          </>
        ) : (
          <List>
            <ListItemButton component={RouterLink} to="/login" onClick={onClose}>
              <ListItemText primary="Log In" />
            </ListItemButton>
            <ListItemButton component={RouterLink} to="/registration" onClick={onClose}>
              <ListItemText primary="Register" />
            </ListItemButton>
          </List>
        )}
      </Box>
    </Drawer>
  );
}

export default NavDrawer;
