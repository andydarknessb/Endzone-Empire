import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

/** Commissioner-only draft admin actions: randomize order, pause/resume,
 * per-team autodraft toggle, and the pre-draft settings form (pick clock +
 * autodraft delay). `league` drives the settings form's initial values. */
export default function useDraftAdmin(leagueId, league, { onError } = {}) {
  const notify = useSnackbar();
  const [pickTimeSeconds, setPickTimeSeconds] = useState('');
  const [autodraftDelaySeconds, setAutodraftDelaySeconds] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Pre-fills the form from the league once it's known, without clobbering
  // in-progress edits on later draft:state pushes.
  useEffect(() => {
    if (league?.draft_status === 'pending' && !settingsSaving) {
      setPickTimeSeconds((prev) => (prev === '' ? String(league.pick_time_seconds ?? '') : prev));
      setAutodraftDelaySeconds((prev) => (prev === '' ? String(league.autodraft_delay_seconds ?? '') : prev));
    }
  }, [league?.draft_status, league?.pick_time_seconds, league?.autodraft_delay_seconds, settingsSaving]);

  const handleRandomizeOrder = async () => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/order`, { randomize: true });
      notify('Draft order randomized');
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
    }
  };

  const handleTogglePause = async () => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/pause`, { paused: !league?.draft_paused });
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
    }
  };

  // Server broadcasts a fresh draft:state on success, so there's nothing to
  // hand-update here — the AUTO badge / switch reflect the new state once it arrives.
  const handleToggleAutodraft = async (teamId, enabled) => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/teams/${teamId}/autodraft`, { enabled });
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
    }
  };

  const handleSaveDraftSettings = async (e) => {
    e.preventDefault();
    try {
      onError?.(null);
      setSettingsSaving(true);
      await apiClient.put(`/api/league/${leagueId}`, {
        pickTimeSeconds: Number(pickTimeSeconds),
        autodraftDelaySeconds: Number(autodraftDelaySeconds),
      });
      clearLeagueCache(leagueId);
      notify('Draft settings saved');
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
    } finally {
      setSettingsSaving(false);
    }
  };

  return {
    pickTimeSeconds,
    setPickTimeSeconds,
    autodraftDelaySeconds,
    setAutodraftDelaySeconds,
    settingsSaving,
    handleRandomizeOrder,
    handleTogglePause,
    handleToggleAutodraft,
    handleSaveDraftSettings,
  };
}
