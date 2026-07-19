import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Select, MenuItem, InputLabel, TextField, Typography, Divider,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// Home for account-level settings, reachable from the Nav avatar menu.
// Team renaming lives here now (moved off the main dashboard so "My Leagues"
// stays focused on leagues, not account admin). Other account preferences —
// avatar, password, notification defaults — will land in this same dialog.
function ProfileSettingsModal({ open, onClose }) {
  const notify = useSnackbar();
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  useEffect(() => {
    if (!open) return;
    apiClient
      .get('/api/league')
      .then((response) => setLeagues(response.data))
      .catch(() => setLeagues([]));
  }, [open]);

  const handleClose = () => {
    setLeagueId('');
    setNewTeamName('');
    onClose();
  };

  const handleRename = async () => {
    try {
      const league = leagues.find((l) => l.id === leagueId);
      if (!league) return;
      await apiClient.put(`/api/team/${league.my_team_id}`, { name: newTeamName });
      notify('Team renamed!');
      handleClose();
    } catch (err) {
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Profile Settings</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, fontWeight: 700 }}>
          Rename a team
        </Typography>
        <InputLabel id="profile-rename-league-label">League</InputLabel>
        <Select
          labelId="profile-rename-league-label"
          fullWidth
          size="small"
          value={leagueId}
          onChange={(event) => setLeagueId(event.target.value)}
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

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" color="text.secondary">
          More account preferences — avatar, password, and notification
          defaults — are coming soon to this panel.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleRename} disabled={!leagueId || !newTeamName.trim()}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ProfileSettingsModal;
