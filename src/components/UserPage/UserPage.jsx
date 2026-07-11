import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import {
  Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, InputLabel, Alert,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import './UserPage.css';

function UserPage() {
  const user = useSelector((store) => store.user);

  const [myLeagues, setMyLeagues] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Create League dialog
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [numTeams, setNumTeams] = useState(2);

  // Join League dialog — leagues are private, so joining is always by invite code
  const [openJoinDialog, setOpenJoinDialog] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  // Rename Team dialog — a team can't exist outside a league, so renaming
  // (not standalone creation) is the real operation here
  const [openRenameTeamDialog, setOpenRenameTeamDialog] = useState(false);
  const [renameLeagueId, setRenameLeagueId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  const fetchMyLeagues = async () => {
    try {
      const response = await apiClient.get('/api/league');
      setMyLeagues(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    fetchMyLeagues();
  }, []);

  // Functions to handle create dialog
  const handleOpenCreateDialog = () => {
    setOpenCreateDialog(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  const handleCreateLeague = async () => {
    setError(null);
    try {
      await apiClient.post('/api/league', {
        name: leagueName,
        teamName: teamName || undefined,
        maxTeams: numTeams,
      });
      setNotice('League created!');
      setLeagueName('');
      setTeamName('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      handleCloseCreateDialog();
    }
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
  };

  const handleJoinLeague = async () => {
    setError(null);
    try {
      await apiClient.post('/api/league/join', { inviteCode: inviteCode.trim() });
      setNotice('Joined league!');
      setInviteCode('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      handleCloseJoinDialog();
    }
  };

  // Functions to handle rename team dialog
  const handleOpenRenameTeamDialog = () => {
    setOpenRenameTeamDialog(true);
  };

  const handleCloseRenameTeamDialog = () => {
    setOpenRenameTeamDialog(false);
  };

  const handleRenameTeam = async () => {
    setError(null);
    try {
      const league = myLeagues.find((l) => l.id === renameLeagueId);
      if (!league) throw new Error('Select a league first');
      await apiClient.put(`/api/team/${league.my_team_id}`, { name: newTeamName });
      setNotice('Team renamed!');
      setNewTeamName('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      handleCloseRenameTeamDialog();
    }
  };

  return (
    <div className="user-page">
    <div className="container">
    <div className="btn">
    <div className="user-page">
    <div className="RegisterForm">
      <Typography variant="h4" className="title">Endzone Empire</Typography>
      <Typography variant="h6" className="welcomeText">Welcome, {user.username}!</Typography>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ my: 1 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ my: 1 }}>{notice}</Alert>}

      <div className="leagueContainer">
        {myLeagues.map((league) => (
          <div key={league.id} className="leagueItem">
            <Typography variant="body1">{league.name}</Typography>
            <Typography variant="body2">Team: {league.my_team_name}</Typography>
          </div>
        ))}
      </div>
      <div className="buttonContainer">
        <Button variant="contained" color="primary" onClick={handleOpenCreateDialog}>
          Create League
        </Button>
        <Button variant="outlined" color="primary" onClick={handleOpenJoinDialog}>
          Join League
        </Button>
        <Button
          variant="outlined"
          color="primary"
          onClick={handleOpenRenameTeamDialog}
          disabled={myLeagues.length === 0}
        >
          Rename Team
        </Button>
      </div>
      <Dialog open={openCreateDialog} onClose={handleCloseCreateDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Create a New League</DialogTitle>
        <DialogContent>
          <TextField className="dialogTextField" autoFocus margin="dense" label="League Name" fullWidth value={leagueName} onChange={(event) => setLeagueName(event.target.value)} />
          <TextField className="dialogTextField" margin="dense" label="Team Name" fullWidth value={teamName} onChange={(event) => setTeamName(event.target.value)} />
          <InputLabel id="numTeams-label"></InputLabel>
          <div style={{display: 'flex', alignItems: 'center', marginTop: '1em'}}>
          <Typography variant="body1" style={{marginRight: '1em', color: '#000', fontWeight: 'bold', fontSize: '1.2em'}}>Teams:</Typography>
        <Select
            labelId="numTeams-label"
            value={numTeams}
            onChange={(event) => setNumTeams(event.target.value)}
            style={{minWidth: 120}}
        >
            {Array.from({length: 19}, (_, i) => i+2).map((number) => (
            <MenuItem key={number} value={number}>{number}</MenuItem>
            ))}
        </Select>
      </div>
          </DialogContent>
          <DialogActions>
          <Button onClick={handleCloseCreateDialog} color="primary">
           Cancel
          </Button>
          <Button onClick={handleCreateLeague} color="primary" disabled={!leagueName.trim()}>
           Create
          </Button>
          </DialogActions>
          </Dialog>
      <Dialog open={openJoinDialog} onClose={handleCloseJoinDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Join an Existing League</DialogTitle>
        <DialogContent>
          <TextField
            className="dialogTextField"
            autoFocus
            margin="dense"
            label="Invite Code"
            fullWidth
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
          />
        </DialogContent>
                <DialogActions>
                  <Button onClick={handleCloseJoinDialog} color="primary">
                    Cancel
                  </Button>
                  <Button onClick={handleJoinLeague} color="primary" disabled={!inviteCode.trim()}>
                    Join
                  </Button>
                </DialogActions>
              </Dialog>
      <Dialog open={openRenameTeamDialog} onClose={handleCloseRenameTeamDialog} className="dialogContainer">
      <DialogTitle className="dialogTitle">Rename Team</DialogTitle>
      <DialogContent>
      <InputLabel id="rename-league-label">League</InputLabel>
      <Select
        labelId="rename-league-label"
        fullWidth
        value={renameLeagueId}
        onChange={(event) => setRenameLeagueId(event.target.value)}
      >
        {myLeagues.map((league) => (
          <MenuItem key={league.id} value={league.id}>
            {league.name} ({league.my_team_name})
          </MenuItem>
        ))}
      </Select>
      <TextField className="dialogTextField" margin="dense" label="New Team Name" fullWidth value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} />
      </DialogContent>
      <DialogActions>
      <Button onClick={handleCloseRenameTeamDialog} color="primary">
      Cancel
    </Button>
    <Button onClick={handleRenameTeam} color="primary" disabled={!renameLeagueId || !newTeamName.trim()}>
                  Rename
                </Button>
              </DialogActions>
            </Dialog>
          </div>
        </div>
      </div>
    </div>

  </div>
  );
}

export default UserPage;
