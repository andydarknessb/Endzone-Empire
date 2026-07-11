import React, { useState, useEffect, useCallback } from 'react';
import { IconButton, Badge, Menu, MenuItem, Typography, Box } from '@mui/material';
import apiClient from '../../api/apiClient';

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

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
    if (unread > 0) {
      markAllRead();
    }
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <IconButton color="inherit" aria-label="notifications" onClick={handleOpen}>
        <Badge badgeContent={unread} color="error">
          <span role="img" aria-label="bell">
            🔔
          </span>
        </Badge>
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {notifications.length === 0 && <MenuItem disabled>No notifications</MenuItem>}
        {notifications.slice(0, 10).map((notification) => (
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
        ))}
      </Menu>
    </>
  );
}

export default NotificationBell;
