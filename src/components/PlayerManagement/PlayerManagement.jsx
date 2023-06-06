import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { makeStyles, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button } from '@material-ui/core';
import Pagination from '@material-ui/lab/Pagination';

const useStyles = makeStyles({
  table: {
    minWidth: 650,
  },
});

function PlayerManagement() {
  const [players, setPlayers] = useState([]);
  const [positionFilter, setPositionFilter] = useState('All');
  const [pageNumber, setPageNumber] = useState(1);
  const classes = useStyles();

  useEffect(() => {
    fetchPlayers();
  }, [positionFilter, pageNumber]);

  const fetchPlayers = async () => {
    try {
      const response = await axios.get(`/api/players?page=${pageNumber}&position=${positionFilter}`);
      console.log(response.data);
      setPlayers(response.data);
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
    <div>
      <select onChange={(e) => setPositionFilter(e.target.value)}>
        <option>All</option>
        <option>QB</option>
        <option>RB</option>
        <option>WR</option>
        <option>TE</option>
        <option>K</option>
        <option>DST</option>
        {/* Add all positions here */}
      </select>
      <Pagination count={10} page={pageNumber} onChange={(event, value) => setPageNumber(value)} />
      <TableContainer component={Paper}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Position</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {players.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row">{player.name}</TableCell>
                <TableCell align="right">{player.position}</TableCell>
                <TableCell align="right">
                  <Button onClick={() => addToRoster(player)}>Add to Roster</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

export default PlayerManagement;
