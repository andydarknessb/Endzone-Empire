import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@material-ui/core';

const useStyles = makeStyles({
  table: {
    minWidth: 650,
  },
});

function PlayerManagement() {
  const [players, setPlayers] = useState([]);
  const classes = useStyles();

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    const options = {
      method: 'GET',
      url: 'https://api-american-football.p.rapidapi.com/players',
      
      headers: {
        'X-RapidAPI-Key': process.env.REACT_APP_RAPID_API_KEY,
        'X-RapidAPI-Host': process.env.REACT_APP_RAPID_API_HOST
      }
    };
  
    try {
      const response = await axios.request(options);
      console.log(response.data);
      setPlayers(response.data.response);
    } catch (error) {
      console.error(error);
    }
  };

  const addToRoster = async (player) => {
    try {
      await axios.post(`/api/draft/${player.id}`); // Update to use your server route
      console.log(`Added player ${player.name} to roster.`);
    } catch (error) {
      console.error(`Error adding player to roster: ${error}`);
    }
  };

  return (
    <TableContainer component={Paper}>
      <Table className={classes.table}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">Position</TableCell>
            <TableCell align="right">Team</TableCell>
            <TableCell align="right">Opponent</TableCell>
            <TableCell align="right">Manager</TableCell>
            <TableCell align="right">Statistics</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {players.map((player) => (
            <TableRow key={player.id}>
              <TableCell component="th" scope="row">{player.name}</TableCell>
              <TableCell align="right">{player.position}</TableCell>
              <TableCell align="right">{player.team}</TableCell>
              <TableCell align="right">{player.opponent}</TableCell>
              <TableCell align="right">{player.manager}</TableCell>
              <TableCell align="right">{JSON.stringify(player.statistics)}</TableCell>
              <TableCell align="right">
                <Button onClick={() => addToRoster(player)}>Add to Roster</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default PlayerManagement;
