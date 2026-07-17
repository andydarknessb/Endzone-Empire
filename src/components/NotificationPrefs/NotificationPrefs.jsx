import React, { useState, useEffect } from 'react';
import { Container, Typography, Paper, Box, FormControlLabel, Switch, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';
import { urlBase64ToUint8Array } from '../../utils/push';

const PREF_FIELDS = [
  { key: 'lineupReminder', label: 'Lineup reminders' },
  { key: 'waiverResults', label: 'Waiver results' },
  { key: 'weeklyRecap', label: 'Weekly recap' },
  { key: 'tradeOffers', label: 'Trade offers' },
  { key: 'closeMatchups', label: 'Close matchup alerts' },
  { key: 'touchdownCelebrations', label: 'Touchdown celebrations' },
];

// Feature-detected each render (cheap) rather than hoisted to module scope,
// so tests can stub navigator.serviceWorker / window.PushManager per case.
function isPushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window;
}

function NotificationPrefs() {
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  const pushSupported = isPushSupported();
  const [pushPublicKey, setPushPublicKey] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    fetchPrefs();
    if (pushSupported) {
      fetchPushState();
    }
  }, []);

  const fetchPushState = async () => {
    try {
      const res = await apiClient.get('/api/notifications/push-public-key');
      const key = (res.data && res.data.publicKey) || null;
      setPushPublicKey(key);
      if (key) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPushEnabled(Boolean(subscription));
      }
    } catch (err) {
      setPushPublicKey(null);
    }
  };

  const handlePushToggle = async () => {
    setPushError(null);
    setPushBusy(true);

    if (!pushEnabled) {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Notification permission was not granted');
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
        });
        const subscriptionJson = typeof subscription.toJSON === 'function'
          ? subscription.toJSON()
          : subscription;
        await apiClient.post('/api/notifications/push-subscribe', { subscription: subscriptionJson });
        setPushEnabled(true);
      } catch (err) {
        setPushEnabled(false);
        setPushError(err.response?.data?.error || err.message || 'Failed to enable push notifications');
      } finally {
        setPushBusy(false);
      }
    } else {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const { endpoint } = subscription;
          await subscription.unsubscribe();
          await apiClient.delete('/api/notifications/push-subscribe', { data: { endpoint } });
        }
        setPushEnabled(false);
      } catch (err) {
        setPushEnabled(true);
        setPushError(err.response?.data?.error || err.message || 'Failed to disable push notifications');
      } finally {
        setPushBusy(false);
      }
    }
  };

  const fetchPrefs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/api/notifications/prefs');
      setPrefs(res.data || {});
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (key) => {
    const previous = Boolean(prefs[key]);
    const next = !previous;
    setError(null);
    setPrefs((prev) => ({ ...prev, [key]: next }));
    setSavingKey(key);
    try {
      const res = await apiClient.put('/api/notifications/prefs', { prefs: { [key]: next } });
      setPrefs(res.data || { ...prefs, [key]: next });
    } catch (err) {
      setPrefs((prev) => ({ ...prev, [key]: previous }));
      setError(err.response?.data?.error || err.message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }} data-testid="page-loading">
        <Typography variant="h4" sx={{ mb: 3 }}>
          Notification Settings
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Notification Settings
      </Typography>

      {pushSupported && pushPublicKey && (
        <Paper sx={{ p: 2, mb: 2 }}>
          {pushError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {pushError}
            </Alert>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={pushEnabled}
                onChange={handlePushToggle}
                disabled={pushBusy}
              />
            }
            label="Push notifications on this device"
          />
        </Paper>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {PREF_FIELDS.map((field) => (
            <FormControlLabel
              key={field.key}
              control={
                <Switch
                  checked={Boolean(prefs[field.key])}
                  onChange={() => handleToggle(field.key)}
                  disabled={savingKey === field.key}
                />
              }
              label={field.label}
            />
          ))}
        </Box>
      </Paper>
    </Container>
  );
}

export default NotificationPrefs;
