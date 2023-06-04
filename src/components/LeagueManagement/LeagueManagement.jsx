import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Typography, TextField, Button, makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Dialog, DialogTitle, DialogContent, DialogActions } from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  root: {
    '& > *': {
      margin: theme.spacing(1),
    },
  },
}));

function LeagueManagement() {
  const classes = useStyles();
  const [leagueName, setLeagueName] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [leagueDetails, setLeagueDetails] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState(null);

  useEffect(() => {
    fetchLeagues();
  }, []);

  useEffect(() => {
    if (selectedLeagueId) {
      fetchLeagueDetails(selectedLeagueId);
    }
  }, [selectedLeagueId]);

  const fetchLeagues = async () => {
    const response = await axios.get('/api/league');
    setLeagues(response.data);
  }

  const fetchLeagueDetails = async (id) => {
    const response = await axios.get(`/api/league/${id}/details`);
    setLeagueDetails(response.data);
  }

  const createLeague = async () => {
    await axios.post('/api/league/create', { name: leagueName });
    fetchLeagues();
  }

  const updateLeague = async (id, name) => {
    await axios.put(`/api/league/${id}`, { name });
    fetchLeagues();
  }

  const deleteLeague = async (id) => {
    await axios.delete(`/api/league/${id}`);
    fetchLeagues();
  }
  
  const withdrawFromLeague = async (id) => {
    await axios.delete(`/api/league/${id}/withdraw`);
    fetchLeagues();
  }

  const joinLeague = async (id) => {
    await axios.post(`/api/league/join/${id}`);
    fetchLeagues();
  }

  const handleClickOpen = (id) => {
    setSelectedLeagueId(id);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <div className={classes.root}>
      <Typography variant="h4">League Management</Typography>
      {/* previous code */}
      {leagues.map((league) => (
        <div key={league.id}>
          <Typography variant="h6">{league.name}</Typography>
          <Button variant="outlined" color="primary" onClick={() => handleClickOpen(league.id)}>
            View Details
          </Button>
        </div>
      ))}
      <Dialog open={open} onClose={handleClose} aria-labelledby="form-dialog-title">
        <DialogTitle id="form-dialog-title">League Managers</DialogTitle>
        <DialogContent>
          {leagueDetails && leagueDetails.map((detail) => (
            <Typography>{detail.name} - Rank: {detail.ranking}</Typography>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Close
          </Button>
          <Button variant="outlined" color="secondary" onClick={() => withdrawFromLeague(selectedLeagueId)}>
           Withdraw
          </Button>
          <Button variant="outlined" color="secondary" onClick={() => deleteLeague(selectedLeagueId)}>
           Delete
          </Button>
        </DialogActions>
      </Dialog>
      <TextField label="League Name" value={leagueName} onChange={(e) => setLeagueName(e.target.value)} />
      <Button onClick={createLeague}>Create League</Button>
    </div>
  );
}

export default LeagueManagement;
