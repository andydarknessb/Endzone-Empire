import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Select, MenuItem } from '@material-ui/core';
import { createMuiTheme, ThemeProvider } from '@material-ui/core/styles';

const theme = createMuiTheme({
  palette: {
    primary: {
      main: '#FFA500', // orange
    },
    secondary: {
      main: '#008000', // green
    },
    error: {
      main: '#000000', // black
    },
  },
});

function Draft() {
  const [players, setPlayers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [position, setPosition] = useState('all');

  useEffect(() => {
    fetchPlayers();
  }, [position]);

  const fetchPlayers = async () => {
    const response = await axios.get(`/api/players?position=${position}`); // Replace with your backend endpoint
    setPlayers(response.data);
  }

  const draftPlayer = async () => {
    if (selectedPlayerId) {
      await axios.post(`/api/draft/${selectedPlayerId}`); // Replace with your backend endpoint
      fetchPlayers();
    }
  }

  const handlePositionChange = (event) => {
    setPosition(event.target.value);
  }

  return (
    <ThemeProvider theme={theme}>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Player Name</TableCell>
              <TableCell align="right"></TableCell>
              <TableCell align="right">
                <Select value={position} onChange={handlePositionChange}>
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="QB">QB</MenuItem>
                  <MenuItem value="HB">HB</MenuItem>
                  <MenuItem value="WR">WR</MenuItem>
                  <MenuItem value="TE">TE</MenuItem>
                  <MenuItem value="K">K</MenuItem>
                  <MenuItem value="DST">DST</MenuItem>
                </Select>
              </TableCell>
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
                <TableCell align="right">{player.position}</TableCell>
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
    </ThemeProvider>
  );
}

export default Draft;
