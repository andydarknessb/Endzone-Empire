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
    if ((league?.draft_status === 'pending' || league?.draft_status === 'active') && !settingsSaving) {
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

  const handleSetClock = async (pickTimeSeconds) => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/clock`, { pickTimeSeconds });
      clearLeagueCache(leagueId);
      notify('Clock updated for the next pick');
      return true;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
      return false;
    }
  };

  // Commissioner correction (#439): the safe, reasoned replacement for the old
  // bare "undo last pick". Sends the confirmed pick number (so the server can
  // reject a stale request that would race a manager or autopick) and the
  // reason; the server pauses the draft, reverses only that pick and broadcasts
  // a fresh draft:state, so nothing is hand-updated here.
  const handleCorrectPick = async ({ pickNumber, reason }) => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/correct-pick`, { pickNumber, reason });
      clearLeagueCache(leagueId);
      notify('Latest pick corrected; draft paused');
      return true;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
      return false;
    }
  };

  const handleResetDraft = async () => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/reset`, {});
      clearLeagueCache(leagueId);
      notify('Draft reset; schedule cleared');
      return true;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
      return false;
    }
  };

  const handleToggleReady = async (ready) => {
    try {
      onError?.(null);
      await apiClient.post(`/api/draft/league/${leagueId}/ready`, { ready });
      notify(ready ? 'You are marked ready' : 'You are marked not ready');
      return true;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
      return false;
    }
  };

  const handleGetShareLink = async () => {
    try {
      onError?.(null);
      const response = await apiClient.post(`/api/draft/league/${leagueId}/share-token`, {});
      const url = response.data?.url || null;
      if (!url) throw new Error('presenter link was not returned');
      try {
        await navigator.clipboard.writeText(url);
        notify('Presenter link copied');
      } catch (clipboardError) {
        notify('Presenter link ready');
      }
      return url;
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      onError?.(message);
      notify(message, { severity: 'error' });
      return null;
    }
  };

  const handleSaveDraftSettings = async (e) => {
    e.preventDefault();
    try {
      onError?.(null);
      setSettingsSaving(true);
      if (league?.draft_status === 'active') {
        await apiClient.post(`/api/draft/league/${leagueId}/clock`, { pickTimeSeconds: Number(pickTimeSeconds) });
        notify('Clock updated for the next pick');
      } else {
        await apiClient.put(`/api/league/${leagueId}`, {
          pickTimeSeconds: Number(pickTimeSeconds),
          autodraftDelaySeconds: Number(autodraftDelaySeconds),
        });
        notify('Draft settings saved');
      }
      clearLeagueCache(leagueId);
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
    handleSetClock,
    handleCorrectPick,
    handleResetDraft,
    handleToggleReady,
    handleGetShareLink,
    handleSaveDraftSettings,
  };
}
