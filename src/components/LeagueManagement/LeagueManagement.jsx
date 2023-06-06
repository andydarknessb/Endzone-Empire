import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Typography, TextField, Button, makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Dialog, DialogTitle, DialogContent, DialogActions } from '@material-ui/core';
import './LeagueManagement.css';
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
  const [userId, setUserId] = useState(null); 

  useEffect(() => {
    fetchLeagues();
    fetchUserId(); 
  }, []);

  const fetchUserId = async () => {
    const response = await axios.get('/api/user');
    setUserId(response.data.id);  // assumes the user object has an "id" property
  }

  useEffect(() => {
    if (selectedLeagueId) {
      fetchLeagueDetails(selectedLeagueId);
    }
  }, [selectedLeagueId]);

  const fetchLeagues = async () => {
    const response = await axios.get('/api/league/myLeagues');
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
    <div className="container">
    <div className="title">
    <div className="btn">
    <div className="RegisterForms">
    <div className="buttonContainer">
    <div className={classes.root}>
      <Typography variant="h4">My Leagues</Typography>
      {/* previous code */}
      {leagues.map((league) => (
  <div key={league.id}>
    <Typography variant="h6">{league.name}</Typography>
    <Button variant="outlined" color="primary" onClick={() => handleClickOpen(league.id)}>
      View Details
    </Button>
    {/* Only show the delete button if the logged-in user is the league's creator */}
    {userId === league.owner_id && (
      <Button variant="outlined" color="secondary" onClick={() => deleteLeague(league.id)}>
        Delete
      </Button>
    )}
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
     
     
    </div>
    </div>
    </div>
    </div>
    </div>
    </div>
  );
}

export default LeagueManagement;
