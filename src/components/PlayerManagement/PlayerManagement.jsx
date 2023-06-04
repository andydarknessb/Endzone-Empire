import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@material-ui/core';

function PlayerManagement() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    const options = {
      method: 'GET',
      url: 'https://api-american-football.p.rapidapi.com/players',
      params: { id: '1' },
      headers: {
        'X-RapidAPI-Key': process.env.REACT_APP_RAPID_API_KEY,
        'X-RapidAPI-Host': process.env.REACT_APP_RAPID_API_HOST
      }
    };

    try {
      const response = await axios.request(options);
      setPlayers(response.data);
    } catch (error) {
      console.error(error);
    }
  };

  const addToRoster = (player) => {
    // TODO: Implement add to roster function
    console.log('Adding player to roster:', player);
  };

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell align="right">Position</TableCell>
            <TableCell align="right">Team</TableCell>
            <TableCell align="right">Opponent</TableCell>
            <TableCell align="right">Manager or Free Agent</TableCell>
            <TableCell align="right">Statistics</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {players.map((player) => (
            <TableRow key={player.id}>
              <TableCell component="th" scope="row">
                {player.name}
              </TableCell>
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
