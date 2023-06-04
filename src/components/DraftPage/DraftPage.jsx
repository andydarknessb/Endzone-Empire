import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper } from '@material-ui/core';

function Draft() {
  const [players, setPlayers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    const response = await axios.get('/api/players'); // Replace with your backend endpoint
    setPlayers(response.data);
  }

  const draftPlayer = async () => {
    if (selectedPlayerId) {
      await axios.post(`/api/draft/${selectedPlayerId}`); // Replace with your backend endpoint
      fetchPlayers();
    }
  }

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Player Name</TableCell>
            <TableCell align="right">Team</TableCell>
            <TableCell align="right">Draft</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {players.map((player) => (
            <TableRow key={player.id}>
              <TableCell component="th" scope="row">
                {player.name}
              </TableCell>
              <TableCell align="right">{player.team}</TableCell>
              <TableCell align="right">
                <Button variant="contained" color="primary" onClick={() => setSelectedPlayerId(player.id)}>
                  Draft
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selectedPlayerId && <Button variant="contained" color="secondary" onClick={draftPlayer}>Confirm Draft</Button>}
    </TableContainer>
  );
}

export default Draft;
