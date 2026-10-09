import React, { useState, useEffect } from 'react';
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
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { markAllNotificationsRead, useNotifications } from '../../hooks/useNotifications';

const POLL_INTERVAL_MS = 60000;

function NotificationBell() {
  const [anchorEl, setAnchorEl] = useState(null);

  // One shared read with the Home activity card (ADR 0004, ADR 0059's #2097
  // amendment): the key is the dedup, and the poll below is an invalidating
  // refetch, so the card reloads with the bell instead of requesting itself.
  const { notifications, unread, error, refetch } = useNotifications();

  useEffect(() => {
    if (error) console.error(error);
  }, [error]);

  useEffect(() => {
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  const markAllRead = async () => {
    try {
      // Writes through, so the activity card sees the read state without a GET.
      await markAllNotificationsRead();
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
        {/* The badge itself is decoration on a button that already carries the
            accessible name: it has no role and no name of its own, so the
            test-only data-testid is the seam that reaches it. */}
        <Badge
          badgeContent={unread}
          color="error"
          slotProps={{ badge: { 'data-testid': 'notification-unread-badge' } }}
        >
          <NotificationsActiveIcon />
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 0.5, gap: 2 }}
        >
          <Typography variant="subtitle2" component="h3">Notifications</Typography>
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
