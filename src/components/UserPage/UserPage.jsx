import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@material-ui/core';
import LogOutButton from '../LogOutButton/LogOutButton';

function UserPage() {
  const dispatch = useDispatch();
  const user = useSelector((store) => store.user);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [openJoinDialog, setOpenJoinDialog] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [leagueDescription, setLeagueDescription] = useState("");

  useEffect(() => {
    // Fetch user's leagues
    dispatch({ type: 'FETCH_USER_LEAGUES', payload: user.id });
  }, [dispatch, user.id]);

  // List of user's leagues
  const leagues = useSelector((store) => store.leagues);

  // Functions to handle create dialog
  const handleOpenCreateDialog = () => {
    setOpenCreateDialog(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  const handleCreateLeague = () => {
    // Logic to create a league goes here
    // After creating the league, close the dialog
    handleCloseCreateDialog();
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
  };

  const handleJoinLeague = () => {
    // Logic to join a league goes here
    // After joining the league, close the dialog
    handleCloseJoinDialog();
  };

  return (
    <div>
      <Typography variant="h4">Endzone Empire</Typography>
      <Typography variant="h6">Welcome, {user.username}! Your ID is: {user.id}</Typography>
      <Typography variant="h6">Your Leagues:</Typography>
      {leagues && leagues.map((league) => (
        <div key={league.id}>
          <Typography variant="body1">{league.name}</Typography>
          <Typography variant="body2">{league.description}</Typography>
        </div>
      ))}
      <Button variant="contained" color="primary" onClick={handleOpenCreateDialog}>
        Create League
      </Button>
      <Dialog open={openCreateDialog} onClose={handleCloseCreateDialog}>
        <DialogTitle>Create a New League</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="League Name" fullWidth onChange={(event) => setLeagueName(event.target.value)} />
          <TextField margin="dense" label="League Description" fullWidth onChange={(event) => setLeagueDescription(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog} color="primary">
            Cancel
          </Button>
          <Button onClick={handleCreateLeague} color="primary">
            Create
          </Button>
        </DialogActions>
      </Dialog>
      <Button variant="contained" color="primary" onClick={handleOpenJoinDialog}>
        Join League
      </Button>
      <Dialog open={openJoinDialog} onClose={handleCloseJoinDialog}>
        <DialogTitle>Join an Existing League</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="League Name" fullWidth onChange={(event) => setLeagueName(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseJoinDialog} color="primary">
            Cancel
          </Button>
          <Button onClick={handleJoinLeague} color="primary">
            Join
          </Button>
        </DialogActions>
      </Dialog>
      <LogOutButton />
    </div>
  );
}

export default UserPage;
