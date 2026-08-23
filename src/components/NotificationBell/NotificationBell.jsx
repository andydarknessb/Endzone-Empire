import React, { useState, useEffect, useCallback } from 'react';
import {
  IconButton,
  Badge,
  Menu,
  MenuItem,
  Typography,
  Box,
  Button,
  Divider,
  ListSubheader,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import apiClient from '../../api/apiClient';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

const POLL_INTERVAL_MS = 60000;

function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [anchorEl, setAnchorEl] = useState(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/notifications');
      setNotifications(res.data.notifications || []);
      setUnread(res.data.unread || 0);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await apiClient.put('/api/notifications/read');
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpen = (event) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  const shown = notifications.slice(0, 20);
  // Group by league only when the user's notifications span more than one league.
  const distinctLeagues = new Set(shown.map((n) => n.league_name || 'General'));
  const grouped = distinctLeagues.size > 1;

  const groups = [];
  if (grouped) {
    const byLeague = new Map();
    shown.forEach((n) => {
      const key = n.league_name || 'General';
      if (!byLeague.has(key)) {
        byLeague.set(key, []);
        groups.push([key, byLeague.get(key)]);
      }
      byLeague.get(key).push(n);
    });
  }

  const renderItem = (notification) => (
    <MenuItem key={notification.id} onClick={handleClose}>
      <Box>
        <Typography sx={{ fontWeight: notification.read ? 400 : 600 }}>
          {notification.message}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {new Date(notification.created_at).toLocaleString()}
        </Typography>
      </Box>
    </MenuItem>
  );

  return (
    <>
      <IconButton color="inherit" aria-label="notifications" onClick={handleOpen} sx={MIN_TOUCH_TARGET_SX}>
        <Badge badgeContent={unread} color="error">
          <NotificationsActiveIcon />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 0.5, gap: 2 }}
        >
          <Typography variant="subtitle2">Notifications</Typography>
          <Button size="small" onClick={markAllRead} disabled={unread === 0}>
            Mark all read
          </Button>
        </Box>
        <Divider />
        {shown.length === 0 && <MenuItem disabled>No notifications</MenuItem>}
        {!grouped && shown.map(renderItem)}
        {grouped &&
          groups.map(([league, items]) => [
            <ListSubheader key={`sub-${league}`} disableSticky sx={{ lineHeight: '32px' }}>
              {league}
            </ListSubheader>,
            ...items.map(renderItem),
          ])}
      </Menu>
    </>
  );
}

export default NotificationBell;
