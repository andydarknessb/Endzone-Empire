import React, { useState, useEffect } from 'react';
import { Container, Typography, Paper, Box, FormControlLabel, Switch, Alert } from '@mui/material';
import apiClient from '../../api/apiClient';

const PREF_FIELDS = [
  { key: 'lineupReminder', label: 'Lineup reminders' },
  { key: 'waiverResults', label: 'Waiver results' },
  { key: 'weeklyRecap', label: 'Weekly recap' },
  { key: 'tradeOffers', label: 'Trade offers' },
];

function NotificationPrefs() {
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    fetchPrefs();
  }, []);

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
