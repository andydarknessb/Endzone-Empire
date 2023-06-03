import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Typography, TextField, Button, makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  root: {
    '& > *': {
      margin: theme.spacing(1),
    },
  },
}));

function LeagueManagement() {
  const classes = useStyles();
  const [leagueId, setLeagueId] = useState('');
  const [leagueName, setLeagueName] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [leagueDetails, setLeagueDetails] = useState(null);

  useEffect(() => {
    // Fetch leagues on component mount
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    const response = await axios.get('/api/league');
    setLeagues(response.data);
  }

  const createLeague = async () => {
    await axios.post('/api/league/create', { name: leagueName });
    fetchLeagues(); // Refresh the list of leagues
  }

  const fetchLeagueDetails = async (id) => {
    const response = await axios.get(`/api/league/${id}`);
    setLeagueDetails(response.data);
  }

  const updateLeague = async (id, name) => {
    await axios.put(`/api/league/${id}`, { name });
    fetchLeagues(); // Refresh the list of leagues
  }

  const deleteLeague = async (id) => {
    await axios.delete(`/api/league/${id}`);
    fetchLeagues(); // Refresh the list of leagues
  }

  const joinLeague = async (id) => {
    await axios.post(`/api/league/join/${id}`);
    fetchLeagues(); // Refresh the list of leagues
  }

  return (
    <div className={classes.root}>
      <Typography variant="h4">League Management</Typography>
      <TableContainer component={Paper}>
        <Table className={classes.table} aria-label="simple table">
          <TableHead>
            <TableRow>
              <TableCell>League Name</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {leagues.map((league) => (
              <TableRow key={league.id}>
                <TableCell component="th" scope="row">
                  {league.name}
                </TableCell>
                <TableCell align="right">
                  <Button onClick={() => fetchLeagueDetails(league.id)}>View Details</Button>
                  <Button onClick={() => deleteLeague(league.id)}>Delete</Button>
                  <Button onClick={() => joinLeague(league.id)}>Join</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TextField label="League Name" value={leagueName} onChange={(e) => setLeagueName(e.target.value)} />
      <Button onClick={createLeague}>Create League</Button>
      {leagueDetails && (
        <div>
          <Typography variant="h5">League Details</Typography>
          <TextField label="League Name" value={leagueDetails.name} onChange={(e) => setLeagueName(e.target.value)} />
          <Button onClick={() => updateLeague(leagueDetails.id, leagueName)}>Update</Button>
        </div>
      )}
    </div>
  );
}

export default LeagueManagement;
