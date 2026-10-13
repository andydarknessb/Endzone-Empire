import React, { Suspense, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  Divider,
  Tooltip,
  Avatar,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';

const ProfileSettingsModal = lazyWithReload(() => import('./ProfileSettingsModal'));

// The signed-in account button, its menu and the Profile Settings dialog. Split
// out of Nav so the anonymous landing page does not download any of it.
function NavAccountMenu({ user, isAdmin, onLogout }) {
  const [profileAnchor, setProfileAnchor] = useState(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);

  return (
    <>
      <Tooltip title="Account">
        <IconButton
          aria-label="account menu"
          onClick={(e) => setProfileAnchor(e.currentTarget)}
          size="small"
          sx={MIN_TOUCH_TARGET_SX}
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
        <MenuItem
          onClick={() => {
            setProfileAnchor(null);
            onLogout();
          }}
        >
          Log Out
        </MenuItem>
      </Menu>
      <Suspense fallback={null}>
        <ProfileSettingsModal
          open={profileSettingsOpen}
          onClose={() => setProfileSettingsOpen(false)}
        />
      </Suspense>
    </>
  );
}

export default NavAccountMenu;
