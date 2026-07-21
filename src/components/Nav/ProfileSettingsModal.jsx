import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Select, MenuItem, InputLabel, TextField, Typography, Divider, Box,
} from '@mui/material';
import apiClient from '../../api/apiClient';
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
    if (!selectedLeague || saving || (!nameChanged && !avatarChanged)) return;
    setSaving(true);
    try {
      if (avatarChanged) {
        if (pendingAvatar.remove) {
          await apiClient.delete(`/api/team/${selectedLeague.my_team_id}/avatar`);
        } else {
          const formData = new FormData();
          formData.append('avatar', pendingAvatar.file);
          await apiClient.post(`/api/team/${selectedLeague.my_team_id}/avatar`, formData);
        }
      }
      if (nameChanged) {
        await apiClient.put(`/api/team/${selectedLeague.my_team_id}`, { name: newTeamName });
      }
      notify(nameChanged && !avatarChanged ? 'Team renamed!' : 'Changes saved!');
      handleClose();
    } catch (err) {
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    } finally {
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
