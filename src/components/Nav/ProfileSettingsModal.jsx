import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Select, MenuItem, InputLabel, TextField, Typography, Divider, Box,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import TeamAvatarUploader from '../common/TeamAvatarUploader';

// Home for account-level settings, reachable from the Nav avatar menu.
// Team renaming and avatar management live here now (moved off the main
// dashboard so "My Leagues" stays focused on leagues, not account admin).
// Other account preferences — password, notification defaults — will land
// in this same dialog.
function ProfileSettingsModal({ open, onClose }) {
  const notify = useSnackbar();
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  // Staged avatar change from the (deferred) uploader: { file } | { remove: true }
  // | null. Committed alongside the name on submit so a single button saves both.
  const [pendingAvatar, setPendingAvatar] = useState(null);
  // Bumped after a successful save to remount the uploader and clear its preview.
  const [uploaderKey, setUploaderKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // Synchronous in-flight latch: state updates don't re-render between two fast
  // clicks, so a state-only guard lets a double-click through. This does not.
  const savingRef = useRef(false);

  const selectedLeague = leagues.find((l) => l.id === leagueId);
  const currentName = selectedLeague?.my_team_name || '';
  const nameChanged = !!newTeamName.trim() && newTeamName.trim() !== currentName;
  const avatarChanged = pendingAvatar != null;

  useEffect(() => {
    if (!open) return;
    apiClient
      .get('/api/league')
      .then((response) => setLeagues(response.data))
      .catch(() => setLeagues([]));
  }, [open]);

  // Clear any staged avatar when switching leagues — it belongs to a team.
  const handleLeagueChange = (event) => {
    setLeagueId(event.target.value);
    setPendingAvatar(null);
    setUploaderKey((k) => k + 1);
  };

  const handleClose = () => {
    setLeagueId('');
    setNewTeamName('');
    setPendingAvatar(null);
    onClose();
  };

  const handleSave = async () => {
    // savingRef is the real guard (see above); `saving` only drives disabled UI.
    if (!selectedLeague || savingRef.current || (!nameChanged && !avatarChanged)) return;
    savingRef.current = true;
    setSaving(true);

    const teamId = selectedLeague.my_team_id;
    const wantAvatar = avatarChanged;
    const wantName = nameChanged;
    const nextName = newTeamName.trim();
    let avatarOk = false;
    let avatarErr = null;
    let nameOk = false;
    let nameErr = null;

    try {
      // Run the two saves independently so one failing can't roll back or hide
      // the other — each is already persisted server-side on success.
      if (wantAvatar) {
        try {
          let team;
          if (pendingAvatar.remove) {
            ({ data: team } = await apiClient.delete(`/api/team/${teamId}/avatar`));
          } else {
            const formData = new FormData();
            formData.append('avatar', pendingAvatar.file);
            ({ data: team } = await apiClient.post(`/api/team/${teamId}/avatar`, formData));
          }
          avatarOk = true;
          // Reflect immediately so other mounted views see the new avatar
          // without waiting on a refetch.
          setLeagues((prev) => prev.map((l) => (
            l.my_team_id === teamId
              ? { ...l, my_team_avatar_url: team?.avatar_url ?? null, my_team_avatar_static_url: team?.avatar_static_url ?? null }
              : l
          )));
          publishTeamProfileUpdate({
            leagueId: selectedLeague.id,
            teamId,
            avatarUrl: team?.avatar_url ?? null,
            avatarStaticUrl: team?.avatar_static_url ?? null,
          });
          setPendingAvatar(null);
          setUploaderKey((k) => k + 1);
        } catch (err) {
          avatarErr = err.response?.data?.error || err.message;
        }
      }

      if (wantName) {
        try {
          const { data: team } = await apiClient.put(`/api/team/${teamId}`, { name: nextName });
          nameOk = true;
          const savedName = team?.name || nextName;
          setLeagues((prev) => prev.map((l) => (
            l.my_team_id === teamId ? { ...l, my_team_name: savedName } : l
          )));
          publishTeamProfileUpdate({ leagueId: selectedLeague.id, teamId, name: savedName });
          setNewTeamName('');
        } catch (err) {
          nameErr = err.response?.data?.error || err.message;
        }
      }

      const anyFailed = (wantAvatar && !avatarOk) || (wantName && !nameOk);
      if (!anyFailed) {
        notify(wantName && !wantAvatar ? 'Team renamed!' : wantAvatar && !wantName ? 'Avatar updated!' : 'Changes saved!');
        handleClose();
        return;
      }
      // Partial (or total) failure: spell out which part saved and which didn't,
      // and leave the dialog open so the failed part can be retried.
      const parts = [];
      if (wantAvatar) parts.push(avatarOk ? 'avatar saved' : `avatar save failed (${avatarErr})`);
      if (wantName) parts.push(nameOk ? 'name saved' : `rename failed (${nameErr})`);
      notify(parts.join('; '), { severity: 'error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Profile Settings</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, fontWeight: 700 }}>
          Team name &amp; avatar
        </Typography>
        <InputLabel id="profile-rename-league-label">League</InputLabel>
        <Select
          labelId="profile-rename-league-label"
          fullWidth
          size="small"
          value={leagueId}
          onChange={handleLeagueChange}
        >
          {leagues.map((league) => (
            <MenuItem key={league.id} value={league.id}>
              {league.name} ({league.my_team_name})
            </MenuItem>
          ))}
        </Select>
        <TextField
          margin="dense"
          label="New Team Name"
          fullWidth
          value={newTeamName}
          onChange={(event) => setNewTeamName(event.target.value)}
        />

        {selectedLeague && (
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <TeamAvatarUploader
              key={uploaderKey}
              teamId={selectedLeague.my_team_id}
              teamName={selectedLeague.my_team_name}
              avatarUrl={selectedLeague.my_team_avatar_url}
              avatarStaticUrl={selectedLeague.my_team_avatar_static_url}
              onStageChange={setPendingAvatar}
            />
            <Typography variant="body2" color="text.secondary">
              Team avatar for {selectedLeague.my_team_name}
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" color="text.secondary">
          More account preferences — password and notification defaults —
          are coming soon to this panel.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={!leagueId || saving || (!nameChanged && !avatarChanged)}>
          {nameChanged && !avatarChanged ? 'Rename' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ProfileSettingsModal;
